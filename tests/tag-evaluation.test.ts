import { describe, expect, it, vi } from "vitest";

import { ClassificationCancelledError } from "../src/classification/classification-cancellation";
import {
  InvalidTypeSafeResponseError,
  NetworkError,
  NoCandidatesError,
  TypeSafeApiError,
} from "../src/classification/classification-errors";
import { TypeSafeAdapter } from "../src/classification/typesafe-adapter";
import type { NoteState } from "../src/note-service";
import type { TagCandidate } from "../src/tags/tag-candidate";
import type { TagEvaluator } from "../src/tags/tag-evaluator";

const note: NoteState = { title: "Synthetic", path: "Inbox/Synthetic.md", body: "Synthetic content" };
const candidates: TagCandidate[] = [
  { id: "tag_004", name: "#日本語", description: "Synthetic Japanese context" },
  { id: "tag_001", name: "#programming/aws" },
  { id: "tag_003", name: "#aws" },
  { id: "tag_002", name: "#AWS" },
];
function answer(choice = "match", probability = 0.9): Record<string, unknown> {
  return { type: "choice", choice, probabilities: { match: probability, other: 1 - probability } };
}
function response(): { answers: Record<string, unknown> } {
  // providerのkey順と入力順を逆にし、mappingの独立性を検証する。
  return { answers: {
    q_004: answer("other", 0.35), q_003: answer(), q_002: answer(),
    q_001: { ...answer(), confidence: 0.6, tagName: "#untrusted" },
  } };
}

describe("TagEvaluator TypeSafe boundary", () => {
  it("evaluates one candidate without provider confidence", async () => {
    const execute = vi.fn(async () => ({ answers: { q_001: answer() } }));
    const evaluator: TagEvaluator = new TypeSafeAdapter("unit-test-only", execute);
    await expect(evaluator.evaluate(note, [candidates[0]])).resolves.toEqual({
      evaluations: [{ tagId: "tag_004", tagName: "#日本語", choice: "match", matchProbability: 0.9 }],
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("bundles independent questions, preserves all tags and input order, and uses only approved state", async () => {
    const execute = vi.fn(async () => response());
    const evaluator: TagEvaluator = new TypeSafeAdapter("unit-test-only", execute);
    await expect(evaluator.evaluate({ ...note, extra: "not approved" } as NoteState, candidates)).resolves.toEqual({
      evaluations: candidates.map((candidate, index) => ({
        tagId: candidate.id, tagName: candidate.name,
        choice: index === 3 ? "other" : "match",
        matchProbability: index === 3 ? 0.35 : 0.9,
        ...(index === 0 ? { providerConfidence: 0.6 } : {}),
      })),
    });
    expect(execute).toHaveBeenCalledOnce();
    const [request, signal] = execute.mock.calls[0] as unknown as [
      { state: NoteState; questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }> },
      AbortSignal | undefined,
    ];
    expect(signal).toBeUndefined();
    expect(request.state).toEqual(note);
    expect(Object.keys(request.questions)).toEqual(["q_001", "q_002", "q_003", "q_004"]);
    expect(Object.keys(request.questions)).toHaveLength(candidates.length);
    for (const [index, question] of Object.values(request.questions).entries()) {
      expect(question.type).toBe("choice");
      expect(Object.keys(question.criteria)).toEqual(["match", "other"]);
      expect(question.instructions).toContain(candidates[index].name);
      expect(candidates.map(({ name }) => name)).not.toContain(Object.keys(request.questions)[index]);
      expect(question.criteria.match).not.toContain("undefined");
    }
    expect(request.questions.q_001.criteria.match).toContain(candidates[0].description);
  });

  it("retains sent identity even if the caller mutates candidates while awaiting", async () => {
    const input = candidates.map((candidate) => ({ ...candidate }));
    const execute = vi.fn(async () => {
      input[0].name = "#changed";
      input[0].id = "changed";
      input.reverse();
      return response();
    });
    const result = await new TypeSafeAdapter("unit-test-only", execute).evaluate(note, input);
    expect(result.evaluations.map(({ tagId, tagName }) => ({ tagId, tagName })))
      .toEqual(candidates.map(({ id, name }) => ({ tagId: id, tagName: name })));
  });

  it.each([0, 1])("accepts match probability boundary %i independently of choice", async (probability) => {
    const execute = vi.fn(async () => ({ answers: { q_001: answer("other", probability) } }));
    const result = await new TypeSafeAdapter("unit-test-only", execute).evaluate(note, [candidates[0]]);
    expect(result.evaluations[0]).toMatchObject({ choice: "other", matchProbability: probability });
  });

  it.each([
    ["answer missing", undefined], ["null answer", null], ["array answer", []],
    ["wrong answer type", { ...answer(), type: "boolean" }],
    ["invalid choice", answer("unknown")],
    ["probabilities missing", { type: "choice", choice: "match", confidence: 1 }],
    ["match missing", { ...answer(), probabilities: { other: 1 } }],
    ["NaN", answer("match", NaN)], ["Infinity", answer("match", Infinity)],
    ["negative", answer("match", -0.01)], ["above one", answer("match", 1.01)],
    ["string probability", { ...answer(), probabilities: { match: "0.9" } }],
    ["invalid confidence", { ...answer(), confidence: 1.1 }],
  ])("rejects %s without partial success or confidence fallback", async (_label, invalid) => {
    const reply = response();
    reply.answers.q_003 = invalid;
    await expect(new TypeSafeAdapter("unit-test-only", async () => reply).evaluate(note, candidates))
      .rejects.toBeInstanceOf(InvalidTypeSafeResponseError);
  });

  it.each([
    ["malformed root", null], ["array root", []], ["scalar root", "private provider body"],
    ["missing answers", {}], ["null answers", { answers: null }],
    ["array answers", { answers: [answer()] }], ["scalar answers", { answers: "private" }],
    ["missing candidate", { answers: { q_001: answer() } }],
    ["unknown question", { answers: { ...response().answers, unknown: answer() } }],
    ["unknown replacement", { answers: { q_001: answer(), q_002: answer(), q_004: answer(), unknown: answer() } }],
    ["raw tag key", { answers: { "#日本語": answer() } }],
  ])("rejects %s bundle", async (_label, reply) => {
    const result = new TypeSafeAdapter("unit-test-only", async () => reply).evaluate(note, candidates);
    await expect(result).rejects.toBeInstanceOf(InvalidTypeSafeResponseError);
    await expect(result).rejects.not.toThrow("private");
  });

  it.each(["id", "name"] as const)("rejects duplicate candidate %s mapping before network", async (field) => {
    const input = candidates.map((candidate) => ({ ...candidate }));
    input[1][field] = input[0][field];
    const execute = vi.fn(async () => response());
    await expect(new TypeSafeAdapter("unit-test-only", execute).evaluate(note, input))
      .rejects.toBeInstanceOf(InvalidTypeSafeResponseError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects empty candidates before network", async () => {
    const execute = vi.fn(async () => response());
    await expect(new TypeSafeAdapter("unit-test-only", execute).evaluate(note, []))
      .rejects.toBeInstanceOf(NoCandidatesError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("cancels before request", async () => {
    const controller = new AbortController();
    controller.abort("private reason");
    const execute = vi.fn(async () => response());
    await expect(new TypeSafeAdapter("unit-test-only", execute).evaluate(note, candidates, controller.signal))
      .rejects.toBeInstanceOf(ClassificationCancelledError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes cancellation to an in-flight provider and sanitizes rejection", async () => {
    const controller = new AbortController();
    const execute = vi.fn((_request: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
      expect(signal).toBe(controller.signal);
      signal?.addEventListener("abort", () => reject(new Error("private abort reason")), { once: true });
    }));
    const result = new TypeSafeAdapter("unit-test-only", execute).evaluate(note, candidates, controller.signal);
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(ClassificationCancelledError);
    await expect(result).rejects.not.toThrow("private");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("discards a response cancelled before mapping without reading answers", async () => {
    const controller = new AbortController();
    const readAnswers = vi.fn(() => response().answers);
    const execute = vi.fn(async () => {
      controller.abort();
      return { get answers() { return readAnswers(); } };
    });
    await expect(new TypeSafeAdapter("unit-test-only", execute).evaluate(note, candidates, controller.signal))
      .rejects.toBeInstanceOf(ClassificationCancelledError);
    expect(readAnswers).not.toHaveBeenCalled();
  });

  it("discards a result cancelled during mapping", async () => {
    const controller = new AbortController();
    const reply = response();
    reply.answers.q_004 = { ...answer(), get confidence() { controller.abort(); return 0.5; } };
    await expect(new TypeSafeAdapter("unit-test-only", async () => reply).evaluate(note, candidates, controller.signal))
      .rejects.toBeInstanceOf(ClassificationCancelledError);
  });

  it.each([ ["network", NetworkError], ["api", TypeSafeApiError] ] as const)(
    "maps %s failures without exposing provider details", async (kind, errorClass) => {
      const execute = vi.fn(async () => { throw new Error("private provider details"); });
      const result = new TypeSafeAdapter("unit-test-only", execute, () => kind).evaluate(note, candidates);
      await expect(result).rejects.toBeInstanceOf(errorClass);
      await expect(result).rejects.not.toThrow("private");
      expect(execute).toHaveBeenCalledOnce();
    },
  );
});
