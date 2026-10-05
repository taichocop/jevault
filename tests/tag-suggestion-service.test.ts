import { describe, expect, it, vi } from "vitest";

import { ClassificationCancelledError } from "../src/classification/classification-cancellation";
import {
  InvalidTypeSafeResponseError,
  MissingApiKeyError,
  NetworkError,
  NoActiveNoteError,
  NoCandidatesError,
  TypeSafeApiError,
  UnsupportedFileError,
} from "../src/classification/classification-errors";
import type { NoteStateResult } from "../src/note-service";
import type { TagCandidate } from "../src/tags/tag-candidate";
import type { TagEvaluation } from "../src/tags/tag-evaluation";
import type { TagEvaluator } from "../src/tags/tag-evaluator";
import { TagSuggestionService } from "../src/tags/tag-suggestion-service";
import { fixtureSource } from "./helpers/note-source";
import { NoteSource } from "../src/note-source";
import type { TFile } from "obsidian";
import { evaluationContext, fingerprintContent, sameContent } from "../src/tags/evaluation-provenance";

const readyNote = {
  status: "ready" as const,
  source: fixtureSource("Inbox/Synthetic.md"),
  note: { title: "Synthetic", path: "Inbox/Synthetic.md", body: "Synthetic note body" },
};
const candidates: TagCandidate[] = [
  { id: "tag_001", name: "#aws" },
  { id: "tag_002", name: "#deploy" },
  { id: "tag_003", name: "#rails" },
];
function evaluation(index: number, probability: number, choice: TagEvaluation["choice"] = "match"): TagEvaluation {
  return { tagId: candidates[index].id, tagName: candidates[index].name, choice, matchProbability: probability };
}
const evaluations = [evaluation(0, 0.91), evaluation(2, 0.8, "other"), evaluation(1, 0.72)];

function harness(options: {
  noteState?: NoteStateResult;
  candidates?: TagCandidate[];
  apiKey?: string | null;
  evaluations?: TagEvaluation[];
} = {}) {
  const getActiveNoteState = vi.fn<(signal?: AbortSignal) => Promise<NoteStateResult>>(async () => options.noteState ?? readyNote);
  const discover = vi.fn(() => options.candidates ?? candidates);
  const getApiKey = vi.fn<(name: string) => string | null>(() => options.apiKey === undefined ? "unit-test-only" : options.apiKey);
  const evaluate = vi.fn<TagEvaluator["evaluate"]>(async () => ({ evaluations: options.evaluations ?? evaluations }));
  const factory = vi.fn(() => ({ evaluate }));
  const getSettings = vi.fn(() => ({ apiKeySecretName: "synthetic-secret-reference", suggestionCount: 1 }));
  const service = new TagSuggestionService({ getActiveNoteState }, { discover }, { getApiKey }, factory, getSettings);
  return { service, getActiveNoteState, discover, getApiKey, evaluate, factory, getSettings };
}

function expectNoEvaluation(h: ReturnType<typeof harness>) {
  expect(h.factory).not.toHaveBeenCalled();
  expect(h.evaluate).not.toHaveBeenCalled();
}

describe("TagSuggestionService", () => {
  it("binds opaque provenance to the exact body evaluated without exposing it", async () => {
    const source = new NoteSource({ path: "Synthetic.md", stat: { mtime: 2, size: 100 } } as TFile);
    const note = { title: "Synthetic", path: source.path, body: "Synthetic original body" };
    const h = harness({ noteState: { status: "ready", source, note } });
    h.factory.mockImplementation(() => {
      note.body = "Synthetic changed body";
      return { evaluate: h.evaluate };
    });
    const result = await h.service.suggestForActiveNote();
    const proof = evaluationContext(result.evaluationProvenance, source);
    expect(proof).toBeDefined();
    expect(sameContent(proof!.content, (await fingerprintContent(h.evaluate.mock.calls[0][0].body))!)).toBe(true);
    expect(h.evaluate.mock.calls[0][0].body).toBe("Synthetic original body");
    expect(Object.isFrozen(h.evaluate.mock.calls[0][0])).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Synthetic original body");
    expect(JSON.stringify(result.evaluationProvenance)).toBe("{}");
  });
  it("orchestrates one bundled evaluation, filters only match and exposes only the safe result", async () => {
    const h = harness();
    const signal = new AbortController().signal;
    const result = await h.service.suggestForActiveNote(signal);
    expect(result).toEqual({ status: "success", noteTitle: readyNote.note.title, source: readyNote.source,
      suggestions: [evaluations[0], evaluations[2]] });
    expect(result.source).toBe(readyNote.source);
    expect(h.getActiveNoteState).toHaveBeenCalledExactlyOnceWith(signal);
    expect(h.discover).toHaveBeenCalledOnce();
    expect(h.getApiKey).toHaveBeenCalledExactlyOnceWith("synthetic-secret-reference");
    expect(h.factory).toHaveBeenCalledExactlyOnceWith("unit-test-only");
    expect(h.evaluate).toHaveBeenCalledExactlyOnceWith(readyNote.note, candidates, signal);
    expect(Object.isFrozen(h.evaluate.mock.calls[0][0])).toBe(true);
    expect(h.evaluate.mock.calls[0][1]).toBe(candidates);
    expect(JSON.stringify(result)).not.toContain(readyNote.note.body);
    expect(JSON.stringify(result)).not.toContain("unit-test-only");
    expect(Object.keys(result)).toEqual(["status", "noteTitle", "source", "suggestions"]);
    const order = [h.getActiveNoteState, h.discover, h.getSettings, h.getApiKey, h.factory, h.evaluate]
      .map((fn) => fn.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("sorts by match probability without thresholds or the folder display limit", async () => {
    const input = [evaluation(0, 0.2), evaluation(1, 0.9), evaluation(2, 0.5)];
    const h = harness({ evaluations: input });
    expect((await h.service.suggestForActiveNote()).suggestions).toEqual([input[1], input[2], input[0]]);
    expect(input).toEqual([evaluation(0, 0.2), evaluation(1, 0.9), evaluation(2, 0.5)]);
  });

  it("breaks ties by discovery order even when evaluation order and confidence differ", async () => {
    const first = { ...evaluation(0, 0.5), providerConfidence: 0.1 };
    const second = { ...evaluation(1, 0.5), providerConfidence: 0.99 };
    const third = evaluation(2, 0.5);
    const h = harness({ evaluations: [third, second, first] });
    expect((await h.service.suggestForActiveNote()).suggestions).toEqual([first, second, third]);
  });

  it("treats all other as successful empty suggestions even with probability 1", async () => {
    const h = harness({ evaluations: candidates.map((_, index) => evaluation(index, 1, "other")) });
    expect(await h.service.suggestForActiveNote()).toEqual({
      status: "success", noteTitle: readyNote.note.title, source: readyNote.source, suggestions: [],
    });
    expect(h.getApiKey).toHaveBeenCalledOnce();
    expect(h.factory).toHaveBeenCalledOnce();
    expect(h.evaluate).toHaveBeenCalledOnce();
  });

  it("rejects absent candidates before settings, secrets or evaluator, even with a missing key", async () => {
    const h = harness({ candidates: [], apiKey: null });
    await expect(h.service.suggestForActiveNote()).rejects.toBeInstanceOf(NoCandidatesError);
    expect(h.discover).toHaveBeenCalledOnce();
    expect(h.getSettings).not.toHaveBeenCalled();
    expect(h.getApiKey).not.toHaveBeenCalled();
    expectNoEvaluation(h);
  });

  it.each([null, "", "   "])("rejects missing or blank key %s before evaluator creation", async (apiKey) => {
    const h = harness({ apiKey });
    await expect(h.service.suggestForActiveNote()).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(h.getApiKey).toHaveBeenCalledOnce();
    expectNoEvaluation(h);
  });

  it.each([
    ["no-active-file", NoActiveNoteError], ["unsupported-file", UnsupportedFileError],
  ] as const)("rejects %s before discovery or secrets", async (status, ErrorType) => {
    const h = harness({ noteState: { status }, apiKey: null, candidates: [] });
    await expect(h.service.suggestForActiveNote()).rejects.toBeInstanceOf(ErrorType);
    expect(h.discover).not.toHaveBeenCalled();
    expect(h.getApiKey).not.toHaveBeenCalled();
    expectNoEvaluation(h);
  });

  it("retains the original source when the active note changes during evaluation", async () => {
    const h = harness();
    h.evaluate.mockImplementation(async () => {
      h.getActiveNoteState.mockResolvedValue({ ...readyNote, source: fixtureSource("Other.md") });
      return { evaluations };
    });
    expect((await h.service.suggestForActiveNote()).source).toBe(readyNote.source);
    expect(h.getActiveNoteState).toHaveBeenCalledOnce();
  });

  it("uses current settings and resolves secrets anew on each invocation", async () => {
    const h = harness();
    await h.service.suggestForActiveNote();
    h.getSettings.mockReturnValue({ apiKeySecretName: "updated-reference", suggestionCount: 1 });
    h.getApiKey.mockReturnValue("replacement-unit-test-only");
    await h.service.suggestForActiveNote();
    expect(h.getApiKey).toHaveBeenLastCalledWith("updated-reference");
    expect(h.factory).toHaveBeenLastCalledWith("replacement-unit-test-only");
    expect(h.getApiKey).toHaveBeenCalledTimes(2);
  });

  it.each(["entry", "note", "discovery", "settings", "secret", "factory", "evaluation", "filter"] as const)(
    "stops cancellation at %s without downstream work or stale success", async (stage) => {
      const controller = new AbortController();
      const h = harness();
      const abort = () => controller.abort("synthetic private abort reason");
      if (stage === "entry") abort();
      if (stage === "note") h.getActiveNoteState.mockImplementation(async () => { abort(); return readyNote; });
      if (stage === "discovery") h.discover.mockImplementation(() => { abort(); return []; });
      if (stage === "settings") h.getSettings.mockImplementation(() => { abort(); return { apiKeySecretName: "ref", suggestionCount: 1 }; });
      if (stage === "secret") h.getApiKey.mockImplementation(() => { abort(); return null; });
      if (stage === "factory") h.factory.mockImplementation(() => { abort(); return { evaluate: h.evaluate }; });
      if (stage === "evaluation") h.evaluate.mockImplementation(async () => { abort(); return { evaluations }; });
      if (stage === "filter") h.evaluate.mockResolvedValue({ evaluations: [{
        ...evaluation(0, 0.9), get choice() { abort(); return "match" as const; },
      }] });
      await expect(h.service.suggestForActiveNote(controller.signal)).rejects.toBeInstanceOf(ClassificationCancelledError);
      if (stage === "entry") expect(h.getActiveNoteState).not.toHaveBeenCalled();
      if (["entry", "note"].includes(stage)) expect(h.discover).not.toHaveBeenCalled();
      if (["entry", "note", "discovery", "settings"].includes(stage)) expect(h.getApiKey).not.toHaveBeenCalled();
      if (["entry", "note", "discovery", "settings", "secret"].includes(stage)) expectNoEvaluation(h);
      if (stage === "factory") expect(h.evaluate).not.toHaveBeenCalled();
    },
  );

  it("passes the signal to an in-flight evaluator and propagates its cancellation", async () => {
    const controller = new AbortController();
    const h = harness();
    let started!: () => void;
    const start = new Promise<void>((resolve) => { started = resolve; });
    h.evaluate.mockImplementation((_note, _candidates, signal) => new Promise((_resolve, reject) => {
      expect(signal).toBe(controller.signal);
      signal?.addEventListener("abort", () => reject(new ClassificationCancelledError()), { once: true });
      started();
    }));
    const pending = h.service.suggestForActiveNote(controller.signal);
    await start;
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ClassificationCancelledError);
    expect(h.evaluate).toHaveBeenCalledOnce();
  });

  it.each([NetworkError, TypeSafeApiError, InvalidTypeSafeResponseError, ClassificationCancelledError])(
    "propagates safe evaluator error %s without wrapping or extra data", async (ErrorType) => {
      const error = new ErrorType();
      const h = harness();
      h.evaluate.mockRejectedValue(error);
      await expect(h.service.suggestForActiveNote()).rejects.toBe(error);
      expect(error.message).not.toContain("unit-test-only");
      expect(error.message).not.toContain(readyNote.note.body);
    },
  );
});

describe("TagSuggestionService prepared-note entry", () => {
  it("uses supplied exact source/body for provenance, candidates, ordering and safe output", async () => {
    const h = harness({ noteState: { status: "no-active-file" }, evaluations: [evaluation(1, 0.5), evaluation(2, 1, "other"), evaluation(0, 0.5)] });
    const source = new NoteSource({ path: "Inbox/Exact.md", stat: { mtime: 7, size: 40 } } as TFile);
    const note = Object.freeze({ title: "Exact", path: source.path, body: "Synthetic exact target body" });
    const signal = new AbortController().signal;
    const result = await h.service.suggestForNote(note, source, signal);
    expect(result.source).toBe(source);
    expect(result.noteTitle).toBe(note.title);
    expect(result.suggestions).toEqual([evaluation(0, 0.5), evaluation(1, 0.5)]);
    expect(h.getActiveNoteState).not.toHaveBeenCalled();
    expect(h.discover).toHaveBeenCalledOnce();
    expect(h.evaluate).toHaveBeenCalledExactlyOnceWith(note, candidates, signal);
    const context = evaluationContext(result.evaluationProvenance, source);
    expect(context).toBeDefined();
    expect(evaluationContext(result.evaluationProvenance, readyNote.source)).toBeUndefined();
    expect(sameContent(context!.content, (await fingerprintContent(note.body))!)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(note.body); expect(JSON.stringify(result)).not.toContain("unit-test-only");
    expect(Object.keys(result).sort()).toEqual(["evaluationProvenance", "noteTitle", "source", "status", "suggestions"]);
  });

  it("preserves successful no-match semantics", async () => {
    const h = harness({ evaluations: candidates.map((_, i) => evaluation(i, 1, "other")) });
    expect((await h.service.suggestForNote(readyNote.note, readyNote.source)).suggestions).toEqual([]);
  });

  it("rejects absent candidates before Secret lookup", async () => {
    const h = harness({ candidates: [] });
    await expect(h.service.suggestForNote(readyNote.note, readyNote.source)).rejects.toBeInstanceOf(NoCandidatesError);
    expect(h.getApiKey).not.toHaveBeenCalled(); expectNoEvaluation(h);
  });

  it.each([null, "", "   "])("rejects missing Secret %j without provider", async apiKey => {
    const h = harness({ apiKey });
    await expect(h.service.suggestForNote(readyNote.note, readyNote.source)).rejects.toBeInstanceOf(MissingApiKeyError);
    expectNoEvaluation(h);
  });

  it.each([NetworkError, TypeSafeApiError, InvalidTypeSafeResponseError, ClassificationCancelledError])(
    "preserves typed failure %s", async ErrorType => {
      const h = harness(); const error = new ErrorType(); h.evaluate.mockRejectedValue(error);
      await expect(h.service.suggestForNote(readyNote.note, readyNote.source)).rejects.toBe(error);
    },
  );

  it("pre-abort prevents discovery, Secret lookup and evaluation", async () => {
    const h = harness(); const controller = new AbortController(); controller.abort();
    await expect(h.service.suggestForNote(readyNote.note, readyNote.source, controller.signal)).rejects.toBeInstanceOf(ClassificationCancelledError);
    expect(h.discover).not.toHaveBeenCalled(); expect(h.getApiKey).not.toHaveBeenCalled(); expectNoEvaluation(h);
  });

  it("cancellation during fingerprint prevents discovery and Secret lookup", async () => {
    const h = harness(); const controller = new AbortController();
    const source = new NoteSource({ path: "Exact.md", stat: { mtime: 1, size: 2 } } as TFile);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async () => {
      controller.abort(); return new ArrayBuffer(32);
    });
    try {
      await expect(h.service.suggestForNote(readyNote.note, source, controller.signal)).rejects.toBeInstanceOf(ClassificationCancelledError);
      expect(h.discover).not.toHaveBeenCalled(); expect(h.getApiKey).not.toHaveBeenCalled(); expectNoEvaluation(h);
    } finally { digest.mockRestore(); }
  });
});
