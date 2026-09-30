import type { CachedMetadata, TFile } from "obsidian";
import { getAllTags } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { NoteSource } from "../src/note-source";
import { ExistingTagSnapshotService } from "../src/tags/existing-tag-snapshot";

vi.mock("obsidian", () => ({ getAllTags: vi.fn() }));

function harness(cache: CachedMetadata | null = {}) {
  const file = { path: "Synthetic/A.md" } as TFile;
  const forbidden = vi.fn(() => { throw new Error("Forbidden read or mutation"); });
  const vault = {
    getFileByPath: vi.fn((): TFile | null => file),
    read: forbidden, cachedRead: forbidden, modify: forbidden, rename: forbidden,
    delete: forbidden, create: forbidden, createFolder: forbidden,
  };
  const metadata = { getFileCache: vi.fn(() => cache) };
  vi.mocked(getAllTags).mockReset().mockReturnValue([]);
  const source = new NoteSource(file);
  const service = new ExistingTagSnapshotService(vault, metadata);
  return { service, file, source, vault, metadata, forbidden };
}

describe("ExistingTagSnapshotService", () => {
  it.each([
    [{ tags: [{ tag: "#inline" }] }, ["#inline"]],
    [{ frontmatter: { tags: ["frontmatter"] } }, ["#frontmatter"]],
    [{}, ["#programming/aws", "#AWS", "#aws", "#日本語", "#é", "#e\u0301"]],
  ])("preserves official helper results without parsing or normalization", (cache, names) => {
    const h = harness(cache as CachedMetadata);
    vi.mocked(getAllTags).mockReturnValue(names as string[]);
    expect(h.service.snapshot(h.source)).toEqual({ status: "available", names });
    expect(h.metadata.getFileCache).toHaveBeenCalledExactlyOnceWith(h.file);
    expect(getAllTags).toHaveBeenCalledExactlyOnceWith(cache);
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("uses original metadata after active file switches", () => {
    const h = harness();
    const workspace = { getActiveFile: vi.fn(() => ({ path: "B.md" })) };
    vi.mocked(getAllTags).mockReturnValue(["#original"]);
    expect(h.service.snapshot(h.source)).toEqual({ status: "available", names: ["#original"] });
    expect(h.vault.getFileByPath).toHaveBeenCalledExactlyOnceWith("Synthetic/A.md");
    expect(workspace.getActiveFile).not.toHaveBeenCalled();
  });
  it.each(["replacement", "missing", "rename"])("rejects %s identity without reading metadata", (state) => {
    const h = harness();
    if (state === "replacement") h.vault.getFileByPath.mockReturnValue({ path: h.source.path } as TFile);
    if (state === "missing") h.vault.getFileByPath.mockReturnValue(null);
    if (state === "rename") h.file.path = "Renamed.md";
    expect(h.service.snapshot(h.source)).toEqual({ status: "unavailable" });
    expect(h.metadata.getFileCache).not.toHaveBeenCalled();
    expect(getAllTags).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("distinguishes unavailable cache from a known empty tag set", () => {
    const missing = harness(null);
    expect(missing.service.snapshot(missing.source)).toEqual({ status: "unavailable" });
    expect(getAllTags).not.toHaveBeenCalled();
    expect(missing.forbidden).not.toHaveBeenCalled();
    const empty = harness({});
    vi.mocked(getAllTags).mockReturnValue(null);
    expect(empty.service.snapshot(empty.source)).toEqual({ status: "available", names: [] });
  });
  it("copies helper output and deduplicates exact names only", () => {
    const h = harness();
    const names = ["#a", "#a", "#A"];
    vi.mocked(getAllTags).mockReturnValue(names);
    const snapshot = h.service.snapshot(h.source);
    names.push("#later");
    expect(snapshot).toEqual({ status: "available", names: ["#a", "#A"] });
  });
});
