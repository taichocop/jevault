import {
  APIConnectionError,
  choice,
  TypeSafeClient,
  type SystemOneRequest,
  VERSION as TYPE_SAFE_SDK_VERSION,
} from "@typesafe-ai/sdk";
import { Buffer } from "buffer";
import type { IncomingMessage } from "http";
import { request as httpsRequest } from "https";

import type { NoteState } from "../note-service";
import type {
  ClassificationCandidate,
  ClassificationResult,
} from "./classification-result";
import type { Classifier } from "./classifier";
import { throwIfCancelled } from "./classification-cancellation";
import {
  InvalidTypeSafeResponseError,
  NetworkError,
  TypeSafeApiError,
} from "./classification-errors";
import type { FolderCandidate } from "./folder-candidate";

export { TYPE_SAFE_SDK_VERSION };

const DESTINATION_QUESTION = "destination";
const TYPE_SAFE_BASE_URL = "https://api.typesafe.ai";
const TYPE_SAFE_SYSTEM_ONE_URL = `${TYPE_SAFE_BASE_URL}/v1/systemone`;
const DESTINATION_INSTRUCTIONS =
  "Which existing vault folder is the most appropriate destination for this note?";

type SystemOneExecutor = (
  request: SystemOneRequest,
  signal?: AbortSignal,
) => Promise<unknown>;
type ProviderFailureKind = "network" | "api";
type ProviderFailureClassifier = (error: unknown) => ProviderFailureKind;

interface UnknownRecord {
  [key: string]: unknown;
}

export { InvalidTypeSafeResponseError } from "./classification-errors";

/** TypeSafe固有のrequest構築・通信・response変換をdomainへ漏らさないadapter。 */
export class TypeSafeAdapter implements Classifier {
  private readonly execute: SystemOneExecutor;

  constructor(
    apiKey: string,
    execute?: SystemOneExecutor,
    private readonly classifyProviderFailure: ProviderFailureClassifier =
      classifyTypeSafeFailure,
  ) {
    if (execute !== undefined) {
      this.execute = execute;
      return;
    }

    // SecretStorage等をadapterから探索せず、呼び出し元が注入した値だけを利用する。
    const client = new TypeSafeClient({
      apiKey,
      // 環境変数による送信先変更を避け、公式endpointだけへ送信する。
      baseURL: TYPE_SAFE_BASE_URL,
      // Obsidian rendererでは利用者自身の注入済みkeyを使うため、browser guardを明示的に許可する。
      dangerouslyAllowBrowser: true,
      // 再送は利用者のRetry操作だけに限定し、SDKの自動通信を止める。
      retry: { maxRetries: 0 },
      logLevel: "off",
      // rendererのCORS制約を避け、SDKの正式なfetch境界でabort可能なDesktop通信へ置き換える。
      fetch: desktopTypeSafeFetch,
    });
    this.execute = async (request, signal) =>
      client.systemOne(request, { signal });
  }

  async classify(
    note: NoteState,
    candidates: FolderCandidate[],
    signal?: AbortSignal,
  ): Promise<ClassificationResult> {
    throwIfCancelled(signal);
    assertValidInputPaths(candidates);
    const criteria = Object.fromEntries(
      candidates.map((candidate) => [candidate.path, candidate.description]),
    );
    let response: unknown;
    try {
      response = await this.execute(
        {
          state: {
            title: note.title,
            path: note.path,
            body: note.body,
          },
          questions: {
            [DESTINATION_QUESTION]: choice(DESTINATION_INSTRUCTIONS, criteria),
          },
        },
        signal,
      );
    } catch (error: unknown) {
      throwIfCancelled(signal);
      // SDKの詳細やresponse bodyをdomain/UIへ渡さず、通信失敗だけを区別する。
      if (this.classifyProviderFailure(error) === "network") {
        throw new NetworkError();
      }
      throw new TypeSafeApiError();
    }

    throwIfCancelled(signal);
    return mapTypeSafeResponse(response, candidates);
  }
}

async function desktopTypeSafeFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  // originだけでなくpathも固定し、SDK変更やredirectで別の送信先へ広がらないようにする。
  if (
    input !== TYPE_SAFE_SYSTEM_ONE_URL ||
    init?.method !== "POST" ||
    typeof init.body !== "string"
  ) {
    throw new Error("Invalid TypeSafe transport request.");
  }
  const signal = init.signal ?? undefined;
  throwIfCancelled(signal);
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  headers["accept-encoding"] = "identity";

  return new Promise<Response>((resolve, reject) => {
    let responseStarted = false;
    const request = httpsRequest(
      TYPE_SAFE_SYSTEM_ONE_URL,
      {
        method: "POST",
        headers,
        signal,
        // ambientなglobal agent/proxy設定やTLS検証無効化を通信境界へ持ち込まない。
        agent: false,
        rejectUnauthorized: true,
      },
      (response) => {
        responseStarted = true;
        void readDesktopResponse(response, signal).then(resolve, reject);
      },
    );
    request.once("error", reject);
    request.once("upgrade", (_response, socket) => {
      // 101は通常のresponseを通らないため、接続を破棄して安全に終了する。
      reject(new Error("Invalid TypeSafe transport response."));
      socket.destroy();
    });
    request.once("close", () => {
      // response/errorなしの終了でも分類をpendingのまま残さない。
      if (!responseStarted) {
        reject(new Error("Invalid TypeSafe transport response."));
      }
    });
    request.end(init.body);
  });
}

async function readDesktopResponse(
  response: IncomingMessage,
  signal?: AbortSignal,
): Promise<Response> {
  const status = response.statusCode;
  if (status === undefined || status < 200 || status >= 300 && status < 400) {
    // Node HTTPSはredirectを追従しない。本文を読む前に拒否し、接続も解放する。
    response.destroy();
    throw new Error("Invalid TypeSafe transport response.");
  }

  const chunks: Buffer[] = [];
  // async iteratorがstream error/途中切断も捕捉し、SDKのtimeout/abortを本文完了まで有効にする。
  for await (const rawChunk of response) {
    throwIfCancelled(signal);
    const chunk: unknown = rawChunk;
    // encoding未設定のIncomingMessageはBufferを返す。想定外の値は変換せず拒否する。
    if (!Buffer.isBuffer(chunk)) {
      throw new Error("Invalid TypeSafe transport response.");
    }
    chunks.push(chunk);
  }
  throwIfCancelled(signal);
  if (!response.complete) {
    throw new Error("Incomplete TypeSafe transport response.");
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else if (value !== undefined) {
      headers.append(name, value);
    }
  }
  return new Response(
    status === 204 || status === 205 ? null : Buffer.concat(chunks).toString("utf8"),
    { status, headers },
  );
}

/** SDK error classの判定はadapter内へ閉じ、testではprovider非依存の分類関数へ差し替える。 */
function classifyTypeSafeFailure(error: unknown): ProviderFailureKind {
  return error instanceof APIConnectionError ? "network" : "api";
}

/** 信頼境界の外から来た値を、domainの正常値として扱う前に検証する。 */
export function mapTypeSafeResponse(
  response: unknown,
  candidates: readonly FolderCandidate[],
): ClassificationResult {
  const root = asRecord(response);
  const answers = asRecord(root.answers);
  const answer = asRecord(answers[DESTINATION_QUESTION]);
  if (answer.type !== "choice") {
    throw new InvalidTypeSafeResponseError();
  }
  const allowedPaths = new Set(candidates.map((candidate) => candidate.path));
  if (typeof answer.choice !== "string" || !allowedPaths.has(answer.choice)) {
    throw new InvalidTypeSafeResponseError();
  }
  const probabilities = asRecord(answer.probabilities);
  const rawCandidates = Object.entries(probabilities).map(
    ([path, probability]) => ({ path, probability }),
  );
  const validatedCandidates = validateClassificationCandidates(
    rawCandidates,
    candidates,
  );
  if (
    !validatedCandidates.some((candidate) => candidate.path === answer.choice)
  ) {
    throw new InvalidTypeSafeResponseError();
  }
  const providerConfidence = validateOptionalProbability(answer.confidence);

  return providerConfidence === undefined
    ? { candidates: validatedCandidates }
    : { candidates: validatedCandidates, providerConfidence };
}

export function validateClassificationCandidates(
  value: unknown,
  candidates: readonly FolderCandidate[],
): ClassificationCandidate[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidTypeSafeResponseError();
  }

  const allowedPaths = new Set(candidates.map((candidate) => candidate.path));
  const observedPaths = new Set<string>();

  const validatedCandidates = value.map((entry) => {
    const candidate = asRecord(entry);
    if (typeof candidate.path !== "string" || !allowedPaths.has(candidate.path)) {
      throw new InvalidTypeSafeResponseError();
    }
    if (observedPaths.has(candidate.path)) {
      throw new InvalidTypeSafeResponseError();
    }
    observedPaths.add(candidate.path);

    return {
      path: candidate.path,
      probability: validateProbability(candidate.probability),
    };
  });

  // 候補の欠落を許すと未評価のfolderを0扱いしてしまうため、集合の完全一致を要求する。
  if (observedPaths.size !== allowedPaths.size) {
    throw new InvalidTypeSafeResponseError();
  }

  return validatedCandidates;
}

function assertValidInputPaths(candidates: readonly FolderCandidate[]): void {
  if (candidates.length === 0) {
    throw new Error("At least one folder candidate is required.");
  }
  const paths = new Set<string>();
  for (const candidate of candidates) {
    if (paths.has(candidate.path)) {
      throw new Error(`Folder candidates contain a duplicate path: ${candidate.path}`);
    }
    paths.add(candidate.path);
  }
}

function asRecord(value: unknown): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidTypeSafeResponseError();
  }
  return value as UnknownRecord;
}

function validateOptionalProbability(value: unknown): number | undefined {
  return value === undefined ? undefined : validateProbability(value);
}

function validateProbability(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new InvalidTypeSafeResponseError();
  }
  return value;
}
