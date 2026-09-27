import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { PassThrough } from "node:stream";
import { request as httpsRequest } from "https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClassificationCancelledError } from "../src/classification/classification-cancellation";
import {
  NetworkError,
  TypeSafeApiError,
} from "../src/classification/classification-errors";
import type { FolderCandidate } from "../src/classification/folder-candidate";
import { TypeSafeAdapter } from "../src/classification/typesafe-adapter";
import type { NoteState } from "../src/note-service";

vi.mock("https", () => ({ request: vi.fn() }));

const serve = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
let lastResponse: (PassThrough & { complete: boolean }) | undefined;
let syntheticChunk: unknown;

// Nodeのrequest/responseだけをfake化し、SDK生成・adapter・stream処理は実装を通す。
function installHttpsFake(): void {
  vi.mocked(httpsRequest).mockImplementation((...args: unknown[]) => {
    const [input, options, receive] = args as [
      string,
      RequestOptions,
      (response: IncomingMessage) => void,
    ];
    const request = new EventEmitter() as ClientRequest;
    let destroyed = false;
    const abort = (): void => {
      destroyed = true;
      lastResponse?.destroy(new Error("synthetic abort"));
      request.emit("error", new Error("synthetic abort"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    request.end = ((body: string) => {
      void (async () => {
        try {
          const reply = await serve(input, {
            method: options.method,
            headers: options.headers as HeadersInit,
            signal: options.signal,
            body,
          });
          if (destroyed) return;
          const headers: Record<string, string> = {};
          reply.headers.forEach((value, name) => { headers[name] = value; });
          const response = Object.assign(new PassThrough({
            objectMode: syntheticChunk !== undefined,
          }), {
            statusCode: reply.status,
            headers,
            complete: false,
          });
          lastResponse = response;
          response.once("close", () => options.signal?.removeEventListener("abort", abort));
          receive(response as unknown as IncomingMessage);
          const reader = reply.body?.getReader();
          if (reader !== undefined) {
            while (!response.destroyed) {
              const chunk = await reader.read();
              if (chunk.done) break;
              response.write(syntheticChunk === undefined ? chunk.value : syntheticChunk);
            }
          }
          if (!response.destroyed) {
            response.complete = true;
            response.end();
          }
        } catch (error) {
          options.signal?.removeEventListener("abort", abort);
          if (!destroyed) {
            lastResponse?.destroy(error as Error);
            request.emit("error", error);
          }
        }
      })();
      return request;
    }) as ClientRequest["end"];
    return request;
  });
}

const note: NoteState = {
  title: "Synthetic runtime note",
  path: "Inbox/Synthetic runtime note.md",
  body: "Synthetic content for a network-free runtime regression test.",
};
const candidates: FolderCandidate[] = [
  { path: "Projects", description: "Synthetic project folder" },
  { path: "Archive", description: "Synthetic archive folder" },
];
const providerResponse = {
  answers: {
    destination: {
      type: "choice",
      choice: "Projects",
      probabilities: { Projects: 0.8, Archive: 0.2 },
    },
  },
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("TypeSafe production runtime boundary", () => {
  beforeEach(() => {
    // executor差し替えでは通らない実SDK constructorを、renderer相当のglobalsで検証する。
    vi.stubGlobal("window", { document: {} });
    vi.stubGlobal("navigator", { userAgent: "Synthetic Electron renderer" });
    // renderer fetchはCORSで失敗する環境を再現し、実networkはhttpsのfakeで遮断する。
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Synthetic CORS block"); }));
    serve.mockReset().mockResolvedValue(jsonResponse(providerResponse));
    vi.mocked(httpsRequest).mockReset();
    lastResponse = undefined;
    syntheticChunk = undefined;
    installHttpsFake();
  });

  afterEach(() => {
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("constructs the real SDK in a Desktop-like renderer without starting a request", async () => {
    const fetch = serve;
    const adapter = new TypeSafeAdapter("unit-test-only");

    expect(fetch).not.toHaveBeenCalled();
    await expect(adapter.classify(note, candidates)).resolves.toEqual({
      candidates: [
        { path: "Projects", probability: 0.8 },
        { path: "Archive", probability: 0.2 },
      ],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/systemone",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("decodes multiple Buffer chunks in order through the Desktop transport", async () => {
    const payload = JSON.stringify(providerResponse);
    const bytes = new TextEncoder().encode(payload);
    serve.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 11));
        controller.enqueue(bytes.slice(11, 25));
        controller.enqueue(bytes.slice(25));
        controller.close();
      },
    })));

    await expect(new TypeSafeAdapter("unit-test-only").classify(note, candidates))
      .resolves.toEqual({
        candidates: [
          { path: "Projects", probability: 0.8 },
          { path: "Archive", probability: 0.2 },
        ],
      });
    expect(httpsRequest).toHaveBeenCalledOnce();
  });

  it.each([new Uint8Array([123]), "private response", { body: "private response" }])(
    "rejects a synthetic non-Buffer response chunk safely",
    async (chunk) => {
      vi.useFakeTimers();
      syntheticChunk = chunk;
      const result = new TypeSafeAdapter("unit-test-only").classify(note, candidates);

      await expect(result).rejects.toBeInstanceOf(NetworkError);
      await expect(result).rejects.not.toThrow("private response");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(httpsRequest).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("pins the endpoint and keeps logging off despite ambient SDK configuration", async () => {
    vi.stubEnv("TYPESAFE_BASE_URL", "https://example.invalid");
    vi.stubEnv("TYPESAFE_LOG_LEVEL", "debug");
    const logs = ["debug", "info", "warn", "error"] as const;
    const spies = logs.map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const fetch = serve;
    const adapter = new TypeSafeAdapter("unit-test-only");

    await adapter.classify(note, candidates);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
    expect(vi.mocked(httpsRequest).mock.calls[0]?.[1]).toMatchObject({
      agent: false, rejectUnauthorized: true,
    });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("never starts the SDK transport for a pre-cancelled operation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("synthetic cancellation detail"));
    const adapter = new TypeSafeAdapter("unit-test-only");

    const result = adapter.classify(note, candidates, controller.signal);

    await expect(result).rejects.toBeInstanceOf(ClassificationCancelledError);
    await expect(result).rejects.not.toThrow("synthetic cancellation detail");
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("aborts an active SDK fetch and never retries the cancelled request", async () => {
    vi.useFakeTimers();
    let transportSignal: AbortSignal | null | undefined;
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          transportSignal = init?.signal;
          transportSignal?.addEventListener(
            "abort",
            () => reject(new Error("synthetic transport cancellation")),
            { once: true },
          );
        }),
    );
    serve.mockImplementation(fetch);
    const controller = new AbortController();
    const adapter = new TypeSafeAdapter("unit-test-only");
    const result = adapter.classify(note, candidates, controller.signal);
    const cancelled = expect(result).rejects.toBeInstanceOf(
      ClassificationCancelledError,
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(httpsRequest).mock.calls[0]?.[1]).toMatchObject({
      agent: false, rejectUnauthorized: true,
    });
    expect(transportSignal?.aborted).toBe(false);
    controller.abort();

    expect(transportSignal?.aborted).toBe(true);
    await cancelled;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([408, 429, 500, 503, 599])(
    "does not automatically retry HTTP %i, including after cancellation",
    async (status) => {
      vi.useFakeTimers();
      const fetch = vi.fn(async () => jsonResponse({ error: "synthetic" }, status));
      serve.mockImplementation(fetch);
      const controller = new AbortController();
      const adapter = new TypeSafeAdapter("unit-test-only");

      await expect(
        adapter.classify(note, candidates, controller.signal),
      ).rejects.toBeInstanceOf(TypeSafeApiError);
      controller.abort();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not automatically retry a network failure", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => {
      throw new Error("synthetic connection failure");
    });
    serve.mockImplementation(fetch);
    const adapter = new TypeSafeAdapter("unit-test-only");

    await expect(adapter.classify(note, candidates)).rejects.toBeInstanceOf(
      NetworkError,
    );
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a real redirect response without following its Location or retrying", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(null, {
      status: 307,
      headers: { Location: "https://example.invalid" },
    }));
    serve.mockImplementation(fetch);
    const adapter = new TypeSafeAdapter("unit-test-only");
    const result = adapter.classify(note, candidates);

    await expect(result).rejects.toBeInstanceOf(NetworkError);
    await expect(result).rejects.not.toThrow("example.invalid");
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an HTTP 101 upgrade, destroys its socket, and does not retry", async () => {
    vi.useFakeTimers();
    const request = new EventEmitter() as ClientRequest;
    const privateDetail = "Synthetic private upgrade detail";
    const destroy = vi.fn(() => request.emit("close"));
    request.end = vi.fn(() => {
      void Promise.resolve().then(() => {
        request.emit("finish");
        // 101はNodeでresponse callbackではなくupgrade eventへ分岐する。
        request.emit(
          "upgrade",
          { statusCode: 101, statusMessage: privateDetail },
          { destroy },
          Buffer.from(privateDetail),
        );
      });
      return request;
    }) as ClientRequest["end"];
    vi.mocked(httpsRequest).mockImplementationOnce(() => request);
    const controller = new AbortController();
    const result = new TypeSafeAdapter("unit-test-only").classify(
      note,
      candidates,
      controller.signal,
    );

    await expect(result).rejects.toBeInstanceOf(NetworkError);
    await expect(result).rejects.not.toThrow(privateDetail);
    expect(destroy).toHaveBeenCalledOnce();
    expect(httpsRequest).toHaveBeenCalledOnce();
    expect(serve).not.toHaveBeenCalled();

    controller.abort();
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(result).rejects.toBeInstanceOf(NetworkError);
    expect(httpsRequest).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles if the native request closes without a response or error", async () => {
    vi.useFakeTimers();
    const request = new EventEmitter() as ClientRequest;
    request.end = vi.fn(() => {
      void Promise.resolve().then(() => request.emit("close"));
      return request;
    }) as ClientRequest["end"];
    vi.mocked(httpsRequest).mockImplementationOnce(() => request);
    const result = new TypeSafeAdapter("unit-test-only").classify(note, candidates);

    await expect(result).rejects.toBeInstanceOf(NetworkError);
    expect(httpsRequest).toHaveBeenCalledOnce();
    expect(serve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(httpsRequest).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts HTTPS while the response body is still arriving", async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    serve.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
        controller.enqueue(new TextEncoder().encode('{"answers":'));
      },
    })));
    const controller = new AbortController();
    const adapter = new TypeSafeAdapter("unit-test-only");
    const result = adapter.classify(note, candidates, controller.signal);
    const cancelled = expect(result).rejects.toBeInstanceOf(ClassificationCancelledError);
    await vi.waitFor(() => expect(lastResponse).toBeDefined());

    controller.abort();
    body.close();

    await cancelled;
    expect(lastResponse?.destroyed).toBe(true);
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "close", "incomplete-end"] as const)(
    "handles response body %s as a safe network failure without retry",
    async (failure) => {
      let body!: ReadableStreamDefaultController<Uint8Array>;
      serve.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller;
          controller.enqueue(new TextEncoder().encode('{"answers":'));
        },
      })));
      const adapter = new TypeSafeAdapter("unit-test-only");
      const result = adapter.classify(note, candidates);
      const rejected = expect(result).rejects.toBeInstanceOf(NetworkError);
      await vi.waitFor(() => expect(lastResponse).toBeDefined());

      if (failure === "error") lastResponse!.destroy(new Error("Synthetic private transport detail"));
      else if (failure === "close") lastResponse!.destroy();
      else lastResponse!.end();
      await rejected;
      body.close();

      await expect(result).rejects.not.toThrow("Synthetic private transport detail");
      expect(httpsRequest).toHaveBeenCalledTimes(1);
    },
  );

  it("aborts HTTPS on the SDK timeout without retry", async () => {
    vi.useFakeTimers();
    serve.mockImplementation(() => new Promise(() => {}));
    const adapter = new TypeSafeAdapter("unit-test-only");
    const result = adapter.classify(note, candidates);
    const rejected = expect(result).rejects.toBeInstanceOf(NetworkError);

    await vi.advanceTimersByTimeAsync(10_000);

    await rejected;
    expect(serve.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"] as const)(
    "discards a late executor %s after cancellation",
    async (settlement) => {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: Error) => void;
      const response = new Promise<unknown>((resolveResponse, rejectResponse) => {
        resolve = resolveResponse;
        reject = rejectResponse;
      });
      const execute = vi.fn(async () => response);
      const classifyFailure = vi.fn(() => "api" as const);
      const adapter = new TypeSafeAdapter(
        "unit-test-only",
        execute,
        classifyFailure,
      );
      const controller = new AbortController();
      const result = adapter.classify(note, candidates, controller.signal);
      const cancelled = expect(result).rejects.toBeInstanceOf(
        ClassificationCancelledError,
      );

      controller.abort();
      if (settlement === "resolve") resolve(providerResponse);
      else reject(new Error("synthetic provider failure"));

      await cancelled;
      expect(execute).toHaveBeenCalledTimes(1);
      expect(classifyFailure).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );
});
