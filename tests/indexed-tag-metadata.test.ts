import { getAllTags, parseFrontMatterTags, type CachedMetadata, type EventRef, type MetadataCache, type TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteSource } from "../src/note-source";
import { captureEvaluationProvenance, fingerprintContent, sameContent, type ContentProvenance, type EvaluationProvenance } from "../src/tags/evaluation-provenance";
import { IndexedTagMetadataTracker } from "../src/tags/indexed-tag-metadata";
import { TagApplyAuthorizationService } from "../src/tags/tag-apply-authorization";
import { TagApplyPreparationSession } from "../src/tags/tag-apply-preparation";
import { classifyTagSuggestionFreshness } from "../src/tags/tag-suggestion-freshness";
import { TagSuggestionGrantIssuer } from "../src/tags/tag-suggestion-grant";
import { TagApplyService } from "../src/tags/tag-apply-service";
import { TFile as FakeFile } from "./helpers/obsidian-move";

vi.mock("obsidian", async () => ({
  TFile: (await import("./helpers/obsidian-move")).TFile,
  getAllTags: vi.fn(), parseFrontMatterTags: vi.fn(),
}));

function file(path = "Synthetic/A.md") {
  return Object.assign(new FakeFile(path), { stat: { ctime: 1, mtime: 2, size: 100 } }) as TFile;
}

function harness() {
  const original = file();
  const files = new Map([[original.path, original]]);
  const forbidden = vi.fn(() => { throw new Error("Forbidden cache/read/network/storage boundary"); });
  const vault = { getFileByPath: vi.fn((path: string) => files.get(path) ?? null), read: forbidden, cachedRead: forbidden };
  let listener!: (file: TFile, data: string, cache: CachedMetadata) => void;
  const metadata = {
    on: vi.fn((_name: string, callback: typeof listener) => { listener = callback; return {} as EventRef; }),
    offref: vi.fn(), getFileCache: forbidden,
  };
  const tracker = new IndexedTagMetadataTracker(vault, metadata as unknown as Pick<MetadataCache, "on" | "offref">, new NoteSource(original));
  const capture = new TagApplyAuthorizationService(vault, tracker);
  const frontmatter: Record<string, unknown> = {};
  const fileManager = { processFrontMatter: vi.fn(async (_file: TFile, callback: (fm: Record<string, unknown>) => void) => callback(frontmatter)) };
  const apply = new TagApplyService(vault, fileManager);
  const issuer = new TagSuggestionGrantIssuer(vault);
  const confirm = (outcome: Awaited<ReturnType<typeof evaluate>>) => {
    const success = { ...outcome, status: "success" as const, noteTitle: "Synthetic" };
    const session = new TagApplyPreparationSession(vault, { on: () => ({} as EventRef), offref: () => undefined }, original);
    session.prepare(success, issuer.issue(success));
    const confirmation = session.confirm(["#aws"]);
    if (!confirmation) throw new Error("Synthetic confirmation failed");
    return confirmation;
  };
  const tags = new WeakMap<object, string[]>();
  vi.mocked(getAllTags).mockReset().mockImplementation((cache) => tags.get(cache) ?? []);
  vi.mocked(parseFrontMatterTags).mockReset().mockReturnValue([]);
  function cache(names: string[] = []) {
    const value: CachedMetadata = {};
    tags.set(value, names);
    return value;
  }
  function emit(data: string, metadataCache = cache(), target = original) {
    listener(target, data, metadataCache);
    return metadataCache;
  }
  async function evaluate(body = "OLD", target = original) {
    const source = new NoteSource(target);
    const evaluationProvenance = await captureEvaluationProvenance(source, body);
    return { source, evaluationProvenance, suggestions: [{ tagName: "#aws", tagId: "synthetic", choice: "match" as const, matchProbability: 1 }] };
  }
  return { original, files, vault, metadata, tracker, capture, apply, fileManager, forbidden, evaluate, emit, cache, tags, frontmatter, confirm };
}

afterEach(() => vi.unstubAllGlobals());

describe("evaluation content provenance", () => {
  it("uses SHA-256 with exact code units, preserving Unicode, line endings and surrogate differences", async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    try {
      const original = await fingerprintContent("Synthetic é\n");
      const equal = await fingerprintContent("Synthetic é\n");
      expect(original).toBeDefined(); expect(equal).toBeDefined();
      expect(sameContent(original!, equal!)).toBe(true);
      for (const text of ["Synthetic e\u0301\n", "Synthetic é\r\n", "Synthetic É\n"]) {
        expect(sameContent(original!, (await fingerprintContent(text))!)).toBe(false);
      }
      expect(sameContent((await fingerprintContent("\ud800"))!, (await fingerprintContent("\ud801"))!)).toBe(false);
      expect(digest).toHaveBeenCalledWith("SHA-256", expect.any(Uint8Array));
      expect(JSON.stringify(original)).toBe("{}");
    } finally { digest.mockRestore(); }
  });
  it("fails closed when crypto is unavailable, with no weak-hash fallback", async () => {
    vi.stubGlobal("crypto", undefined);
    expect(await fingerprintContent("Synthetic private content")).toBeUndefined();
    const source = new NoteSource(file());
    expect(await captureEvaluationProvenance(source, "Synthetic private content")).toBeUndefined();
  });
});

describe("IndexedTagMetadataTracker", () => {
  it("retains one event pair independently of evaluation, with frozen copies and opaque content", async () => {
    const h = harness(); const outcome = await h.evaluate("A");
    const body = "PRIVATE_SYNTHETIC_B_BODY";
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const names = ["#B"], fmNames = ["#frontmatterB"];
      vi.mocked(parseFrontMatterTags).mockReturnValue(fmNames);
      const cache = h.cache(names);
      Object.assign(cache, { privateCacheMarker: "PRIVATE_CACHE", frontmatter: { tags: ["frontmatterB"] } });
      h.emit(body, cache);
      names.push("#late"); fmNames.push("#late");
      await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
      const observation = h.tracker.observation(outcome.source)!;
      expect(observation.source).toBe(outcome.source);
      expect(observation.existingTags).toEqual(["#B"]);
      expect(observation.frontmatterTags).toEqual(["#frontmatterB"]);
      for (const value of [observation, observation.revision, observation.existingTags, observation.frontmatterTags, observation.content]) {
        expect(Object.isFrozen(value)).toBe(true);
      }
      expect(() => (observation.existingTags as string[]).push("#forged")).toThrow(TypeError);
      expect(() => (observation.frontmatterTags as string[]).push("#forged")).toThrow(TypeError);
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, observation)).toBe("changed");
      expect(classifyTagSuggestionFreshness(outcome.source, undefined, observation)).toBe("unknown");
      expect(h.capture.capture(outcome)).toEqual({ status: "failure", reason: "metadata-stale" });
      const bytes = await digest.mock.results[0].value;
      const rawDigest = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
      for (const privateValue of [body, rawDigest, "PRIVATE_CACHE"]) {
        expect(JSON.stringify(observation)).not.toContain(privateValue);
      }
      expect(JSON.stringify(observation.content)).toBe("{}");
      expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
      expect(h.forbidden).not.toHaveBeenCalled(); expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    } finally { digest.mockRestore(); log.mockRestore(); error.mockRestore(); h.tracker.dispose(); }
  });
  it("ignores unrelated and replacement events before every expensive helper", () => {
    const h = harness(); const source = new NoteSource(h.original);
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    try {
      h.emit("B", h.cache(), file("Synthetic/B.md"));
      const replacement = file(h.original.path); h.files.set(replacement.path, replacement);
      h.emit("replacement", h.cache(), replacement);
      h.emit("original after replacement", h.cache());
      expect(digest).not.toHaveBeenCalled(); expect(getAllTags).not.toHaveBeenCalled();
      expect(parseFrontMatterTags).not.toHaveBeenCalled(); expect(h.tracker.observation(source)).toBeUndefined();
    } finally { digest.mockRestore(); h.tracker.dispose(); }
  });
  it.each(["rename", "move", "delete", "replacement", "non-md", "mtime", "size", "lookup-error"])(
    "invalidates an established observation for %s", async change => {
      const h = harness(); const outcome = await h.evaluate(); h.emit("OLD");
      await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
      const retained = h.tracker.observation(outcome.source)!;
      if (change === "rename" || change === "move") h.original.path = "Elsewhere/Renamed.md";
      if (change === "delete") h.files.delete(h.original.path);
      if (change === "replacement") h.files.set(h.original.path, file(h.original.path));
      if (change === "non-md") h.original.extension = "txt";
      if (change === "mtime" || change === "size") h.original.stat[change]++;
      if (change === "lookup-error") h.vault.getFileByPath.mockImplementation(() => { throw new Error("PRIVATE_LOOKUP_ERROR"); });
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, retained)).toBe("unknown");
      expect(h.tracker.observation(outcome.source)).toBeUndefined();
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, h.tracker.observation(outcome.source))).toBe("unknown");
      h.tracker.dispose();
    },
  );
  it("invalidates immediately while the new fingerprint is pending and never falls back after failure", async () => {
    const h = harness(); const outcome = await h.evaluate(); h.emit("OLD");
    await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
    let fail!: (error: unknown) => void;
    const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    try {
      h.emit("NEW");
      expect(h.tracker.observation(outcome.source)).toBeUndefined();
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, h.tracker.observation(outcome.source))).toBe("unknown");
      fail(new Error("PRIVATE_DIGEST_FAILURE"));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(h.tracker.observation(outcome.source)).toBeUndefined();
      expect(h.tracker.snapshot(outcome.source, outcome.evaluationProvenance)).toEqual({ status: "failure", reason: "freshness-unverified" });
      expect(h.forbidden).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); h.tracker.dispose(); }
  });
  it.each(["OLD", "NEW"])("expires retained %s observations across generations and disposal", async body => {
    const h = harness(); const outcome = await h.evaluate("OLD"); h.emit(body);
    await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
    const classify = (observation: ReturnType<typeof h.tracker.observation>) =>
      classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, observation);
    const old = h.tracker.observation(outcome.source)!;
    expect(classify(old)).toBe(body === "OLD" ? "matching" : "changed");
    const realDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const complete: (() => Promise<void>)[] = [];
    const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, bytes) =>
      new Promise<ArrayBuffer>(resolve => { complete.push(async () => resolve(await realDigest(algorithm, bytes))); }));
    try {
      h.emit("NEW", h.cache(["#new"]));
      expect(classify(old)).toBe("unknown"); expect(h.tracker.observation(outcome.source)).toBeUndefined();
      await complete[0]();
      await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
      const newer = h.tracker.observation(outcome.source)!;
      expect(classify(newer)).toBe("changed"); expect(classify(old)).toBe("unknown");
      h.emit("OLD"); expect(classify(newer)).toBe("unknown");
      h.tracker.dispose(); h.tracker.dispose();
      await complete[1](); await Promise.resolve(); await Promise.resolve();
      expect(classify(old)).toBe("unknown"); expect(classify(newer)).toBe("unknown");
      expect(h.tracker.observation(outcome.source)).toBeUndefined(); expect(h.metadata.offref).toHaveBeenCalledOnce();
    } finally { spy.mockRestore(); h.tracker.dispose(); }
  });
  it.each(["OLD", "NEW"])("disposal immediately expires a retained %s observation", async body => {
    const h = harness(); const outcome = await h.evaluate("OLD"); h.emit(body);
    await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
    const observation = h.tracker.observation(outcome.source)!;
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, observation)).toBe(body === "OLD" ? "matching" : "changed");
    h.tracker.dispose();
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, observation)).toBe("unknown");
  });
  it.each(["rename", "move", "delete", "replacement", "non-md", "mtime", "size", "lookup-error"])(
    "does not revive an observed invalid %s generation after restoration without a new event", async change => {
      const h = harness(); const outcome = await h.evaluate(); h.emit("OLD");
      await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
      const old = h.tracker.observation(outcome.source)!, path = h.original.path;
      if (change === "rename" || change === "move") h.original.path = "Elsewhere/Renamed.md";
      if (change === "delete") h.files.delete(path);
      if (change === "replacement") h.files.set(path, file(path));
      if (change === "non-md") h.original.extension = "txt";
      if (change === "mtime" || change === "size") h.original.stat[change]++;
      if (change === "lookup-error") h.vault.getFileByPath.mockImplementation(() => { throw new Error("PRIVATE_LOOKUP_ERROR"); });
      // getterだけで検出した失効も、同じrecordの全observationに共有される。
      expect(h.tracker.observation(outcome.source)).toBeUndefined();
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, old)).toBe("unknown");
      h.original.path = path; h.original.extension = "md"; h.original.stat.mtime = 2; h.original.stat.size = 100;
      h.files.set(path, h.original);
      h.vault.getFileByPath.mockImplementation(path => h.files.get(path) ?? null);
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, old)).toBe("unknown");
      expect(h.tracker.observation(outcome.source)).toBeUndefined();
      expect(h.capture.capture(outcome).status).toBe("captured");
      h.emit("OLD"); await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, h.tracker.observation(outcome.source))).toBe("matching");
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, old)).toBe("unknown");
      h.tracker.dispose();
    },
  );
  it("expires the shared generation when only a retained observation detects invalidity", async () => {
    const h = harness(); const outcome = await h.evaluate(); h.emit("OLD");
    await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
    const first = h.tracker.observation(outcome.source)!, second = h.tracker.observation(outcome.source)!;
    h.original.stat.mtime++;
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, first)).toBe("unknown");
    h.original.stat.mtime--;
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, second)).toBe("unknown");
    expect(h.tracker.observation(outcome.source)).toBeUndefined(); h.tracker.dispose();
  });
  it.each([
    ["OLD", "Synthetic/Renamed.md"], ["NEW", "Synthetic/Renamed.md"],
    ["OLD", "Elsewhere/A.md"], ["NEW", "Elsewhere/A.md"],
  ])("expires a %s observation on an off-path event at %s before any getter", async (body, movedPath) => {
    const h = harness(); const outcome = await h.evaluate(); h.emit(body);
    await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
    const first = h.tracker.observation(outcome.source)!, second = h.tracker.observation(outcome.source)!;
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, first)).toBe(body === "OLD" ? "matching" : "changed");
    const path = h.original.path;
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    vi.mocked(getAllTags).mockClear(); vi.mocked(parseFrontMatterTags).mockClear();
    try {
      h.files.delete(path); h.original.path = movedPath; h.files.set(movedPath, h.original);
      h.original.stat.mtime++; h.original.stat.size++;
      h.emit("PRIVATE_OFF_PATH_BODY", h.cache(["#offpath"]));
      expect(digest).not.toHaveBeenCalled(); expect(getAllTags).not.toHaveBeenCalled();
      expect(parseFrontMatterTags).not.toHaveBeenCalled();
      // 無効な区間でgetter/classifierを呼ばずにpath/statを戻す。
      h.files.delete(movedPath); h.original.path = path; h.files.set(path, h.original);
      h.original.stat.mtime--; h.original.stat.size--;
      for (const observation of [first, second]) {
        expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, observation)).toBe("unknown");
        expect(JSON.stringify(observation)).not.toContain("PRIVATE_OFF_PATH_BODY");
      }
      expect(h.tracker.observation(outcome.source)).toBeUndefined();
      if (body === "OLD") expect(h.capture.capture(outcome).status).toBe("captured");
      else expect(h.capture.capture(outcome)).toEqual({ status: "failure", reason: "metadata-stale" });
      h.emit("OLD", h.cache(["#restored"]));
      await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
      const latest = h.tracker.observation(outcome.source)!;
      expect(latest.existingTags).toEqual(["#restored"]);
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, latest)).toBe("matching");
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, first)).toBe("unknown");
      expect(h.forbidden).not.toHaveBeenCalled(); expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    } finally { digest.mockRestore(); h.tracker.dispose(); }
  });
  it("does not revive a pending generation after an off-path event and late fingerprint completion", async () => {
    const h = harness(); const outcome = await h.evaluate();
    const realDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    let complete!: () => Promise<void>;
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, bytes) =>
      new Promise<ArrayBuffer>(resolve => { complete = async () => resolve(await realDigest(algorithm, bytes)); }));
    try {
      h.emit("OLD");
      const path = h.original.path; h.original.path = "Elsewhere/A.md";
      h.emit("OFF_PATH"); h.original.path = path;
      expect(digest).toHaveBeenCalledOnce();
      await complete();
      await vi.waitFor(() => expect(h.capture.capture(outcome).status).toBe("captured"));
      expect(h.tracker.observation(outcome.source)).toBeUndefined();
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, h.tracker.observation(outcome.source))).toBe("unknown");
    } finally { digest.mockRestore(); h.tracker.dispose(); }
  });
  it("keeps an established observation when unrelated or replacement objects emit events", async () => {
    const h = harness(); const outcome = await h.evaluate(); h.emit("OLD", h.cache(["#original"]));
    await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
    const observation = h.tracker.observation(outcome.source)!;
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    vi.mocked(getAllTags).mockClear(); vi.mocked(parseFrontMatterTags).mockClear();
    try {
      h.emit("OTHER", h.cache(), file("Synthetic/B.md"));
      h.emit("REPLACEMENT", h.cache(), file(h.original.path));
      expect(digest).not.toHaveBeenCalled(); expect(getAllTags).not.toHaveBeenCalled();
      expect(parseFrontMatterTags).not.toHaveBeenCalled();
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, observation)).toBe("matching");
      expect(h.tracker.observation(outcome.source)?.existingTags).toEqual(["#original"]);
    } finally { digest.mockRestore(); h.tracker.dispose(); }
  });
  it("does not invalidate actual target evidence for a different caller-supplied source", async () => {
    const h = harness(); const outcome = await h.evaluate(); h.emit("OLD");
    await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
    const observation = h.tracker.observation(outcome.source)!, other = new NoteSource(file("Synthetic/B.md"));
    const otherProvenance = await captureEvaluationProvenance(other, "OLD");
    expect(h.tracker.observation(other)).toBeUndefined();
    expect(classifyTagSuggestionFreshness(other, otherProvenance, observation)).toBe("unknown");
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, observation)).toBe("matching");
    expect(h.tracker.observation(outcome.source)).toBeDefined(); h.tracker.dispose();
  });
  it("classifies missing, forged and differently associated provenance as unknown", async () => {
    const h = harness(); const outcome = await h.evaluate();
    expect(h.tracker.observation(outcome.source)).toBeUndefined();
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, undefined)).toBe("unknown");
    h.emit("OLD"); await vi.waitFor(() => expect(h.tracker.observation(outcome.source)).toBeDefined());
    const observation = h.tracker.observation(outcome.source)!;
    const otherSource = new NoteSource(h.original);
    const otherProvenance = await captureEvaluationProvenance(otherSource, "OLD");
    for (const provenance of [undefined, {} as EvaluationProvenance, otherProvenance]) {
      expect(classifyTagSuggestionFreshness(outcome.source, provenance, observation)).toBe("unknown");
    }
    expect(classifyTagSuggestionFreshness(otherSource, otherProvenance, observation)).toBe("unknown");
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, { ...observation, content: {} as ContentProvenance })).toBe("unknown");
    // token自体は正規でも、copied/別sourceのdata/cache関連付けは証明できない。
    for (const content of [observation.content, (await fingerprintContent("OLD"))!, (await fingerprintContent("NEW"))!]) {
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, { ...observation, content })).toBe("unknown");
      expect(classifyTagSuggestionFreshness(otherSource, otherProvenance, { ...observation, source: otherSource, content })).toBe("unknown");
    }
    const other = harness(); const otherOutcome = await other.evaluate(); other.emit("OLD");
    await vi.waitFor(() => expect(other.tracker.observation(otherOutcome.source)).toBeDefined());
    const otherObservation = other.tracker.observation(otherOutcome.source)!;
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, otherObservation)).toBe("unknown");
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, { ...observation, content: otherObservation.content })).toBe("unknown");
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, observation)).toBe("matching");
    other.tracker.dispose();
    h.tracker.dispose(); h.tracker.dispose();
    expect(h.tracker.observation(outcome.source)).toBeUndefined(); expect(h.metadata.offref).toHaveBeenCalledOnce();
  });
  it("requires an observed, matching event pair and never uses getFileCache", async () => {
    const h = harness(); const outcome = await h.evaluate();
    expect(h.capture.capture(outcome)).toEqual({ status: "failure", reason: "freshness-unverified" });
    const eventCache = h.emit("OLD", h.cache(["#aws"]));
    await vi.waitFor(() => expect(h.tracker.snapshot(outcome.source, outcome.evaluationProvenance).status).toBe("verified"));
    const observation = h.tracker.observation(outcome.source)!;
    expect(observation).toBeDefined();
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, observation)).toBe("matching");
    const result = h.capture.capture(outcome);
    expect(result.status).toBe("captured");
    expect(getAllTags).toHaveBeenCalledExactlyOnceWith(eventCache);
    expect(h.forbidden).not.toHaveBeenCalled();
    if (result.status !== "captured") throw new Error("Synthetic capture failed");
    expect(result.authorization.existingTags).toEqual(["#aws"]);
    expect(await h.apply.apply({ confirmation: h.confirm(outcome) }, new AbortController().signal))
      .toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
  });
  it("fixes OLD metadata + NEW stat, then permits only a matching explicit NEW evaluation/event pair", async () => {
    const h = harness(); const old = await h.evaluate("OLD");
    h.emit("OLD", h.cache([]));
    await vi.waitFor(() => expect(h.capture.capture(old).status).toBe("captured"));
    h.original.stat.mtime++; h.original.stat.size += 5;
    expect(h.capture.capture(old)).toEqual({ status: "failure", reason: "revision-changed" });
    const updated = await h.evaluate("NEW #aws");
    expect(h.capture.capture(updated)).toEqual({ status: "failure", reason: "metadata-stale" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    h.emit("NEW #aws", h.cache(["#aws"]));
    await vi.waitFor(() => expect(h.capture.capture(updated).status).toBe("captured"));
    expect(h.capture.capture(old)).toEqual({ status: "failure", reason: "revision-changed" });
    const result = h.capture.capture(updated);
    if (result.status !== "captured") throw new Error("Synthetic capture failed");
    expect(await h.apply.apply({ confirmation: h.confirm(updated) }, new AbortController().signal))
      .toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.frontmatter).toEqual({ tags: ["aws"] });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
  });
  it("refuses mismatched indexed content even when mtime/size are identical", async () => {
    const h = harness(); const outcome = await h.evaluate("OLD");
    h.emit("NEW");
    await vi.waitFor(() => expect(h.capture.capture(outcome)).toEqual({ status: "failure", reason: "metadata-stale" }));
    expect(h.tracker.observation(outcome.source)).toBeDefined();
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, h.tracker.observation(outcome.source))).toBe("changed");
  });
  it.each(["other", "replacement", "rename", "move"])("rejects event/source identity %s", async (change) => {
    const h = harness(); const outcome = await h.evaluate();
    const target = file(change === "other" ? "Synthetic/B.md" : h.original.path);
    if (change === "other") h.files.set(target.path, target);
    if (change === "replacement") h.files.set(target.path, target);
    if (change === "rename" || change === "move") h.original.path = change === "rename" ? "Renamed.md" : "Other/A.md";
    h.emit("OLD", h.cache(["#aws"]), target);
    await fingerprintContent("settle synthetic hash work");
    expect(h.capture.capture(outcome).status).toBe("failure");
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("pending newer observation invalidates legacy evidence but does not block the grant core", async () => {
    const h = harness(); const outcome = await h.evaluate();
    h.emit("OLD");
    await vi.waitFor(() => expect(h.capture.capture(outcome).status).toBe("captured"));
    const captured = h.capture.capture(outcome);
    if (captured.status !== "captured") throw new Error("Synthetic capture failed");
    h.emit("NEW");
    expect(await h.apply.apply({ confirmation: h.confirm(outcome) }, new AbortController().signal))
      .toEqual({ status: "applied", addedTags: ["#aws"] });
    await vi.waitFor(() => expect(h.tracker.snapshot(outcome.source, outcome.evaluationProvenance)).toEqual({ status: "failure", reason: "metadata-stale" }));
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
  });
  it("never lets an older digest completion replace a newer event pair", async () => {
    const h = harness(); const outcome = await h.evaluate("NEW");
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const complete: (() => Promise<void>)[] = [];
    const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, bytes) =>
      new Promise<ArrayBuffer>((resolve) => { complete.push(async () => resolve(await digest(algorithm, bytes))); }));
    try {
      h.emit("OLD", h.cache(["#old"])); h.emit("NEW", h.cache(["#aws"]));
      await complete[1]();
      await vi.waitFor(() => expect(h.capture.capture(outcome).status).toBe("captured"));
      await complete[0]();
      const captured = h.capture.capture(outcome);
      if (captured.status !== "captured") throw new Error("Synthetic capture failed");
      expect(captured.authorization.existingTags).toEqual(["#aws"]);
      expect(h.tracker.observation(outcome.source)?.existingTags).toEqual(["#aws"]);
      expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, h.tracker.observation(outcome.source))).toBe("matching");
    } finally { spy.mockRestore(); }
  });
  it("changed advisory freshness and legacy metadata-stale do not block the grant core", async () => {
    const h = harness(); const outcome = await h.evaluate();
    h.emit("OLD");
    await vi.waitFor(() => expect(h.capture.capture(outcome).status).toBe("captured"));
    const captured = h.capture.capture(outcome);
    if (captured.status !== "captured") throw new Error("Synthetic capture failed");
    h.emit("NEW");
    await vi.waitFor(() => expect(h.tracker.snapshot(outcome.source, outcome.evaluationProvenance)).toEqual({ status: "failure", reason: "metadata-stale" }));
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, h.tracker.observation(outcome.source))).toBe("changed");
    expect(await h.apply.apply({ confirmation: h.confirm(outcome) }, new AbortController().signal))
      .toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
  });
  it.each(["no-event", "no-provenance", "disposed"])("unknown freshness does not block the grant core: %s", async scenario => {
    const h = harness(); const outcome = await h.evaluate();
    if (scenario === "no-provenance") outcome.evaluationProvenance = undefined;
    const confirmation = h.confirm(outcome);
    if (scenario === "disposed") h.tracker.dispose();
    expect(classifyTagSuggestionFreshness(outcome.source, outcome.evaluationProvenance, h.tracker.observation(outcome.source))).toBe("unknown");
    expect(await h.apply.apply({ confirmation }, new AbortController().signal))
      .toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.frontmatter.tags).toEqual(["aws"]); expect(h.forbidden).not.toHaveBeenCalled(); h.tracker.dispose();
  });
  it("copies tags from the event cache so later cache mutation cannot change the proof", async () => {
    const h = harness(); const outcome = await h.evaluate();
    const tags = ["#aws"]; h.emit("OLD", h.cache(tags)); tags.push("#late");
    await vi.waitFor(() => expect(h.capture.capture(outcome).status).toBe("captured"));
    const captured = h.capture.capture(outcome);
    if (captured.status !== "captured") throw new Error("Synthetic capture failed");
    expect(captured.authorization.existingTags).toEqual(["#aws"]);
    expect(JSON.stringify(captured.authorization.metadataProof)).toBe("{}");
  });
  it("does not expose or log note bodies/fingerprints or access network/storage/Secrets", async () => {
    const h = harness(); const outcome = await h.evaluate("Synthetic private body");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", h.forbidden); vi.stubGlobal("localStorage", { setItem: h.forbidden });
    try {
      h.emit("Synthetic private body");
      await vi.waitFor(() => expect(h.capture.capture(outcome).status).toBe("captured"));
      const result = h.capture.capture(outcome);
      expect(JSON.stringify(result)).not.toContain("Synthetic private body");
      expect(JSON.stringify(outcome.evaluationProvenance)).toBe("{}");
      expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
    } finally { log.mockRestore(); error.mockRestore(); }
  });
  it("fails closed for missing/forged evaluation provenance", async () => {
    const h = harness(); const outcome = await h.evaluate();
    h.emit("OLD");
    await vi.waitFor(() => expect(h.capture.capture(outcome).status).toBe("captured"));
    expect(h.capture.capture({ ...outcome, evaluationProvenance: undefined })).toEqual({ status: "failure", reason: "freshness-unverified" });
    expect(h.capture.capture({ ...outcome, evaluationProvenance: {} as EvaluationProvenance })).toEqual({ status: "failure", reason: "freshness-unverified" });
  });
  it("dispose unregisters events and clears in-memory proof; late completion cannot restore it", async () => {
    const h = harness(); const outcome = await h.evaluate();
    h.emit("OLD"); h.tracker.dispose();
    await fingerprintContent("settle synthetic hash work");
    expect(h.capture.capture(outcome)).toEqual({ status: "failure", reason: "freshness-unverified" });
    expect(h.metadata.offref).toHaveBeenCalledTimes(1);
  });
});
