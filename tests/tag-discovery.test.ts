import type { CachedMetadata, TFile } from "obsidian";
import { getAllTags } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TagDiscoveryService } from "../src/tags/tag-discovery-service";

vi.mock("obsidian", () => ({ getAllTags: vi.fn() }));

interface MetadataFixture {
  path: string;
  cache: CachedMetadata | null;
  canonicalTags: string[] | null;
}

function inline(...names: string[]): CachedMetadata {
  return {
    tags: names.map((tag) => ({
      tag,
      position: {
        start: { line: 0, col: 0, offset: 0 },
        end: { line: 0, col: tag.length, offset: tag.length },
      },
    })),
  };
}

function fixture(
  cache: CachedMetadata | null,
  canonicalTags: string[] | null,
  path = "Synthetic.md",
): MetadataFixture {
  return { path, cache, canonicalTags };
}

function harness(fixtures: MetadataFixture[]) {
  const files = fixtures.map(({ path }) => ({ path }) as TFile);
  const caches = new Map(files.map((file, index) => [file, fixtures[index].cache]));
  const apiResults = new Map(
    fixtures.map(({ cache, canonicalTags }) => [cache, canonicalTags]),
  );
  // Obsidian runtimeはunit testにないため、公式helperの応答を明示的にfakeする。
  // frontmatterの独自parserをtest側にも作らず、cacheの委譲と返り値の保持を検証する。
  vi.mocked(getAllTags).mockImplementation((cache) => {
    if (!apiResults.has(cache)) throw new Error("Unexpected synthetic cache");
    return apiResults.get(cache) ?? null;
  });
  const forbidden = vi.fn(() => {
    throw new Error("Discovery must use only metadata");
  });
  const vault = {
    getMarkdownFiles: vi.fn(() => files),
    read: forbidden,
    cachedRead: forbidden,
    modify: forbidden,
    rename: forbidden,
    create: forbidden,
    createFolder: forbidden,
    delete: forbidden,
  };
  const metadataCache = {
    getFileCache: vi.fn((file: TFile) => caches.get(file) ?? null),
  };
  return {
    service: new TagDiscoveryService(vault, metadataCache),
    vault,
    metadataCache,
    files,
    forbidden,
  };
}

describe("TagDiscoveryService", () => {
  beforeEach(() => vi.resetAllMocks());

  it("collects inline metadata through getAllTags", () => {
    const cache = inline("#rails", "#aws");
    const { service, files, metadataCache } = harness([
      fixture(cache, ["#rails", "#aws"]),
    ]);

    expect(service.discover()).toEqual([
      { id: "tag_001", name: "#aws" },
      { id: "tag_002", name: "#rails" },
    ]);
    expect(metadataCache.getFileCache).toHaveBeenCalledWith(files[0]);
    expect(getAllTags).toHaveBeenCalledExactlyOnceWith(cache);
  });

  it("delegates frontmatter tags to the official helper", () => {
    const cache = { frontmatter: { tags: ["aws", "rails"] } };
    const { service } = harness([fixture(cache, ["#aws", "#rails"])]);

    expect(service.discover().map(({ name }) => name)).toEqual(["#aws", "#rails"]);
    expect(getAllTags).toHaveBeenCalledExactlyOnceWith(cache);
  });

  it("deduplicates mixed inline and frontmatter helper results", () => {
    const cache = { ...inline("#aws"), frontmatter: { tags: ["aws", "rails"] } };
    const { service } = harness([fixture(cache, ["#aws", "#aws", "#rails"])]);

    expect(service.discover().map(({ name }) => name)).toEqual(["#aws", "#rails"]);
    expect(getAllTags).toHaveBeenCalledExactlyOnceWith(cache);
  });

  it("deduplicates globally across files", () => {
    const { service } = harness([
      fixture(inline("#aws"), ["#aws"], "A.md"),
      fixture({ frontmatter: { tags: ["aws"] } }, ["#aws"], "B.md"),
      fixture(inline("#aws"), ["#aws"], "C.md"),
    ]);
    expect(service.discover()).toEqual([{ id: "tag_001", name: "#aws" }]);
  });

  it("preserves hierarchical tags without expanding parents", () => {
    const names = ["#programming/aws", "#programming/ruby", "#project/jevault"];
    expect(harness([fixture(inline(...names), names)]).service.discover()
      .map(({ name }) => name)).toEqual(names);
  });

  it("keeps names, IDs and order stable across file and helper iteration order", () => {
    const fixtures = [
      fixture(inline("#z", "#aws"), ["#z", "#aws"], "A.md"),
      fixture(inline("#rails", "#aws"), ["#rails", "#aws"], "B.md"),
    ];
    const expected = harness(fixtures).service.discover();
    const reversed = [...fixtures].reverse().map((entry) => ({
      ...entry, canonicalTags: entry.canonicalTags ? [...entry.canonicalTags].reverse() : null,
    }));
    expect(harness(reversed).service.discover()).toEqual(expected);
    expect(expected).toEqual([
      { id: "tag_001", name: "#aws" },
      { id: "tag_002", name: "#rails" },
      { id: "tag_003", name: "#z" },
    ]);
  });

  it("preserves case and Unicode differences in UTF-16 code unit order", () => {
    const names = ["#日本語/学習", "#é", "#aws", "#e\u0301", "#AWS"];
    expect(harness([fixture(inline(...names), names)]).service.discover()
      .map(({ name }) => name)).toEqual([
      "#AWS", "#aws", "#e\u0301", "#é", "#日本語/学習",
    ]);
  });

  it("assigns unique opaque IDs without truncating a large tag set", () => {
    const names = Array.from({ length: 1005 }, (_, index) => `#project/${index}`);
    const { service } = harness([fixture(inline(...names), names)]);
    const candidates = service.discover();
    expect(candidates).toHaveLength(names.length);
    expect(new Set(candidates.map(({ id }) => id)).size).toBe(names.length);
    expect(candidates.every(({ id }) => /^tag_\d{3,}$/.test(id))).toBe(true);
    expect(candidates.every(({ id }) => !names.includes(id))).toBe(true);
    expect(service.discover()).toEqual(candidates);
  });

  it("skips a missing cache and continues discovering other files", () => {
    const cache = inline("#aws");
    const { service, forbidden } = harness([
      fixture(null, null, "Missing.md"), fixture(cache, ["#aws"], "Ready.md"),
    ]);
    expect(service.discover()).toEqual([{ id: "tag_001", name: "#aws" }]);
    expect(getAllTags).toHaveBeenCalledExactlyOnceWith(cache);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("returns an empty list for a Vault without Markdown files", () => {
    expect(harness([]).service.discover()).toEqual([]);
    expect(getAllTags).not.toHaveBeenCalled();
  });

  it.each([null, []])("returns an empty list when getAllTags returns %s", (tags) => {
    expect(harness([fixture({}, tags)]).service.discover()).toEqual([]);
  });

  it("does not apply folder exclusions to Markdown files returned by the Vault", () => {
    const paths = ["Inbox/A.md", "Templates/B.md", ".obsidian/C.md"];
    const fixtures = paths.map((path, index) =>
      fixture(inline(`#tag${index}`), [`#tag${index}`], path));
    expect(harness(fixtures).service.discover()).toHaveLength(3);
  });

  it("uses only metadata without body reads, mutation, or HTTP", () => {
    const { service, forbidden } = harness([
      fixture(inline("#aws"), ["#aws"]),
    ]);
    const fetch = vi.fn(() => { throw new Error("Unexpected network request"); });
    vi.stubGlobal("fetch", fetch);
    try {
      expect(service.discover()).toEqual([{ id: "tag_001", name: "#aws" }]);
      expect(forbidden).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
    // constructorにはVault/MetadataCacheの狭いread-only境界しかなく、
    // Classifier・TypeSafeAdapter・Secret・HTTP clientを注入する経路がない。
  });
});
