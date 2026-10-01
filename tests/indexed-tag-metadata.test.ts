import { getAllTags, parseFrontMatterTags, type CachedMetadata, type EventRef, type MetadataCache, type TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteSource } from "../src/note-source";
import { captureEvaluationProvenance, fingerprintContent, sameContent, type EvaluationProvenance } from "../src/tags/evaluation-provenance";
import { IndexedTagMetadataTracker } from "../src/tags/indexed-tag-metadata";
import { TagApplyAuthorizationService } from "../src/tags/tag-apply-authorization";
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
  const apply = new TagApplyService(vault, tracker, fileManager);
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
  return { original, files, vault, metadata, tracker, capture, apply, fileManager, forbidden, evaluate, emit, cache, tags, frontmatter };
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
  it("requires an observed, matching event pair and never uses getFileCache", async () => {
    const h = harness(); const outcome = await h.evaluate();
    expect(h.capture.capture(outcome)).toEqual({ status: "failure", reason: "freshness-unverified" });
    const eventCache = h.emit("OLD", h.cache(["#aws"]));
    await vi.waitFor(() => expect(h.tracker.snapshot(outcome.source, outcome.evaluationProvenance).status).toBe("verified"));
    const result = h.capture.capture(outcome);
    expect(result.status).toBe("captured");
    expect(getAllTags).toHaveBeenCalledExactlyOnceWith(eventCache);
    expect(h.forbidden).not.toHaveBeenCalled();
    if (result.status !== "captured") throw new Error("Synthetic capture failed");
    expect(result.authorization.existingTags).toEqual(["#aws"]);
    expect(await h.apply.apply({ authorization: result.authorization, selectedTags: ["#aws"] }, new AbortController().signal))
      .toEqual({ status: "no-change" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
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
    expect(await h.apply.apply({ authorization: result.authorization, selectedTags: ["#aws"] }, new AbortController().signal))
      .toEqual({ status: "no-change" });
    expect(h.frontmatter).toEqual({});
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("refuses mismatched indexed content even when mtime/size are identical", async () => {
    const h = harness(); const outcome = await h.evaluate("OLD");
    h.emit("NEW");
    await vi.waitFor(() => expect(h.capture.capture(outcome)).toEqual({ status: "failure", reason: "metadata-stale" }));
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
  it("immediately invalidates authorization when a newer event arrives, before digest completion", async () => {
    const h = harness(); const outcome = await h.evaluate();
    h.emit("OLD");
    await vi.waitFor(() => expect(h.capture.capture(outcome).status).toBe("captured"));
    const captured = h.capture.capture(outcome);
    if (captured.status !== "captured") throw new Error("Synthetic capture failed");
    h.emit("NEW");
    expect(await h.apply.apply({ authorization: captured.authorization, selectedTags: ["#aws"] }, new AbortController().signal))
      .toEqual({ status: "failure", reason: "freshness-unverified" });
    await vi.waitFor(() => expect(h.tracker.snapshot(outcome.source, outcome.evaluationProvenance)).toEqual({ status: "failure", reason: "metadata-stale" }));
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
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
    } finally { spy.mockRestore(); }
  });
  it("rejects a newer different-content proof even after that proof finishes", async () => {
    const h = harness(); const outcome = await h.evaluate();
    h.emit("OLD");
    await vi.waitFor(() => expect(h.capture.capture(outcome).status).toBe("captured"));
    const captured = h.capture.capture(outcome);
    if (captured.status !== "captured") throw new Error("Synthetic capture failed");
    h.emit("NEW");
    await vi.waitFor(() => expect(h.tracker.snapshot(outcome.source, outcome.evaluationProvenance)).toEqual({ status: "failure", reason: "metadata-stale" }));
    expect(await h.apply.apply({ authorization: captured.authorization, selectedTags: ["#aws"] }, new AbortController().signal))
      .toEqual({ status: "failure", reason: "metadata-stale" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
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
