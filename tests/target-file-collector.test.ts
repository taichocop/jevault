import type { TAbstractFile, TFile, TFolder } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => import("./helpers/obsidian-move"));

import { TFile as FakeFile, TFolder as FakeFolder } from "./helpers/obsidian-move";
import { OrganizationScope } from "../src/organizer/organization-scope";
import { TargetFileCollector } from "../src/organizer/target-file-collector";
import { DEFAULT_SETTINGS } from "../src/settings";
import { VaultService } from "../src/vault-service";

type Folder = FakeFolder;
function file(path: string) {
  return Object.assign(new FakeFile(path), { stat: { ctime: 1, mtime: 42, size: 123 } });
}
function folder(path: string, children: Folder["children"] = []) {
  const value = new FakeFolder(path);
  value.children = children;
  return value;
}
function harness(root = folder("Inbox"), configDir = ".obsidian") {
  const entries = new Map<string, Folder | FakeFile>();
  const register = (entry: Folder | FakeFile) => {
    entries.set(entry.path, entry);
    if (entry instanceof FakeFolder) entry.children.forEach(register);
  };
  register(root);
  const forbidden = vi.fn(() => { throw new Error("Forbidden boundary"); });
  const vault = {
    configDir,
    getAbstractFileByPath: vi.fn((path: string) => (entries.get(path) ?? null) as TAbstractFile | null),
    getAllFolders: vi.fn(() => [...entries.values()].filter(value => value instanceof FakeFolder) as unknown as TFolder[]),
    read: forbidden, cachedRead: forbidden, modify: forbidden, create: forbidden,
    createFolder: forbidden, delete: forbidden, rename: forbidden, process: forbidden,
    renameFile: forbidden, processFrontMatter: forbidden,
  };
  const collector = new TargetFileCollector(vault);
  const collect = (recursive = false, ignoredFolders: string[] = [], signal?: AbortSignal) =>
    collector.collect(new OrganizationScope(root as unknown as TFolder, recursive), { ignoredFolders }, signal);
  return { root, entries, vault, forbidden, collector, collect };
}
function paths(result: ReturnType<TargetFileCollector["collect"]>) {
  expect(result.status).toBe("collected");
  if (result.status !== "collected") throw new Error("Expected synthetic collection");
  return result.targets.map(target => target.snapshot.path);
}

afterEach(() => vi.restoreAllMocks());

describe("OrganizationScope and TargetFileCollector", () => {
  it("captures immutable selected folder identity, path and explicit recursion", () => {
    const root = folder("健康/運動");
    const scope = new OrganizationScope(root as unknown as TFolder, true);
    expect(scope.rootFolderPath).toBe("健康/運動");
    expect(scope.includeSubfolders).toBe(true);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(scope.matches(root as unknown as TFolder)).toBe(true);
    expect(scope.matches(folder(root.path) as unknown as TFolder)).toBe(false);
    root.path = "健康/別";
    expect(scope.rootFolderPath).toBe("健康/運動");
    expect(scope.matches(root as unknown as TFolder)).toBe(false);
  });

  it.each(["deleted", "renamed", "moved", "replacement", "file", "error"])(
    "fails closed for %s root without exposing exceptions or falling back", change => {
      const h = harness(folder("Inbox", [file("Inbox/A.md")]));
      const scope = new OrganizationScope(h.root as unknown as TFolder, true);
      if (change === "deleted") h.entries.delete("Inbox");
      if (change === "renamed") h.root.path = "Other";
      if (change === "moved") h.root.path = "Projects/Inbox";
      if (change === "replacement") h.entries.set("Inbox", folder("Inbox"));
      if (change === "file") h.entries.set("Inbox", file("Inbox"));
      if (change === "error") h.vault.getAbstractFileByPath.mockImplementation(() => { throw new Error("/private/synthetic/path"); });
      expect(h.collector.collect(scope, { ignoredFolders: [] })).toEqual({ status: "failure", reason: "scope-changed" });
      expect(h.forbidden).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])("collects direct Markdown and optionally nested Markdown: %s", recursive => {
    const h = harness(folder("Inbox", [
      file("Inbox/B.MD"), file("Inbox/A.md"), file("Inbox/image.png"),
      file("Inbox/doc.pdf"), file("Inbox/map.canvas"),
      folder("Inbox/Nested", [file("Inbox/Nested/C.md")]),
    ]));
    expect(paths(h.collect(recursive))).toEqual(recursive
      ? ["Inbox/A.md", "Inbox/B.MD", "Inbox/Nested/C.md"] : ["Inbox/A.md", "Inbox/B.MD"]);
  });

  it.each(["Ignored", "Ignored/Child", ".config", ".config/Child"])(
    "distinguishes excluded scope %s from an eligible empty folder", path => {
      const h = harness(folder(path), "/.config/");
      expect(h.collect(true, ["/Ignored/"])).toEqual({ status: "failure", reason: "scope-excluded" });
    },
  );

  it("skips ignored/config subtrees before reading children, preserving siblings and dot folders", () => {
    const ignored = folder("Root/Ignored");
    const config = folder("Root/Config");
    const h = harness(folder("Root", [ignored, config, folder("Root/IgnoredOld", [file("Root/IgnoredOld/A.md")]),
      folder("Root/.visible", [file("Root/.visible/B.md")])] ), "Root/Config");
    const ignoredChildren = vi.spyOn(ignored, "children", "get");
    const configChildren = vi.spyOn(config, "children", "get");
    expect(paths(h.collect(true, ["/Root/Ignored/"]))).toEqual(["Root/.visible/B.md", "Root/IgnoredOld/A.md"]);
    expect(ignoredChildren).not.toHaveBeenCalled();
    expect(configChildren).not.toHaveBeenCalled();
  });

  it("allows Inbox sources and descendants while destination discovery excludes them", () => {
    const h = harness(folder("Inbox", [file("Inbox/A.md"), folder("Inbox/Nested", [file("Inbox/Nested/B.md")])]));
    const settings = { ...DEFAULT_SETTINGS, ignoredFolders: [] };
    expect(paths(h.collector.collect(new OrganizationScope(h.root as unknown as TFolder, true), settings)))
      .toEqual(["Inbox/A.md", "Inbox/Nested/B.md"]);
    expect(new VaultService(h.vault).getAvailableFolderPaths(settings)).toEqual([]);
    expect(h.collect(true, ["Inbox"])).toEqual({ status: "failure", reason: "scope-excluded" });
  });

  it("keeps current normalization and Japanese nested paths", () => {
    const h = harness(folder("健康", [folder("健康/運動", [file("健康/運動/記録.md")]),
      folder("健康/除外", [file("健康/除外/A.md")])]));
    expect(paths(h.collect(true, ["", "   ", "/健康/除外/"]))).toEqual(["健康/運動/記録.md"]);
  });

  it("captures immutable exact source and snapshot without body/hash or future plan state", () => {
    const note = file("Inbox/A.md");
    const h = harness(folder("Inbox", [note]));
    const result = h.collect();
    if (result.status !== "collected") throw new Error("Synthetic collection failed");
    const target = result.targets[0];
    expect(target.snapshot).toEqual({ path: "Inbox/A.md", mtime: 42, size: 123 });
    expect(target.source.path).toBe(target.snapshot.path);
    expect(target.source.matches(note as unknown as TFile)).toBe(true);
    expect(target.source.matches(file(note.path) as unknown as TFile)).toBe(false);
    expect(Object.keys(target).sort()).toEqual(["snapshot", "source"]);
    expect([result.targets, target, target.snapshot, target.source].every(Object.isFrozen)).toBe(true);
    note.stat.mtime = 99;
    note.stat.size = 999;
    note.path = "Other.md";
    expect(target.snapshot).toEqual({ path: "Inbox/A.md", mtime: 42, size: 123 });
  });

  it.each([undefined, { mtime: NaN, size: 1 }, { mtime: Infinity, size: 1 },
    { mtime: 1, size: NaN }, { mtime: 1, size: Infinity }, { mtime: 1, size: -1 }])(
    "rejects invalid/unavailable stat %j without fabricating zeroes", stat => {
      const note = Object.assign(new FakeFile("Inbox/A.md"), { stat });
      expect(harness(folder("Inbox", [note])).collect()).toEqual({ status: "failure", reason: "invalid-target" });
    },
  );

  it("accepts actual finite zero metadata", () => {
    const note = file("Inbox/A.md"); note.stat.mtime = 0; note.stat.size = 0;
    expect(paths(harness(folder("Inbox", [note])).collect())).toEqual([note.path]);
  });

  it("sorts explicitly regardless of children insertion order", () => {
    const a = file("Root/A.md"), b = file("Root/Z.md"), c = folder("Root/Nested", [file("Root/Nested/日本語.md")]);
    const h = harness(folder("Root", [b, c, a]));
    const first = paths(h.collect(true));
    h.root.children.reverse();
    expect(paths(h.collect(true))).toEqual(first);
    expect(first).toEqual(["Root/A.md", "Root/Nested/日本語.md", "Root/Z.md"]);
    expect(new Set(first).size).toBe(first.length);
  });

  it.each(["same-object", "different-object", "missing", "outside"])("rejects invalid target identity: %s", change => {
    const a = file("Inbox/A.md");
    const h = harness(folder("Inbox", [a]));
    if (change === "same-object") h.root.children.push(a);
    if (change === "different-object") h.root.children.push(file(a.path));
    if (change === "missing") h.entries.delete(a.path);
    if (change === "outside") { a.path = "Other/A.md"; h.entries.set(a.path, a); }
    expect(h.collect(true)).toEqual({ status: "failure", reason: "invalid-target" });
  });

  it("rejects replacement during traversal and final target re-resolution", () => {
    const h = harness(folder("Inbox", [file("Inbox/A.md")]));
    const original = h.vault.getAbstractFileByPath.getMockImplementation()!;
    let fileReads = 0;
    h.vault.getAbstractFileByPath.mockImplementation(path => {
      if (path.endsWith(".md") && ++fileReads === 2) return file(path) as unknown as TFile;
      return original(path);
    });
    expect(h.collect()).toEqual({ status: "failure", reason: "invalid-target" });
    h.vault.getAbstractFileByPath.mockImplementation(path => {
      if (path.endsWith(".md")) h.entries.set("Inbox", folder("Inbox"));
      return original(path);
    });
    expect(h.collect()).toEqual({ status: "failure", reason: "scope-changed" });
  });

  it("returns successful empty collection for empty or non-Markdown folders", () => {
    expect(harness().collect()).toEqual({ status: "collected", targets: [] });
    expect(harness(folder("Inbox", [new FakeFile("Inbox/image.png")])).collect()).toEqual({ status: "collected", targets: [] });
  });

  it("supports Vault root through public path resolution", () => {
    expect(paths(harness(folder("/", [file("A.md"), folder("Nested", [file("Nested/B.md")])])).collect(true)))
      .toEqual(["A.md", "Nested/B.md"]);
  });

  it("pre-aborted and traversal-boundary cancellation return no partial targets", () => {
    const h = harness(folder("Inbox", [file("Inbox/A.md"), file("Inbox/B.md")]));
    const controller = new AbortController(); controller.abort();
    expect(h.collect(true, [], controller.signal)).toEqual({ status: "cancelled" });
    expect(h.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    const mid = new AbortController();
    const original = h.vault.getAbstractFileByPath.getMockImplementation()!;
    h.vault.getAbstractFileByPath.mockImplementation(path => {
      if (path.endsWith("A.md")) mid.abort();
      return original(path);
    });
    expect(h.collect(true, [], mid.signal)).toEqual({ status: "cancelled" });
  });

  it("performs no body reads, mutations, provider/Secret calls, telemetry or logging", () => {
    const h = harness(folder("Inbox", [file("Inbox/A.md")]));
    const log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error"), warn = vi.spyOn(console, "warn");
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(paths(h.collect(true))).toEqual(["Inbox/A.md"]);
    expect(h.forbidden).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    // Secret/providerを渡せない最小constructor境界で、未注入の依存を取得しない。
    expect(h.vault.getAllFolders).not.toHaveBeenCalled();
  });
});
