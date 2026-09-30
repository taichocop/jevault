import { getAllTags, parseFrontMatterTags, type CachedMetadata, type TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteSource } from "../src/note-source";
import { TagApplyAuthorizationService, type TagApplyAuthorization } from "../src/tags/tag-apply-authorization";
import { TagApplyService } from "../src/tags/tag-apply-service";
import { TFile as FakeFile } from "./helpers/obsidian-move";

vi.mock("obsidian", async () => ({
  TFile: (await import("./helpers/obsidian-move")).TFile,
  getAllTags: vi.fn(), parseFrontMatterTags: vi.fn(),
}));

const names = ["#aws", "#cloud", "#programming/aws", "#AWS", "#日本語", "#é", "#e\u0301"];

function harness(frontmatter: Record<string, unknown> = {}, existingTags: string[] = []) {
  const file = Object.assign(new FakeFile("Synthetic/A.md"), { stat: { ctime: 1, mtime: 2, size: 100 } }) as TFile;
  let currentTags = [...existingTags];
  let frontmatterTags: string[] = [];
  let callbackTags: string[] = [];
  const forbidden = vi.fn(() => { throw new Error("Forbidden boundary"); });
  const vault = {
    getFileByPath: vi.fn((): TFile | null => file),
    read: forbidden, cachedRead: forbidden, modify: forbidden, process: forbidden,
    create: forbidden, createFolder: forbidden, delete: forbidden, rename: forbidden,
  };
  const cache: CachedMetadata = { frontmatter: {} };
  const metadata = { getFileCache: vi.fn((): CachedMetadata | null => cache) };
  vi.mocked(getAllTags).mockReset().mockImplementation(() => [...currentTags]);
  // 公式runtimeはunit testにないため、helper出力を明示する。自作YAML/tag parserで代替しない。
  vi.mocked(parseFrontMatterTags).mockReset().mockImplementation((value: unknown) =>
    value === frontmatter ? [...callbackTags] : [...frontmatterTags]);
  const fileManager = {
    processFrontMatter: vi.fn(async (_file: TFile, callback: (fm: Record<string, unknown>) => void) => {
      callback(frontmatter);
    }),
  };
  const source = new NoteSource(file);
  const capture = new TagApplyAuthorizationService(vault, metadata);
  const service = new TagApplyService(vault, metadata, fileManager);
  const outcome = { source, suggestions: names.map((tagName) => ({ tagName, tagId: "synthetic", choice: "match" as const, matchProbability: 1 })) };
  function authorize(): TagApplyAuthorization {
    const result = capture.capture(outcome);
    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("Synthetic capture failed");
    return result.authorization;
  }
  const controller = new AbortController();
  const apply = (authorization: TagApplyAuthorization, selectedTags: readonly string[] = ["#aws"]) =>
    service.apply({ authorization, selectedTags }, controller.signal);
  return {
    file, vault, metadata, fileManager, source, capture, service, outcome, authorize, apply, controller,
    frontmatter, forbidden, cache,
    tags: (tags: string[]) => { currentTags = tags; },
    fmTags: (tags: string[]) => { frontmatterTags = tags; callbackTags = tags; },
    callbackTags: (tags: string[]) => { callbackTags = tags; },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("TagApply authorization capture", () => {
  it("captures source, revision, tags and allowed names before later selection, with immutable copies", () => {
    const h = harness({}, ["#inline", "#AWS", "#aws"]);
    const authorization = h.authorize();
    expect(authorization.source).toBe(h.source);
    expect(authorization.revision).toEqual({ mtime: 2, size: 100 });
    expect(authorization.existingTags).toEqual(["#inline", "#AWS", "#aws"]);
    expect(authorization.allowedTags).toEqual(names);
    h.outcome.suggestions.length = 0;
    h.file.stat.mtime++;
    h.tags(["#later"]);
    expect(authorization.allowedTags).toEqual(names);
    expect(authorization.revision.mtime).toBe(2);
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.allowedTags)).toBe(true);
    expect(Object.isFrozen(authorization.existingTags)).toBe(true);
    expect(h.forbidden).not.toHaveBeenCalled();
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("fails closed for unavailable metadata", () => {
    const h = harness();
    h.metadata.getFileCache.mockReturnValue(null);
    expect(h.capture.capture(h.outcome)).toEqual({ status: "failure", reason: "metadata-unavailable" });
    expect(getAllTags).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(["source", "revision"])("rejects %s changing during capture", (change) => {
    const h = harness();
    h.metadata.getFileCache.mockImplementation(() => {
      if (change === "source") h.file.path = "Renamed.md";
      else h.file.stat.size++;
      return h.cache;
    });
    expect(h.capture.capture(h.outcome)).toEqual({ status: "failure", reason: `${change}-changed` });
  });
  it("sanitizes capture exceptions", () => {
    const h = harness();
    h.metadata.getFileCache.mockImplementation(() => { throw new Error("Private synthetic detail"); });
    expect(h.capture.capture(h.outcome)).toEqual({ status: "failure", reason: "unexpected" });
  });
});

describe("TagApplyService", () => {
  it("adds one tag once, preserving frontmatter fields and existing tags", async () => {
    const h = harness({ tags: ["rails"], aliases: ["alias"], custom: { keep: true }, title: "Synthetic" }, ["#rails"]);
    h.fmTags(["#rails"]);
    const result = await h.apply(h.authorize());
    expect(result).toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.frontmatter).toEqual({ tags: ["rails", "aws"], aliases: ["alias"], custom: { keep: true }, title: "Synthetic" });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledExactlyOnceWith(h.file, expect.any(Function));
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("applies several exact canonical names in one call with persistence-only hash stripping", async () => {
    const h = harness();
    expect(await h.apply(h.authorize(), [...names, "#aws"])).toEqual({ status: "applied", addedTags: names });
    expect(h.frontmatter.tags).toEqual(["aws", "cloud", "programming/aws", "AWS", "日本語", "é", "e\u0301"]);
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
  });
  it.each(["#new", "aws", "#Aws"])("rejects undisplayed selection %s", async (name) => {
    const h = harness();
    expect(await h.apply(h.authorize(), [name])).toEqual({ status: "failure", reason: "invalid-selection" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("rejects forged/copied authorizations and snapshots from another Vault", async () => {
    const h = harness();
    expect(await h.apply({ ...h.authorize(), allowedTags: ["#new"] }, ["#new"]))
      .toEqual({ status: "failure", reason: "invalid-selection" });
    const other = harness();
    expect(await other.apply(h.authorize())).toEqual({ status: "failure", reason: "invalid-selection" });
  });
  it("empty selection is a no-op without resolving source or metadata", async () => {
    const h = harness();
    const authorization = h.authorize();
    h.vault.getFileByPath.mockClear(); h.metadata.getFileCache.mockClear();
    expect(await h.apply(authorization, [])).toEqual({ status: "no-change" });
    expect(h.vault.getFileByPath).not.toHaveBeenCalled();
    expect(h.metadata.getFileCache).not.toHaveBeenCalled();
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it.each([{ selected: ["#aws", "#cloud"] }, { selected: ["#aws"] }])("filters existing inline tags before mutation: $selected", async ({ selected }) => {
    const h = harness({}, ["#aws"]);
    expect(await h.apply(h.authorize(), selected)).toEqual(selected.length === 1
      ? { status: "no-change" } : { status: "applied", addedTags: ["#cloud"] });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledTimes(selected.length === 1 ? 0 : 1);
    expect(h.frontmatter.tags).toEqual(selected.length === 1 ? undefined : ["cloud"]);
  });
  it.each(["replacement", "rename", "move", "missing", "non-md", "filename", "basename"])("rejects source %s", async (change) => {
    const h = harness();
    const authorization = h.authorize();
    if (change === "replacement") h.vault.getFileByPath.mockReturnValue(Object.assign(new FakeFile(h.file.path), { stat: h.file.stat }) as TFile);
    if (change === "rename") h.file.path = "Synthetic/Renamed.md";
    if (change === "move") h.file.path = "Elsewhere/A.md";
    if (change === "missing") h.vault.getFileByPath.mockReturnValue(null);
    if (change === "non-md") h.file.extension = "txt";
    if (change === "filename") h.file.name = "Other.md";
    if (change === "basename") h.file.basename = "Other";
    expect(await h.apply(authorization)).toEqual({ status: "failure", reason: "source-changed" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("uses the original file without consulting an active note", async () => {
    const h = harness();
    const workspace = { getActiveFile: vi.fn(() => new FakeFile("Synthetic/B.md")) };
    await h.apply(h.authorize());
    expect(h.fileManager.processFrontMatter.mock.calls[0][0]).toBe(h.file);
    expect(workspace.getActiveFile).not.toHaveBeenCalled();
  });
  it.each(["mtime", "size"] as const)("capture → %s change → apply refuses mutation", async (key) => {
    const h = harness(); const authorization = h.authorize();
    h.file.stat[key]++;
    expect(await h.apply(authorization)).toEqual({ status: "failure", reason: "revision-changed" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it.each([{ tags: ["#aws", "#manual"] }, { tags: ["#AWS"] }, { tags: ["#é"] }, { tags: ["#e\u0301"] }])("refuses changed exact tag set $tags before duplicate filtering", async ({ tags }) => {
    const h = harness({}, ["#aws"]); const authorization = h.authorize(); h.tags(tags);
    expect(await h.apply(authorization)).toEqual({ status: "failure", reason: "tag-state-changed" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("ignores metadata helper iteration order and exact duplicates", async () => {
    const h = harness({}, ["#aws", "#AWS"]); const authorization = h.authorize();
    h.tags(["#AWS", "#aws", "#AWS"]);
    expect(await h.apply(authorization, ["#cloud"])).toEqual({ status: "applied", addedTags: ["#cloud"] });
  });
  it("detects Unicode-only changes without normalization", async () => {
    const h = harness({}, ["#é"]); const authorization = h.authorize();
    h.tags(["#e\u0301"]);
    expect(await h.apply(authorization)).toEqual({ status: "failure", reason: "tag-state-changed" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("fails closed for metadata unavailable at apply without body reads", async () => {
    const h = harness(); const authorization = h.authorize(); h.metadata.getFileCache.mockReturnValue(null);
    expect(await h.apply(authorization)).toEqual({ status: "failure", reason: "metadata-unavailable" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("delegates legacy scalar tag interpretation to the official helper", async () => {
    const h = harness({ tags: "rails cloud", aliases: ["keep"] }, ["#rails", "#cloud"]);
    h.fmTags(["#rails", "#cloud"]);
    expect(await h.apply(h.authorize())).toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.frontmatter).toEqual({ tags: ["rails", "cloud", "aws"], aliases: ["keep"] });
    expect(parseFrontMatterTags).toHaveBeenCalledWith(h.frontmatter);
  });
  it.each([null, 3, { unknown: true }, ""])("does not replace unrecognized tags property %s", async (tags) => {
    const h = harness({ tags, custom: "keep" });
    expect(await h.apply(h.authorize())).toEqual({ status: "failure", reason: "unexpected" });
    expect(h.frontmatter).toEqual({ tags, custom: "keep" });
  });
  it("preserves existing array entries verbatim", async () => {
    const h = harness({ tags: ["#rails", "Rails", "rails"] }, ["#rails", "#Rails"]);
    h.fmTags(["#rails", "#Rails"]);
    await h.apply(h.authorize());
    expect(h.frontmatter.tags).toEqual(["#rails", "Rails", "rails", "aws"]);
  });
  it.each(["entry", "input", "source", "revision", "metadata", "final"])("cancels after %s validation with zero mutation calls", async (stage) => {
    const h = harness(); const authorization = h.authorize();
    if (stage === "entry") h.controller.abort();
    if (stage === "input") {
      const selected = ["#aws"];
      Object.defineProperty(selected, 0, { get: () => { h.controller.abort(); return "#aws"; } });
      expect(await h.apply(authorization, selected)).toEqual({ status: "cancelled" });
    } else {
      if (stage === "source") h.vault.getFileByPath.mockImplementation(() => { h.controller.abort(); return h.file; });
      if (stage === "revision") Object.defineProperty(h.file.stat, "size", { get: () => { h.controller.abort(); return 100; } });
      if (stage === "metadata") h.metadata.getFileCache.mockImplementation(() => { h.controller.abort(); return h.cache; });
      if (stage === "final") h.vault.getFileByPath.mockReturnValueOnce(h.file).mockImplementationOnce(() => { h.controller.abort(); return h.file; });
      expect(await h.apply(authorization)).toEqual({ status: "cancelled" });
    }
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it.each(["success", "failure"])("returns actual post-start %s despite cancellation and cleans up lock", async (outcome) => {
    const h = harness(); const authorization = h.authorize();
    h.fileManager.processFrontMatter.mockImplementationOnce(async (_file, callback) => {
      h.controller.abort();
      if (outcome === "failure") throw new Error("Private synthetic exception /absolute/path");
      callback(h.frontmatter);
    });
    expect(await h.apply(authorization)).toEqual(outcome === "success"
      ? { status: "applied", addedTags: ["#aws"] } : { status: "failure", reason: "unexpected" });
    expect(h.forbidden).not.toHaveBeenCalled();
    h.fmTags(outcome === "success" ? ["#aws"] : []);
    h.tags(outcome === "success" ? ["#aws"] : []);
    expect(await h.service.apply({ authorization: h.authorize(), selectedTags: ["#cloud"] }, new AbortController().signal))
      .toEqual({ status: "applied", addedTags: ["#cloud"] });
  });
  it("guards pending same-source applies across selections and service instances", async () => {
    const h = harness(); const authorization = h.authorize();
    let complete!: () => void;
    h.fileManager.processFrontMatter.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    const first = h.apply(authorization);
    const second = new TagApplyService(h.vault, h.metadata, h.fileManager);
    expect(await second.apply({ authorization, selectedTags: ["#cloud"] }, h.controller.signal))
      .toEqual({ status: "failure", reason: "busy" });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
    complete(); await first;
    expect(await h.apply(authorization, ["#cloud"])).toEqual({ status: "applied", addedTags: ["#cloud"] });
  });
  it("guards the same TFile identity after an external rename while pending", async () => {
    const h = harness(); const authorization = h.authorize();
    let complete!: () => void;
    h.fileManager.processFrontMatter.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    const first = h.apply(authorization);
    h.file.path = "Synthetic/Renamed.md"; h.file.name = "Renamed.md"; h.file.basename = "Renamed";
    const renamed = new TagApplyAuthorizationService(h.vault, h.metadata).capture({ ...h.outcome, source: new NoteSource(h.file) });
    if (renamed.status !== "captured") throw new Error("Synthetic renamed capture failed");
    expect(await h.apply(renamed.authorization, ["#cloud"])).toEqual({ status: "failure", reason: "busy" });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
    complete(); await first;
  });
  it.each(["inline", "missing"])("rejects metadata %s changing while the mutation API reads", async (change) => {
    const h = harness(); const authorization = h.authorize();
    h.fileManager.processFrontMatter.mockImplementationOnce(async (_file, callback) => {
      if (change === "inline") h.tags(["#manual"]);
      else h.metadata.getFileCache.mockReturnValue(null);
      callback(h.frontmatter);
    });
    expect(await h.apply(authorization)).toEqual({ status: "failure", reason: change === "inline" ? "tag-state-changed" : "metadata-unavailable" });
    expect(h.frontmatter).toEqual({});
  });
  it.each(["source", "revision", "frontmatter"])("rejects %s changes during API read before callback assignment", async (change) => {
    const h = harness(); const authorization = h.authorize();
    h.fileManager.processFrontMatter.mockImplementationOnce(async (_file, callback) => {
      if (change === "source") h.file.path = "Renamed.md";
      if (change === "revision") h.file.stat.mtime++;
      if (change === "frontmatter") { h.frontmatter.tags = ["manual"]; h.callbackTags(["#manual"]); }
      callback(h.frontmatter);
    });
    expect(await h.apply(authorization)).toEqual({ status: "failure", reason: change === "frontmatter" ? "tag-state-changed" : `${change}-changed` });
    expect(h.frontmatter.tags).toEqual(change === "frontmatter" ? ["manual"] : undefined);
  });
  it("has no provider, Secret, HTTP, logging, or body-read calls", async () => {
    const h = harness(); const network = vi.fn(() => { throw new Error("Forbidden network"); });
    vi.stubGlobal("fetch", network);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await h.apply(h.authorize());
      expect(network).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
