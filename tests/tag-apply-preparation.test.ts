import type { CachedMetadata, EventRef, MetadataCache, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteService } from "../src/note-service";
import { NoteSource } from "../src/note-source";
import { NetworkError } from "../src/classification/classification-errors";
import { TagApplyPreparationSession, type TagApplyPreparedPresentation } from "../src/tags/tag-apply-preparation";
import { TagSuggestionCommand } from "../src/tags/tag-suggestion-command";
import { TagSuggestionService, type TagSuggestionServiceResult } from "../src/tags/tag-suggestion-service";
import { captureEvaluationProvenance } from "../src/tags/evaluation-provenance";
import { TagApplyService } from "../src/tags/tag-apply-service";
import type { TagEvaluationResult } from "../src/tags/tag-evaluation";
import { TFile as FakeFile } from "./helpers/obsidian-move";

vi.mock("obsidian", async () => ({
  TFile: (await import("./helpers/obsidian-move")).TFile,
  getAllTags: (cache: { names?: string[] }) => cache.names ?? [],
  parseFrontMatterTags: () => [],
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function file(path: string) {
  return Object.assign(new FakeFile(path), { stat: { ctime: 1, mtime: 2, size: 10 } }) as TFile;
}
const suggestions = [{ tagId: "tag_001", tagName: "#aws", choice: "match" as const, matchProbability: 1 }];
const result = { evaluations: suggestions };
function harness() {
  const a = file("Synthetic/A.md"), b = file("Synthetic/B.md");
  let active: TFile | null = a;
  const files = new Map([[a.path, a], [b.path, b]]);
  const mutation = vi.fn(() => { throw new Error("Forbidden mutation"); });
  const vault = {
    getFileByPath: (path: string) => files.get(path) ?? null,
    read: vi.fn(async (target: TFile) => target === a ? "A" : "B"),
    modify: mutation, rename: mutation, delete: mutation, create: mutation, createFolder: mutation,
  };
  const listeners = new Map<EventRef, (file: TFile, data: string, cache: CachedMetadata) => void>();
  const callbacks: Array<(file: TFile, data: string, cache: CachedMetadata) => void> = [];
  const metadata = {
    on: vi.fn((_name: string, callback: (file: TFile, data: string, cache: CachedMetadata) => void) => {
      callbacks.push(callback);
      const ref = {} as EventRef; listeners.set(ref, callback); return ref;
    }),
    offref: vi.fn((ref: EventRef) => { listeners.delete(ref); }),
  };
  const emit = (target = a, body = "A") => {
    for (const callback of listeners.values()) callback(target, body, { names: [] } as CachedMetadata);
  };
  const evaluations: ReturnType<typeof deferred<TagEvaluationResult>>[] = [];
  const evaluate = vi.fn(() => {
    const pending = deferred<TagEvaluationResult>(); evaluations.push(pending); return pending.promise;
  });
  const service = new TagSuggestionService(
    new NoteService({ getActiveFile: () => active }, vault),
    { discover: () => [{ id: "tag_001", name: "#aws" }] },
    { getApiKey: () => "unit-test-only" },
    () => ({ evaluate }), () => ({ apiKeySecretName: "synthetic-reference" }),
  );
  const sessions: TagApplyPreparationSession[] = [];
  const shown: TagApplyPreparedPresentation[] = [];
  const outcomes: TagSuggestionServiceResult[] = [];
  const showError = vi.fn(); const hide = vi.fn();
  const command = new TagSuggestionCommand({
    tagSuggestionService: service, getActiveNotePath: () => active?.path ?? null,
    startPreparation: () => {
      const session = new TagApplyPreparationSession(vault, metadata as Pick<MetadataCache, "on" | "offref">, active);
      sessions.push(session); return session;
    },
    existingTags: { snapshot: () => ({ status: "available", names: [] }) },
    showLoading: () => ({ hide }), showError,
    showSuggestions: (outcome, _snapshot, signal, presentation) => {
      outcomes.push(outcome); shown.push(presentation);
      signal.addEventListener("abort", () => presentation.dispose(), { once: true });
    },
  });
  return { a, b, files, vault, metadata, callbacks, listeners, emit, evaluate, evaluations, sessions, shown, outcomes,
    command, showError, hide, mutation, switchTo: (target: TFile | null) => { active = target; } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function ready(h: ReturnType<typeof harness>, count = 1) {
  await vi.waitFor(() => expect(h.evaluate).toHaveBeenCalledTimes(count));
}
async function settledEvent(h: ReturnType<typeof harness>, body = "A", target = h.a) {
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let work: Promise<ArrayBuffer> | undefined;
  const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, bytes) => {
    work = digest(algorithm, bytes); return work;
  });
  h.emit(target, body);
  await work;
  await Promise.resolve(); await Promise.resolve();
  spy.mockRestore();
}

describe("explicit Tag Apply preparation lifecycle", () => {
  it("starts tracking before evaluation, captures before presentation, transfers until Close, and never mutates", async () => {
    const h = harness(); const apply = vi.spyOn(TagApplyService.prototype, "apply");
    expect(h.listeners.size).toBe(0);
    const run = h.command.execute();
    expect(h.listeners.size).toBe(1);
    await ready(h); await settledEvent(h);
    h.evaluations[0].resolve(result); await run;
    expect(h.shown[0].applyPreparation.status).toBe("available");
    expect(h.showError).not.toHaveBeenCalled(); expect(h.listeners.size).toBe(1);
    h.shown[0].dispose(); h.shown[0].dispose();
    expect(h.sessions[0].state.status).toBe("unavailable");
    expect(h.listeners.size).toBe(0); expect(h.metadata.offref).toHaveBeenCalledOnce();
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    h.emit(); h.callbacks[0](h.a, "A", {});
    expect(digest).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled(); expect(h.mutation).not.toHaveBeenCalled();
    h.command.dispose(); expect(h.metadata.offref).toHaveBeenCalledOnce();
  });
  it.each(["no-proof", "stale", "crypto-unavailable"])("preserves read-only success with unavailable preparation: %s", async (scenario) => {
    const h = harness();
    if (scenario === "crypto-unavailable") vi.stubGlobal("crypto", undefined);
    const run = h.command.execute(); await ready(h);
    if (scenario === "stale") await settledEvent(h, "B");
    h.evaluations[0].resolve(result); await run;
    expect(h.shown[0].applyPreparation.status).toBe("unavailable");
    if (scenario === "no-proof") expect(h.shown[0].applyPreparation).toEqual({ status: "unavailable", reason: "freshness-unverified" });
    if (scenario === "stale") expect(h.shown[0].applyPreparation).toEqual({ status: "unavailable", reason: "metadata-stale" });
    expect(h.showError).not.toHaveBeenCalled(); expect(h.mutation).not.toHaveBeenCalled(); h.command.dispose();
  });
  it("ignores another note and same-path replacement before hashing, keeping the original target on active switch", async () => {
    const h = harness(); const run = h.command.execute(); await ready(h);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    h.switchTo(h.b); h.emit(h.b, "B");
    const replacement = file(h.a.path); h.files.set(h.a.path, replacement); h.emit(replacement);
    expect(digest).not.toHaveBeenCalled();
    h.evaluations[0].resolve(result); await run;
    expect(h.outcomes[0].source.matches(h.a)).toBe(true);
    expect(h.shown[0].applyPreparation).toEqual({ status: "unavailable", reason: "source-changed" });
    h.command.dispose();
  });
  it.each(["rename", "move"])("does not hash a %s source", async (change) => {
    const h = harness(); const run = h.command.execute(); await ready(h);
    h.a.path = change === "rename" ? "Synthetic/Renamed.md" : "Other/A.md";
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest"); h.emit();
    expect(digest).not.toHaveBeenCalled();
    h.evaluations[0].resolve(result); await run;
    expect(h.shown[0].applyPreparation.status).toBe("unavailable"); h.command.dispose();
  });
  it("rejects a different outcome source without capturing or falling back to the active file", async () => {
    const h = harness();
    const session = new TagApplyPreparationSession(h.vault, h.metadata as Pick<MetadataCache, "on" | "offref">, h.a);
    const source = new NoteSource(h.b);
    session.prepare({ status: "success", noteTitle: "B", source, suggestions, evaluationProvenance: await captureEvaluationProvenance(source, "B") });
    expect(session.state).toEqual({ status: "unavailable", reason: "source-changed" }); session.dispose();
  });
  it("disposes failure before explicit Retry and gives Retry a new proof/session", async () => {
    const h = harness(); const run = h.command.execute(); await ready(h); await settledEvent(h);
    h.evaluations[0].reject(new NetworkError()); await run;
    expect(h.listeners.size).toBe(0); expect(h.metadata.offref).toHaveBeenCalledOnce();
    const retry = h.showError.mock.calls[0][1] as () => Promise<unknown>;
    const next = retry(); await ready(h, 2);
    expect(h.sessions[1]).not.toBe(h.sessions[0]);
    expect(h.listeners.size).toBe(1);
    h.evaluations[1].resolve(result); await next;
    expect(h.shown[0].applyPreparation).toEqual({ status: "unavailable", reason: "freshness-unverified" });
    expect(h.sessions[0].state.status).toBe("unavailable"); h.command.dispose();
  });
  it.each(["failure", "unload"])("late digest cannot resurrect proof after %s", async (action) => {
    const h = harness(); const run = h.command.execute(); await ready(h);
    const pending = deferred<ArrayBuffer>(); const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockReturnValue(pending.promise);
    h.emit();
    if (action === "failure") h.evaluations[0].reject(new NetworkError());
    else h.command.dispose();
    if (action !== "failure") h.evaluations[0].resolve(result);
    await run; expect(h.listeners.size).toBe(0);
    pending.resolve(new ArrayBuffer(32)); await pending.promise; await Promise.resolve(); await Promise.resolve();
    expect(h.sessions[0].state.status).toBe("unavailable"); expect(h.shown).toEqual([]);
    h.callbacks[0](h.a, "A", {}); expect(digest).toHaveBeenCalledOnce(); h.command.dispose();
  });
  it("explicit Retry owner cancellation removes its listener and ignores late hash/evaluation", async () => {
    const h = harness(); const first = h.command.execute(); await ready(h);
    h.evaluations[0].reject(new NetworkError()); await first;
    const retry = h.showError.mock.calls[0][1] as (signal: AbortSignal) => Promise<unknown>;
    const owner = new AbortController(); const next = retry(owner.signal); await ready(h, 2);
    const pending = deferred<ArrayBuffer>();
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockReturnValue(pending.promise);
    h.emit(); owner.abort();
    expect(h.listeners.size).toBe(0); expect(h.hide).toHaveBeenCalledTimes(2);
    h.evaluations[1].resolve(result); await next;
    pending.resolve(new ArrayBuffer(32)); await pending.promise; await Promise.resolve();
    h.callbacks[1](h.a, "A", {}); expect(digest).toHaveBeenCalledOnce();
    expect(h.sessions[1].state.status).toBe("unavailable"); expect(h.shown).toEqual([]);
    h.command.dispose();
  });
  it("Close invalidates a pending metadata fingerprint even after successful presentation", async () => {
    const h = harness(); const run = h.command.execute(); await ready(h);
    const pending = deferred<ArrayBuffer>();
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockReturnValue(pending.promise);
    h.emit(); h.evaluations[0].resolve(result); await run;
    expect(h.listeners.size).toBe(1); h.shown[0].dispose();
    pending.resolve(new ArrayBuffer(32)); await pending.promise; await Promise.resolve();
    expect(h.listeners.size).toBe(0); expect(h.shown[0].applyPreparation.status).toBe("unavailable");
    h.callbacks[0](h.a, "A", {}); expect(digest).toHaveBeenCalledOnce();
    h.command.dispose();
  });
  it("missing evaluation provenance remains unavailable even with matching indexed proof", async () => {
    const h = harness();
    const session = new TagApplyPreparationSession(h.vault, h.metadata as Pick<MetadataCache, "on" | "offref">, h.a);
    await settledEvent(h);
    session.prepare({ status: "success", noteTitle: "A", source: new NoteSource(h.a), suggestions });
    expect(session.state).toEqual({ status: "unavailable", reason: "freshness-unverified" });
    session.dispose();
  });
  it("disposes preparation for an application failure before Modal", async () => {
    const h = harness();
    // All application failures cross the same rejected service boundary; no automatic retry.
    const rejected = new TagSuggestionCommand({
      startPreparation: () => {
        const session = new TagApplyPreparationSession(h.vault, h.metadata as Pick<MetadataCache, "on" | "offref">, h.a);
        h.sessions.push(session); return session;
      },
      tagSuggestionService: { suggestForActiveNote: async () => { throw new Error("Synthetic application failure"); } },
      getActiveNotePath: () => h.a.path,
      existingTags: { snapshot: () => ({ status: "unavailable" }) },
      showLoading: () => ({ hide: h.hide }), showSuggestions: vi.fn(), showError: h.showError,
    });
    await rejected.execute();
    expect(h.metadata.offref).toHaveBeenCalledOnce(); expect(h.listeners.size).toBe(0);
    expect(h.hide).toHaveBeenCalledOnce(); expect(h.mutation).not.toHaveBeenCalled(); rejected.dispose();
  });
  it("unload disposes an open result and every in-flight evaluation immediately", async () => {
    const h = harness(); const first = h.command.execute(); await ready(h); await settledEvent(h);
    h.evaluations[0].resolve(result); await first;
    h.switchTo(h.b); const second = h.command.execute(); await ready(h, 2);
    h.command.dispose();
    expect(h.listeners.size).toBe(0); expect(h.hide).toHaveBeenCalledTimes(2);
    expect(h.shown[0].applyPreparation.status).toBe("unavailable");
    h.evaluations[1].resolve(result); await second; expect(h.shown).toHaveLength(1);
  });
  it("keeps concurrent A/B sessions separate and duplicate requests do not construct another tracker", async () => {
    const h = harness(); const first = h.command.execute(); await h.command.execute(); await ready(h);
    h.switchTo(h.b); const second = h.command.execute(); await ready(h, 2);
    expect(h.sessions).toHaveLength(2);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    h.emit(h.a, "A"); expect(digest).toHaveBeenCalledOnce();
    h.emit(h.b, "B"); expect(digest).toHaveBeenCalledTimes(2); digest.mockRestore();
    await settledEvent(h, "A", h.a); await settledEvent(h, "B", h.b);
    h.evaluations[0].resolve(result); h.evaluations[1].resolve(result); await Promise.all([first, second]);
    expect(h.shown.map(p => p.applyPreparation.status)).toEqual(["available", "available"]);
    h.shown[0].dispose(); expect(h.listeners.size).toBe(1); expect(h.shown[1].applyPreparation.status).toBe("available");
    h.shown[1].dispose(); expect(h.listeners.size).toBe(0);
  });
  it("proof listener failure still permits read-only success", async () => {
    const h = harness(); h.metadata.on.mockImplementation(() => { throw new Error("Synthetic metadata failure"); });
    const run = h.command.execute(); await ready(h); h.evaluations[0].resolve(result); await run;
    expect(h.shown[0].applyPreparation).toEqual({ status: "unavailable", reason: "metadata-unavailable" });
    expect(h.showError).not.toHaveBeenCalled(); h.command.dispose();
  });
});
