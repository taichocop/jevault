import type { TAbstractFile, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => import("./helpers/obsidian-move"));
import { TFile as FakeFile } from "./helpers/obsidian-move";
import { NoteSource } from "../src/note-source";
import type { NoteState } from "../src/note-service";
import { FolderOrganizerService } from "../src/organizer/folder-organizer-service";
import type { FolderOrganizerProgress } from "../src/organizer/organization-analysis-result";
import { OrganizationTargetReader, type OrganizationNoteReadResult } from "../src/organizer/organization-target-reader";
import type { OrganizationTarget } from "../src/organizer/target-file-collector";
import { ClassificationCancelledError } from "../src/classification/classification-cancellation";
import { MissingApiKeyError, NoCandidatesError, NetworkError, TypeSafeApiError, InvalidTypeSafeResponseError } from "../src/classification/classification-errors";
import { ClassificationService, type ClassificationServiceResult } from "../src/classification/classification-service";
import { CandidateBuilder } from "../src/classification/candidate-builder";
import { TagSuggestionService, type TagSuggestionServiceResult } from "../src/tags/tag-suggestion-service";
import { DEFAULT_SETTINGS } from "../src/settings";

const both = Object.freeze({ evaluateFolder: true, evaluateTags: true });
const privateBody = "Synthetic private body sentinel";
function target(path: string): OrganizationTarget {
  const file = Object.assign(new FakeFile(path), { stat: { ctime: 1, mtime: 42, size: 123 } });
  return { source: new NoteSource(file as unknown as TFile), snapshot: { path, mtime: 42, size: 123 } };
}
function folderValue(source: NoteSource): ClassificationServiceResult {
  return { status: "success", noteTitle: "Synthetic", source,
    result: { candidates: [{ path: "Archive", probability: 0.7 }], providerConfidence: 0.8 } };
}
function tagValue(source: NoteSource): TagSuggestionServiceResult {
  return { status: "success", noteTitle: "Synthetic", source,
    suggestions: [{ tagId: "tag_001", tagName: "#existing", choice: "match", matchProbability: 0.9, providerConfidence: 0.6 }] };
}
function harness() {
  const targets = [target("Inbox/B.md"), target("Inbox/A.md")];
  const events: string[] = [];
  const notes: Readonly<NoteState>[] = [];
  const progress: FolderOrganizerProgress[] = [];
  const read = vi.fn(async (t: OrganizationTarget, _signal?: AbortSignal): Promise<OrganizationNoteReadResult> => {
    void _signal;
    events.push(`read:${t.snapshot.path}`);
    const note = Object.freeze({ title: "Synthetic", path: t.snapshot.path, body: privateBody });
    notes.push(note);
    return { status: "ready", source: t.source, snapshot: t.snapshot, note };
  });
  const classifyNote = vi.fn(async (note: Readonly<NoteState>, source: NoteSource, _signal?: AbortSignal) => {
    void _signal;
    events.push(`folder:${note.path}`); return folderValue(source);
  });
  const suggestForNote = vi.fn(async (note: Readonly<NoteState>, source: NoteSource, _signal?: AbortSignal) => {
    void _signal;
    events.push(`tags:${note.path}`); return tagValue(source);
  });
  const service = new FolderOrganizerService({ read }, { classifyNote }, { suggestForNote });
  const observe = (p: FolderOrganizerProgress) => { progress.push(p); };
  return { targets, events, notes, progress, read, classifyNote, suggestForNote, service, observe };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
afterEach(() => vi.restoreAllMocks());

describe("FolderOrganizerService", () => {
  it("completes empty input without any read or phase work", async () => {
    const h = harness(); const controller = new AbortController(); controller.abort();
    expect(await h.service.analyze([], both, controller.signal, h.observe)).toEqual({
      status: "completed", results: [], progress: { total: 0, processed: 0, failed: 0 },
    });
    expect(h.read).not.toHaveBeenCalled(); expect(h.classifyNote).not.toHaveBeenCalled(); expect(h.suggestForNote).not.toHaveBeenCalled();
  });

  it("preserves supplied order, same NoteState and suggestions with exact read → Folder → Tag counts", async () => {
    const h = harness(); const signal = new AbortController().signal;
    const result = await h.service.analyze(h.targets, both, signal, h.observe);
    expect(h.events).toEqual(["read:Inbox/B.md", "folder:Inbox/B.md", "tags:Inbox/B.md", "read:Inbox/A.md", "folder:Inbox/A.md", "tags:Inbox/A.md"]);
    expect(result.status).toBe("completed");
    expect(result.results.map(r => r.status)).toEqual(["success", "success"]);
    for (let i = 0; i < 2; i++) {
      expect(h.read.mock.calls[i][0].source).toBe(h.targets[i].source);
      expect(h.read.mock.calls[i][1]).toBe(signal);
      expect(h.classifyNote.mock.calls[i]).toEqual([h.notes[i], h.targets[i].source, signal]);
      expect(h.suggestForNote.mock.calls[i][0]).toBe(h.classifyNote.mock.calls[i][0]);
      expect(h.suggestForNote.mock.calls[i].slice(1)).toEqual([h.targets[i].source, signal]);
      expect(result.results[i].folder).toEqual({ status: "success", value: folderValue(h.targets[i].source) });
      expect(result.results[i].tags).toEqual({ status: "success", value: tagValue(h.targets[i].source) });
    }
    expect([h.read.mock.calls.length, h.classifyNote.mock.calls.length, h.suggestForNote.mock.calls.length]).toEqual([2, 2, 2]);
    expect(result.progress).toEqual({ total: 2, processed: 2, failed: 0 });
    expect(h.progress.map(p => p.currentPath)).toEqual([undefined, "Inbox/B.md", undefined, "Inbox/A.md", undefined, undefined]);
  });

  it("does not prefetch or overlap targets or phases while any boundary is in flight", async () => {
    const h = harness();
    const readGate = deferred<OrganizationNoteReadResult>();
    const folderGate = deferred<ClassificationServiceResult>(); const tagGate = deferred<TagSuggestionServiceResult>();
    const folderStarted = deferred<void>(); const tagStarted = deferred<void>();
    h.read.mockImplementationOnce(() => readGate.promise);
    h.classifyNote.mockImplementationOnce(() => { folderStarted.resolve(); return folderGate.promise; });
    h.suggestForNote.mockImplementationOnce(() => { tagStarted.resolve(); return tagGate.promise; });
    const pending = h.service.analyze(h.targets, both);
    expect(h.read).toHaveBeenCalledOnce(); expect(h.classifyNote).not.toHaveBeenCalled();
    const t = h.targets[0];
    readGate.resolve({ status: "ready", source: t.source, snapshot: t.snapshot, note: { title: "Synthetic", path: t.snapshot.path, body: privateBody } });
    await folderStarted.promise;
    expect(h.read).toHaveBeenCalledOnce(); expect(h.classifyNote).toHaveBeenCalledOnce(); expect(h.suggestForNote).not.toHaveBeenCalled();
    folderGate.resolve(folderValue(t.source)); await tagStarted.promise;
    expect(h.read).toHaveBeenCalledOnce(); expect(h.classifyNote).toHaveBeenCalledOnce(); expect(h.suggestForNote).toHaveBeenCalledOnce();
    tagGate.resolve(tagValue(t.source));
    expect((await pending).results).toHaveLength(2);
  });

  it("owns targets before callbacks or awaits can mutate the supplied sequence/snapshot", async () => {
    const h = harness(); const original = h.targets.map(t => ({ source: t.source, snapshot: { ...t.snapshot } }));
    const result = await h.service.analyze(h.targets, both, undefined, () => {
      if (h.targets.length) {
        Object.assign(h.targets[0].snapshot, { path: "Other.md", mtime: 999 });
        h.targets.reverse(); h.targets.length = 0;
      }
    });
    expect(result.results.map(({ source, snapshot }) => ({ source, snapshot }))).toEqual(original);
    expect(h.read.mock.calls.map(([t]) => t.snapshot)).toEqual(original.map(t => t.snapshot));
  });

  it("copies/freezes history and whitelists output without body, raw payload or selection/Apply authority", async () => {
    const h = harness(); const folder = folderValue(h.targets[0].source); const tags = tagValue(h.targets[0].source);
    Object.assign(folder, { body: privateBody, apiKey: "Synthetic secret sentinel", rawResponse: "Synthetic raw sentinel" });
    Object.assign(folder.result.candidates[0], { rawResponse: "Synthetic raw sentinel" });
    Object.assign(tags, { body: privateBody, evaluationProvenance: Object.freeze({}), selectedTags: ["#existing"] });
    h.classifyNote.mockResolvedValue(folder); h.suggestForNote.mockResolvedValue(tags);
    const result = await h.service.analyze(h.targets, both, undefined, h.observe);
    folder.result.candidates[0].probability = 0; folder.result.candidates.push({ path: "Changed", probability: 1 });
    Object.assign(tags.suggestions[0], { tagName: "#changed" });
    const first = result.results[0];
    expect(first.folder).toEqual({ status: "success", value: folderValue(h.targets[0].source) });
    expect(first.tags).toEqual({ status: "success", value: tagValue(h.targets[0].source) });
    const assertFrozen = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value)) assertFrozen(child);
    };
    assertFrozen(result); assertFrozen(h.progress[0]);
    const serialized = JSON.stringify([result, h.progress]);
    for (const forbidden of [privateBody, "Synthetic secret sentinel", "Synthetic raw sentinel", "body", "apiKey", "rawResponse", "evaluationProvenance", "selectedFolderPath", "selectedTags", "reviewStatus", "confirmation", "CachedMetadata"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(() => Object.assign(result.progress, { failed: 99 })).toThrow();
  });

  it.each(["source-changed", "read-failed"] as const)("continues only after target-local %s and emits monotonic progress", async reason => {
    const h = harness(); h.read.mockResolvedValueOnce({ status: "failure", reason });
    const result = await h.service.analyze(h.targets, both, undefined, h.observe);
    expect(result.status).toBe("completed"); expect(result.results.map(r => r.status)).toEqual(["failed", "success"]);
    expect(result.results[0]).toMatchObject({ readFailure: reason, folder: { status: "not-run", reason: "prior-failure" }, tags: { status: "not-run", reason: "prior-failure" } });
    expect(h.read).toHaveBeenCalledTimes(2); expect(h.classifyNote).toHaveBeenCalledOnce(); expect(h.suggestForNote).toHaveBeenCalledOnce();
    expect(result.progress).toEqual({ total: 2, processed: 2, failed: 1 });
    h.progress.forEach((p, i) => {
      expect(Object.isFrozen(p)).toBe(true); expect(p.total).toBe(2);
      expect(p.failed).toBeLessThanOrEqual(p.processed); expect(p.processed).toBeLessThanOrEqual(p.total);
      if (i) { expect(p.processed).toBeGreaterThanOrEqual(h.progress[i - 1].processed); expect(p.failed).toBeGreaterThanOrEqual(h.progress[i - 1].failed); }
    });
  });

  const errors = [
    [new MissingApiKeyError(), "missing-api-key"], [new NoCandidatesError(), "no-candidates"],
    [new NetworkError(), "network"], [new TypeSafeApiError(), "typesafe-api"],
    [new InvalidTypeSafeResponseError(), "invalid-response"],
    [new Error(`${privateBody} Synthetic secret sentinel /private/synthetic/path`), "unexpected-error"],
  ] as const;
  it.each(errors)("stops on Folder %s without Tag, next target or retry (%s)", async (error, reason) => {
    const h = harness(); h.classifyNote.mockRejectedValue(error);
    const result = await h.service.analyze(h.targets, both);
    expect(result).toMatchObject({ status: "stopped", reason, progress: { total: 2, processed: 1, failed: 1 } });
    expect(result.results[0]).toMatchObject({ status: "failed", folder: { status: "failure", reason }, tags: { status: "not-run", reason: "prior-failure" } });
    expect(h.read).toHaveBeenCalledOnce(); expect(h.classifyNote).toHaveBeenCalledOnce(); expect(h.suggestForNote).not.toHaveBeenCalled();
    expect(result.progress).not.toHaveProperty("currentPath"); expect(JSON.stringify(result)).not.toContain(privateBody);
  });
  it.each(errors)("preserves Folder success and stops partial on Tag %s (%s)", async (error, reason) => {
    const h = harness(); h.suggestForNote.mockRejectedValue(error);
    const result = await h.service.analyze(h.targets, both);
    expect(result).toMatchObject({ status: "stopped", reason, progress: { processed: 1, failed: 1 } });
    expect(result.results[0]).toMatchObject({ status: "partial", folder: { status: "success", value: folderValue(h.targets[0].source) }, tags: { status: "failure", reason } });
    expect(h.read).toHaveBeenCalledOnce(); expect(h.classifyNote).toHaveBeenCalledOnce(); expect(h.suggestForNote).toHaveBeenCalledOnce();
  });

  it("preserves earlier completed results on a later systemic failure", async () => {
    const h = harness(); h.suggestForNote.mockResolvedValueOnce(tagValue(h.targets[0].source)).mockRejectedValueOnce(new NetworkError());
    h.targets.push(target("Inbox/C.md"));
    const result = await h.service.analyze(h.targets, both);
    expect(result.status).toBe("stopped"); expect(result.results.map(r => r.status)).toEqual(["success", "partial"]);
    expect(result.progress).toEqual({ total: 3, processed: 2, failed: 1 }); expect(h.read).toHaveBeenCalledTimes(2);
  });

  it("pre-abort starts no work and retains no abort reason", async () => {
    const h = harness(); const c = new AbortController(); c.abort(privateBody);
    expect(await h.service.analyze(h.targets, both, c.signal)).toEqual({ status: "cancelled", results: [], progress: { total: 2, processed: 0, failed: 0 } });
    expect(h.read).not.toHaveBeenCalled(); expect(h.classifyNote).not.toHaveBeenCalled(); expect(h.suggestForNote).not.toHaveBeenCalled();
  });
  it.each(["initial", "current-path", "between-targets"])("honors observer cancellation at %s", async boundary => {
    const h = harness(); const c = new AbortController();
    const result = await h.service.analyze(h.targets, both, c.signal, p => {
      h.observe(p);
      if ((boundary === "initial" && p.currentPath === undefined && p.processed === 0) ||
        (boundary === "current-path" && p.currentPath !== undefined) ||
        (boundary === "between-targets" && p.processed === 1)) c.abort();
    });
    expect(result.status).toBe("cancelled"); expect(result.progress.failed).toBe(0);
    const count = boundary === "between-targets" ? 1 : 0;
    expect(result.results).toHaveLength(count); expect(h.read).toHaveBeenCalledTimes(count);
    expect(h.classifyNote).toHaveBeenCalledTimes(count); expect(h.suggestForNote).toHaveBeenCalledTimes(count);
    if (count) expect(result.results[0].status).toBe("success");
  });
  it.each(["read", "folder", "tags"] as const)("retains completed phase truth when abort follows %s", async phase => {
    const h = harness(); const c = new AbortController();
    if (phase === "read") h.read.mockImplementationOnce(async t => {
      c.abort(); return { status: "ready", source: t.source, snapshot: t.snapshot, note: { title: "Synthetic", path: t.snapshot.path, body: privateBody } };
    });
    if (phase === "folder") h.classifyNote.mockImplementationOnce(async (_note, source) => { c.abort(); return folderValue(source); });
    if (phase === "tags") h.suggestForNote.mockImplementationOnce(async (_note, source) => { c.abort(); return tagValue(source); });
    const result = await h.service.analyze(h.targets, both, c.signal);
    expect(result.status).toBe("cancelled"); expect(result.progress).toEqual({ total: 2, processed: 1, failed: 0 });
    expect(result.results[0].status).toBe(phase === "tags" ? "success" : "cancelled");
    expect(h.read).toHaveBeenCalledOnce(); expect(h.classifyNote).toHaveBeenCalledTimes(phase === "read" ? 0 : 1);
    expect(h.suggestForNote).toHaveBeenCalledTimes(phase === "tags" ? 1 : 0);
    if (phase === "folder") expect(result.results[0]).toMatchObject({ folder: { status: "success" }, tags: { status: "not-run", reason: "cancelled" } });
  });
  it.each(["read", "folder", "tags"] as const)("recognizes typed cancellation from %s independently of signal", async phase => {
    const h = harness(); const error = new ClassificationCancelledError();
    if (phase === "read") h.read.mockResolvedValueOnce({ status: "cancelled" });
    if (phase === "folder") h.classifyNote.mockRejectedValueOnce(error);
    if (phase === "tags") h.suggestForNote.mockRejectedValueOnce(error);
    const result = await h.service.analyze(h.targets, both);
    expect(result.status).toBe("cancelled"); expect(result.progress.failed).toBe(0); expect(h.read).toHaveBeenCalledOnce();
    if (phase === "tags") expect(result.results[0].folder.status).toBe("success");
  });
  it.each(["read", "folder", "tags"] as const)("does not pretend to interrupt in-flight %s and starts no later work", async phase => {
    const h = harness(); const c = new AbortController(); const started = deferred<void>(); const gate = deferred<never>();
    const hold = () => { started.resolve(); return gate.promise; };
    if (phase === "read") h.read.mockImplementationOnce(hold);
    if (phase === "folder") h.classifyNote.mockImplementationOnce(hold);
    if (phase === "tags") h.suggestForNote.mockImplementationOnce(hold);
    let settled = false;
    const pending = h.service.analyze(h.targets, both, c.signal).then(r => { settled = true; return r; });
    await started.promise; c.abort(); await Promise.resolve();
    expect(settled).toBe(false); expect(h.read).toHaveBeenCalledOnce();
    gate.reject(new NetworkError()); const result = await pending;
    expect(result.status).toBe("cancelled"); expect(result.progress.failed).toBe(0);
    expect(h.read).toHaveBeenCalledOnce();
    expect(h.classifyNote).toHaveBeenCalledTimes(phase === "read" ? 0 : 1);
    expect(h.suggestForNote).toHaveBeenCalledTimes(phase === "tags" ? 1 : 0);
  });
  it("sanitizes unexpected reader/observer errors and stops without logging or network", async () => {
    const h = harness(); const log = vi.spyOn(console, "log"), warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error");
    const fetch = vi.spyOn(globalThis, "fetch");
    h.read.mockRejectedValueOnce(new Error(privateBody));
    const result = await h.service.analyze(h.targets, both);
    expect(result).toMatchObject({ status: "stopped", reason: "unexpected-error" });
    expect(result.results[0].readFailure).toBe("unexpected-error"); expect(JSON.stringify(result)).not.toContain(privateBody);
    h.read.mockClear();
    const observerResult = await h.service.analyze(h.targets, both, undefined, () => { throw new Error(privateBody); });
    expect(observerResult).toMatchObject({ status: "stopped", reason: "unexpected-error", results: [] }); expect(h.read).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

it("connects real #92 boundaries with one exact Vault.read per Note, no active fallback/Secret on empty input/mutation", async () => {
  const file = Object.assign(new FakeFile("Inbox/Exact.md"), { stat: { ctime: 1, mtime: 42, size: 123 } });
  const source = new NoteSource(file as unknown as TFile);
  const t = { source, snapshot: { path: source.path, mtime: 42, size: 123 } };
  const forbidden = vi.fn(() => { throw new Error("Forbidden synthetic operation"); });
  let activePath = "Unrelated.md";
  const getActiveNoteState = vi.fn(async () => ({ status: "ready" as const, source,
    note: { title: "Unrelated", path: activePath, body: "Synthetic unrelated body" } }));
  const vault = { getAbstractFileByPath: () => file as unknown as TAbstractFile,
    read: vi.fn(async () => { activePath = "Switched.md"; return privateBody; }),
    modify: forbidden, create: forbidden, createFolder: forbidden, delete: forbidden, renameFile: forbidden, processFrontMatter: forbidden };
  const getApiKey = vi.fn(() => "synthetic-only");
  const classify = vi.fn(async () => ({ candidates: [{ path: "Archive", probability: 1 }] }));
  const evaluate = vi.fn(async () => ({ evaluations: [{ tagId: "tag_001", tagName: "#existing", choice: "match" as const, matchProbability: 1 }] }));
  const folders = new ClassificationService({ getActiveNoteState }, { getAvailableFolderPaths: () => ["Archive"] },
    new CandidateBuilder(), { getApiKey }, () => ({ classify }), () => DEFAULT_SETTINGS);
  const tags = new TagSuggestionService({ getActiveNoteState }, { discover: () => [{ id: "tag_001", name: "#existing" }] },
    { getApiKey }, () => ({ evaluate }), () => DEFAULT_SETTINGS);
  const service = new FolderOrganizerService(new OrganizationTargetReader(vault), folders, tags);
  await service.analyze([], both);
  expect(getApiKey).not.toHaveBeenCalled(); expect(vault.read).not.toHaveBeenCalled();
  const result = await service.analyze([t], both);
  expect(result.results[0].status).toBe("success"); expect(vault.read).toHaveBeenCalledExactlyOnceWith(file);
  expect(classify).toHaveBeenCalledOnce(); expect(evaluate).toHaveBeenCalledOnce(); expect(getApiKey).toHaveBeenCalledTimes(2);
  expect(classify.mock.calls[0]).toEqual([expect.objectContaining({ body: privateBody, path: t.snapshot.path }), expect.any(Array), undefined]);
  expect(evaluate.mock.calls[0]).toEqual([expect.objectContaining({ body: privateBody, path: t.snapshot.path }), expect.any(Array), undefined]);
  expect(getActiveNoteState).not.toHaveBeenCalled(); expect(forbidden).not.toHaveBeenCalled();
  expect(activePath).toBe("Switched.md");
  expect(JSON.stringify(result)).not.toContain(privateBody); expect(JSON.stringify(result)).not.toContain("synthetic-only");
});

const singleModes = [
  { evaluateFolder: true, evaluateTags: false },
  { evaluateFolder: false, evaluateTags: true },
] as const;
describe("run-level analysis options (#99)", () => {
  it.each(singleModes)("runs enabled work only: %j", async options => {
    const h = harness();
    const result = await h.service.analyze(h.targets, options, undefined, h.observe);
    expect(h.events).toEqual(h.targets.flatMap(t => [`read:${t.snapshot.path}`, `${options.evaluateFolder ? "folder" : "tags"}:${t.snapshot.path}`]));
    expect(result.status).toBe("completed");
    expect(result.progress).toEqual({ total: 2, processed: 2, failed: 0 });
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.classifyNote).toHaveBeenCalledTimes(options.evaluateFolder ? 2 : 0);
    expect(h.suggestForNote).toHaveBeenCalledTimes(options.evaluateTags ? 2 : 0);
    for (const note of result.results) {
      expect(note.status).toBe("success");
      expect(options.evaluateFolder ? note.tags : note.folder).toEqual({ status: "not-run", reason: "disabled" });
      expect(options.evaluateFolder ? note.folder.status : note.tags.status).toBe("success");
    }
  });

  it.each([[], harness().targets].map(targets => ({ targets })))("rejects both false before target work, even empty: %j", async ({ targets }) => {
    const h = harness(); const c = new AbortController(); c.abort();
    const result = await h.service.analyze(targets, { evaluateFolder: false, evaluateTags: false }, c.signal, h.observe);
    expect(result).toEqual({ status: "stopped", reason: "invalid-options", results: [], progress: { total: targets.length, processed: 0, failed: 0 } });
    expect(h.progress).toEqual([result.progress]);
    expect(h.read).not.toHaveBeenCalled(); expect(h.classifyNote).not.toHaveBeenCalled(); expect(h.suggestForNote).not.toHaveBeenCalled();
  });

  it.each(singleModes)("owns option values before observer callbacks and await: %j", async initial => {
    const h = harness(); const options = { ...initial };
    const result = await h.service.analyze(h.targets, options, undefined, () => {
      options.evaluateFolder = !initial.evaluateFolder; options.evaluateTags = !initial.evaluateTags;
    });
    expect(result.results.every(note => note.status === "success")).toBe(true);
    expect(h.classifyNote).toHaveBeenCalledTimes(initial.evaluateFolder ? 2 : 0);
    expect(h.suggestForNote).toHaveBeenCalledTimes(initial.evaluateTags ? 2 : 0);
  });

  for (const options of singleModes) {
    const enabled = options.evaluateFolder ? "folder" : "tags";
    const disabled = options.evaluateFolder ? "tags" : "folder";
    it.each(["source-changed", "read-failed", "throw"] as const)(`${enabled}-only preserves disabled truth on read %s`, async reason => {
      const h = harness();
      if (reason === "throw") h.read.mockRejectedValueOnce(new Error(privateBody));
      else h.read.mockResolvedValueOnce({ status: "failure", reason });
      const result = await h.service.analyze(h.targets, options);
      expect(result.status).toBe(reason === "throw" ? "stopped" : "completed");
      expect(result.results[0].status).toBe("failed");
      expect(result.results[0][enabled]).toEqual({ status: "not-run", reason: "prior-failure" });
      expect(result.results[0][disabled]).toEqual({ status: "not-run", reason: "disabled" });
      expect(result.progress.failed).toBe(1);
      expect(JSON.stringify(result)).not.toContain(privateBody);
    });
    it.each([
      [new MissingApiKeyError(), "missing-api-key"], [new NoCandidatesError(), "no-candidates"],
      [new NetworkError(), "network"], [new TypeSafeApiError(), "typesafe-api"],
      [new InvalidTypeSafeResponseError(), "invalid-response"], [new Error(privateBody), "unexpected-error"],
    ] as const)(`${enabled}-only stops on %s without disabled work/retry`, async (error, reason) => {
      const h = harness();
      (options.evaluateFolder ? h.classifyNote : h.suggestForNote).mockRejectedValueOnce(error);
      const result = await h.service.analyze(h.targets, options);
      expect(result).toMatchObject({ status: "stopped", reason, progress: { total: 2, processed: 1, failed: 1 } });
      expect(result.results[0].status).toBe("failed");
      expect(result.results[0][enabled]).toEqual({ status: "failure", reason });
      expect(result.results[0][disabled]).toEqual({ status: "not-run", reason: "disabled" });
      expect(h.read).toHaveBeenCalledOnce();
      expect(h.classifyNote).toHaveBeenCalledTimes(options.evaluateFolder ? 1 : 0);
      expect(h.suggestForNote).toHaveBeenCalledTimes(options.evaluateTags ? 1 : 0);
    });
    it(`${enabled}-only preserves success when abort follows completed enabled work`, async () => {
      const h = harness(); const c = new AbortController();
      if (options.evaluateFolder) h.classifyNote.mockImplementationOnce(async (_note, source) => { c.abort(); return folderValue(source); });
      else h.suggestForNote.mockImplementationOnce(async (_note, source) => { c.abort(); return tagValue(source); });
      const result = await h.service.analyze(h.targets, options, c.signal);
      expect(result.status).toBe("cancelled"); expect(result.progress).toEqual({ total: 2, processed: 1, failed: 0 });
      expect(result.results[0].status).toBe("success"); expect(h.read).toHaveBeenCalledOnce();
      expect(result.results[0][disabled]).toEqual({ status: "not-run", reason: "disabled" });
    });
    it(`${enabled}-only records cancelled before enabled work, without phantom disabled work`, async () => {
      const h = harness(); const c = new AbortController();
      h.read.mockImplementationOnce(async t => {
        c.abort(); return { status: "ready", source: t.source, snapshot: t.snapshot, note: { title: "Synthetic", path: t.snapshot.path, body: privateBody } };
      });
      const result = await h.service.analyze(h.targets, options, c.signal);
      expect(result.status).toBe("cancelled"); expect(result.results[0].status).toBe("cancelled");
      expect(result.results[0][enabled]).toEqual({ status: "not-run", reason: "cancelled" });
      expect(result.results[0][disabled]).toEqual({ status: "not-run", reason: "disabled" });
      expect(h.read).toHaveBeenCalledOnce(); expect(h.classifyNote).not.toHaveBeenCalled(); expect(h.suggestForNote).not.toHaveBeenCalled();
    });
    it(`${enabled}-only successful empty suggestions remain success rather than disabled`, async () => {
      const h = harness();
      h.classifyNote.mockResolvedValue({ ...folderValue(h.targets[0].source), result: { candidates: [] } });
      h.suggestForNote.mockResolvedValue({ ...tagValue(h.targets[0].source), suggestions: [] });
      const result = await h.service.analyze(h.targets, options);
      expect(result.results[0][enabled].status).toBe("success");
      expect(result.results[0][disabled]).toEqual({ status: "not-run", reason: "disabled" });
      expect(result.progress.failed).toBe(0);
    });
  }
});
