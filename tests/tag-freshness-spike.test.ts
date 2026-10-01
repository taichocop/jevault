import type { EventRef, FrontMatterInfo, TAbstractFile, TagCache, TFile, Vault } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteSource } from "../src/note-source";
import { captureEvaluationProvenance, fingerprintContent } from "../src/tags/evaluation-provenance";
import { TagApplyPreparationSession } from "../src/tags/tag-apply-preparation";
import { TFile as FakeFile } from "./helpers/obsidian-move";
import { CurrentBodyProbe, cachedLiteralPresent, conservativeLiteralPresent, frontmatterSnapshot } from "./helpers/tag-freshness-spike";

vi.mock("obsidian", async () => ({
  TFile: (await import("./helpers/obsidian-move")).TFile,
  getAllTags: () => [], parseFrontMatterTags: () => [],
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function file(path = "Synthetic/A.md") {
  return Object.assign(new FakeFile(path), { stat: { ctime: 1, mtime: 2, size: 3 } }) as TFile;
}
function harness(body = "OLD", fingerprint = fingerprintContent) {
  const original = file(), other = file("Synthetic/B.md"), source = new NoteSource(original);
  const files = new Map([[original.path, original], [other.path, other]]);
  let current = body;
  const listeners = new Map<EventRef, { name: string; callback: (file: TAbstractFile) => void }>();
  const forbidden = vi.fn(() => { throw new Error("Forbidden boundary"); });
  const vault = {
    getFileByPath: (path: string) => files.get(path) ?? null,
    read: vi.fn(async (target: TFile) => {
      if (target !== original) throw new Error("Unexpected synthetic read target");
      return current;
    }),
    on: vi.fn((name: string, callback: (file: TAbstractFile) => void) => {
      const ref = {} as EventRef; listeners.set(ref, { name, callback }); return ref;
    }),
    offref: vi.fn((ref: EventRef) => { listeners.delete(ref); }),
    modify: forbidden, rename: forbidden, delete: forbidden, create: forbidden, createFolder: forbidden,
    process: forbidden, processFrontMatter: forbidden, getApiKey: forbidden,
  };
  const probe = new CurrentBodyProbe(vault as unknown as Vault, source, fingerprint);
  const emit = (name: string, target = original) => {
    for (const entry of listeners.values()) if (entry.name === name) entry.callback(target);
  };
  return { original, other, source, files, vault, listeners, probe, emit, forbidden,
    setBody: (next: string) => { current = next; },
    evaluate: () => captureEvaluationProvenance(source, body) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Issue #64 A: read snapshot, never an Apply authorization", () => {
  it("matches evaluation content without a changed event; current production preparation still fails closed", async () => {
    const h = harness(), provenance = await h.evaluate();
    const metadata = { on: vi.fn(() => ({} as EventRef)), offref: vi.fn() };
    const session = new TagApplyPreparationSession(h.vault, metadata, h.original);
    session.prepare({ status: "success", source: h.source, noteTitle: "Synthetic", suggestions: [], evaluationProvenance: provenance });
    expect(session.state).toEqual({ status: "unavailable", reason: "freshness-unverified" });
    expect(await h.probe.check(provenance)).toBe("snapshot-match");
    expect(h.vault.read).toHaveBeenCalledExactlyOnceWith(h.original);
    session.dispose(); h.probe.dispose();
    expect(h.listeners.size).toBe(0);
  });

  it("detects different bytes even when mtime and size are unchanged", async () => {
    const h = harness(), provenance = await h.evaluate();
    h.setBody("NEW");
    expect(await h.probe.check(provenance)).toBe("unavailable");
    h.probe.dispose();
  });

  it.each(["rename", "move", "delete", "replacement"])("rejects %s before read", async (change) => {
    const h = harness(), provenance = await h.evaluate();
    if (change === "rename" || change === "move") h.original.path = change === "rename" ? "Synthetic/Renamed.md" : "Other/A.md";
    if (change === "delete") h.files.delete(h.source.path);
    if (change === "replacement") h.files.set(h.source.path, file(h.source.path));
    expect(await h.probe.check(provenance)).toBe("unavailable");
    expect(h.vault.read).not.toHaveBeenCalled();
    h.probe.dispose();
  });

  it("active-note changes and unrelated events never change the captured source or hash another note", async () => {
    const hash = vi.fn(fingerprintContent), h = harness("OLD", hash), provenance = await h.evaluate();
    const active = h.other;
    h.emit("modify", active);
    expect(await h.probe.check(provenance)).toBe("snapshot-match");
    expect(hash).toHaveBeenCalledExactlyOnceWith("OLD");
    expect(h.vault.read).toHaveBeenCalledExactlyOnceWith(h.original);
    h.probe.dispose();
  });

  it.each(["edit", "rename", "move", "delete", "replacement", "cancel", "close"])("rejects %s while read is pending, before starting a hash", async (change) => {
    const hash = vi.fn(fingerprintContent), h = harness("OLD", hash), provenance = await h.evaluate();
    const pending = deferred<string>(), signal = new AbortController();
    h.vault.read.mockReturnValueOnce(pending.promise);
    const check = h.probe.check(provenance, signal.signal);
    if (change === "edit") h.emit("modify");
    if (change === "rename" || change === "move") h.original.path = "Elsewhere/A.md";
    if (change === "delete") h.files.delete(h.source.path);
    if (change === "replacement") h.files.set(h.source.path, file());
    if (change === "cancel") signal.abort();
    if (change === "close") h.probe.dispose();
    pending.resolve("OLD");
    expect(await check).toBe("unavailable");
    expect(hash).not.toHaveBeenCalled();
    h.probe.dispose();
  });

  it.each(["edit", "close", "retry", "unload", "cancel"])("late hash after %s cannot publish a matching snapshot", async (change) => {
    const pending = deferred<Awaited<ReturnType<typeof fingerprintContent>>>();
    const started = deferred<void>(), hash = vi.fn(() => { started.resolve(); return pending.promise; });
    const h = harness("OLD", hash), provenance = await h.evaluate(), signal = new AbortController();
    const check = h.probe.check(provenance, signal.signal);
    await started.promise;
    if (change === "edit") h.emit("modify");
    else if (change === "cancel") signal.abort();
    else h.probe.dispose();
    if (change === "retry") {
      const next = new CurrentBodyProbe(h.vault as unknown as Vault, h.source);
      expect(next).not.toBe(h.probe);
      next.dispose();
    }
    pending.resolve(await fingerprintContent("OLD"));
    expect(await check).toBe("unavailable");
    h.probe.dispose();
    h.emit("modify");
    expect(hash).toHaveBeenCalledOnce();
    expect(h.listeners.size).toBe(0);
  });

  it("does not mistake a completed matching read for protection against an edit just after hash completion", async () => {
    const h = harness(), provenance = await h.evaluate();
    expect(await h.probe.check(provenance)).toBe("snapshot-match");
    h.setBody("NEW");
    expect(await h.probe.check(provenance)).toBe("unavailable");
    h.probe.dispose();
  });

  it("documents the unobservable race: a captured old read plus delayed edit events can still match", async () => {
    const pending = deferred<Awaited<ReturnType<typeof fingerprintContent>>>(), started = deferred<void>();
    const h = harness("OLD", () => { started.resolve(); return pending.promise; });
    const provenance = await h.evaluate(), check = h.probe.check(provenance);
    await started.promise;
    h.setBody("NEW"); // 同じstat・event未配信はpublic read contractでは排除できない。
    pending.resolve(await fingerprintContent("OLD"));
    expect(await check).toBe("snapshot-match");
    h.probe.dispose();
  });

  it("fails closed on read/crypto failure, pre-start cancellation and foreign provenance, with no forbidden I/O", async () => {
    const h = harness(), provenance = await h.evaluate();
    h.vault.read.mockRejectedValueOnce(new Error("Synthetic read failure"));
    expect(await h.probe.check(provenance)).toBe("unavailable");
    const signal = new AbortController(); signal.abort();
    expect(await h.probe.check(provenance, signal.signal)).toBe("unavailable");
    expect(await h.probe.check(await captureEvaluationProvenance(new NoteSource(h.other), "OLD"))).toBe("unavailable");
    h.probe.dispose();
    const failed = harness("OLD", async () => undefined);
    vi.stubGlobal("fetch", h.forbidden);
    expect(await failed.probe.check(await failed.evaluate())).toBe("unavailable");
    expect(h.forbidden).not.toHaveBeenCalled();
    expect(failed.forbidden).not.toHaveBeenCalled();
    failed.probe.dispose();
  });
});

function cacheTag(tag: string, offset = 0): TagCache {
  return { tag, position: { start: { line: 0, col: offset, offset }, end: { line: 0, col: offset + tag.length, offset: offset + tag.length } } };
}

describe("Issue #64 B: positive evidence differs from absence evidence", () => {
  it.each(["#aws", "#programming/aws", "#日本語"])("validates the %s cached literal only against the read body", (selected) => {
    const tag = cacheTag(selected);
    expect(cachedLiteralPresent(selected, tag)).toBe(true);
    expect(cachedLiteralPresent("Different body", tag)).toBe(false);
    expect(cachedLiteralPresent(selected, cacheTag(selected, -1))).toBe(false);
  });

  it("stale cache absence misses a new inline tag; position match does not certify its Markdown context", () => {
    const oldCache: TagCache[] = [], current = "#aws";
    expect(oldCache.some((tag) => cachedLiteralPresent(current, tag))).toBe(false);
    expect(conservativeLiteralPresent(current, "#aws")).toBe(true);
    const nowCode = "`#aws`";
    expect(cachedLiteralPresent(nowCode, cacheTag("#aws", 1))).toBe(true);
  });

  it.each([
    ["```\n#aws\n```", true], ["`#aws`", true], ["\\#aws", true],
    ["https://example.invalid/#aws", true], ["# aws heading", false],
    ["ordinary text#aws", true], ["#awsome", true],
  ] as const)("records conservative false positives or ambiguous contexts: %s", (body, expected) => {
    expect(conservativeLiteralPresent(body, "#aws")).toBe(expected);
  });

  it("exact literal guard has a documented case-insensitivity false negative", () => {
    expect(conservativeLiteralPresent("#AWS", "#aws")).toBe(false);
    expect(conservativeLiteralPresent("#aws", "#aws")).toBe(true);
  });

  it.each([
    ["tags: aws", { tags: "aws" }, ["#aws"]],
    ["tags:\n  - aws\n  - programming/aws\n  - 日本語", { tags: ["aws", "programming/aws", "日本語"] }, ["#aws", "#programming/aws", "#日本語"]],
  ])("delegates current frontmatter to public helper contracts (fake semantics only): %s", (yaml, parsed, tags) => {
    const body = `---\n${yaml}\n---\nSynthetic`;
    const helpers = {
      getFrontMatterInfo: vi.fn(() => ({ exists: true, frontmatter: yaml }) as FrontMatterInfo),
      parseYaml: vi.fn(() => parsed), parseFrontMatterTags: vi.fn(() => tags),
    };
    expect(frontmatterSnapshot(body, helpers)).toEqual(tags);
    expect(helpers.getFrontMatterInfo).toHaveBeenCalledExactlyOnceWith(body);
    expect(helpers.parseYaml).toHaveBeenCalledExactlyOnceWith(yaml);
    expect(helpers.parseFrontMatterTags).toHaveBeenCalledExactlyOnceWith(parsed);
  });

  it.each([null, 12, [], { tags: 12 }, { tags: ["aws", null] }])("unexpected YAML cannot become absence proof", (parsed) => {
    expect(frontmatterSnapshot("synthetic", {
      getFrontMatterInfo: () => ({ exists: true, frontmatter: "synthetic" }) as FrontMatterInfo,
      parseYaml: () => parsed, parseFrontMatterTags: () => [],
    })).toBeUndefined();
  });

  it.each(["getFrontMatterInfo", "parseYaml", "parseFrontMatterTags"] as const)("%s failure cannot become absence proof", (failure) => {
    const helpers = {
      getFrontMatterInfo: () => ({ exists: true, frontmatter: "tags: aws" }) as FrontMatterInfo,
      parseYaml: () => ({ tags: "aws" }), parseFrontMatterTags: () => ["#aws"],
    };
    const throws = () => { throw new Error("Synthetic malformed YAML/helper failure"); };
    expect(frontmatterSnapshot("synthetic", { ...helpers, [failure]: throws })).toBeUndefined();
  });

  it("frontmatter absence says nothing about inline absence; a null helper result stays unverified", () => {
    const noFrontmatter = { getFrontMatterInfo: () => ({ exists: false }) as FrontMatterInfo,
      parseYaml: vi.fn(), parseFrontMatterTags: vi.fn() };
    expect(frontmatterSnapshot("#aws", noFrontmatter)).toEqual([]);
    expect(noFrontmatter.parseYaml).not.toHaveBeenCalled();
    expect(frontmatterSnapshot("synthetic", {
      getFrontMatterInfo: () => ({ exists: true, frontmatter: "tags: aws" }) as FrontMatterInfo,
      parseYaml: () => ({ tags: "aws" }), parseFrontMatterTags: () => null,
    })).toBeUndefined();
  });
});
