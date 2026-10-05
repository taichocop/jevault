import type { TAbstractFile, TFile, TFolder } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => import("./helpers/obsidian-move"));

import { TFile as FakeFile, TFolder as FakeFolder } from "./helpers/obsidian-move";
import { OrganizationScope } from "../src/organizer/organization-scope";
import { OrganizationTargetReader } from "../src/organizer/organization-target-reader";
import { TargetFileCollector } from "../src/organizer/target-file-collector";
import { ClassificationService } from "../src/classification/classification-service";
import { CandidateBuilder } from "../src/classification/candidate-builder";
import { TagSuggestionService } from "../src/tags/tag-suggestion-service";
import { DEFAULT_SETTINGS } from "../src/settings";

function fixture(path = "Inbox/記録.MD") {
  return Object.assign(new FakeFile(path), { stat: { ctime: 1, mtime: 42, size: 123 } });
}
function harness() {
  const file = fixture();
  const root = new FakeFolder("Inbox"); root.children = [file];
  const entries = new Map<string, FakeFile | FakeFolder>([[root.path, root], [file.path, file]]);
  const forbidden = vi.fn(() => { throw new Error("Forbidden synthetic operation"); });
  const vault = {
    configDir: ".obsidian",
    getAbstractFileByPath: vi.fn((path: string) => (entries.get(path) ?? null) as TAbstractFile | null),
    read: vi.fn<(file: TFile) => Promise<string>>(async () => "Synthetic exact body"),
    cachedRead: forbidden, modify: forbidden, create: forbidden, createFolder: forbidden,
    delete: forbidden, rename: forbidden, process: forbidden, renameFile: forbidden, processFrontMatter: forbidden,
  };
  const collection = new TargetFileCollector(vault).collect(new OrganizationScope(root as unknown as TFolder, false), { ignoredFolders: [] });
  if (collection.status !== "collected") throw new Error("Synthetic collection failed");
  const target = collection.targets[0];
  vault.getAbstractFileByPath.mockClear();
  const reader = new OrganizationTargetReader(vault);
  const getActiveNoteState = vi.fn(async () => ({ status: "ready" as const,
    note: { title: "Other", path: "Other.md", body: "Unrelated synthetic body" }, source: target.source }));
  const getApiKey = vi.fn(() => "synthetic-only");
  const classify = vi.fn(async () => ({ candidates: [{ path: "Archive", probability: 1 }] }));
  const evaluate = vi.fn(async () => ({ evaluations: [] }));
  const folders = new ClassificationService({ getActiveNoteState }, { getAvailableFolderPaths: () => ["Archive"] },
    new CandidateBuilder(), { getApiKey }, () => ({ classify }), () => DEFAULT_SETTINGS);
  const tags = new TagSuggestionService({ getActiveNoteState }, { discover: () => [{ id: "tag_001", name: "#existing" }] },
    { getApiKey }, () => ({ evaluate }), () => DEFAULT_SETTINGS);
  // 次Issueのorchestrationをproductionへ追加せず、公開境界の接続だけをfixtureで検証する。
  const analyze = async (signal?: AbortSignal) => {
    const result = await reader.read(target, signal);
    if (result.status === "ready") {
      await folders.classifyNote(result.note, result.source, signal);
      await tags.suggestForNote(result.note, result.source, signal);
    }
    return result;
  };
  return { file, entries, vault, target, reader, forbidden, getActiveNoteState, getApiKey, classify, evaluate, analyze };
}
const changes = ["delete", "rename", "move", "replacement", "non-markdown", "extension", "mtime", "size", "invalid-mtime", "invalid-size", "negative-size", "missing-stat", "resolve-error"] as const;
function change(h: ReturnType<typeof harness>, kind: typeof changes[number]) {
  if (kind === "delete") h.entries.delete(h.target.snapshot.path);
  if (kind === "rename") h.file.path = "Inbox/Renamed.md";
  if (kind === "move") h.file.path = "Elsewhere/記録.MD";
  if (kind === "replacement") h.entries.set(h.target.snapshot.path, fixture());
  if (kind === "non-markdown") h.entries.set(h.target.snapshot.path, fixture("Inbox/image.png"));
  if (kind === "extension") h.file.extension = "png";
  if (kind === "mtime") h.file.stat.mtime++;
  if (kind === "size") h.file.stat.size++;
  if (kind === "invalid-mtime") h.file.stat.mtime = Infinity;
  if (kind === "invalid-size") h.file.stat.size = NaN;
  if (kind === "negative-size") h.file.stat.size = -1;
  if (kind === "missing-stat") Object.assign(h.file, { stat: undefined });
  if (kind === "resolve-error") h.vault.getAbstractFileByPath.mockImplementation(() => { throw new Error("/private/synthetic/path"); });
}
function expectNoAnalysis(h: ReturnType<typeof harness>) {
  expect(h.getApiKey).not.toHaveBeenCalled();
  expect(h.classify).not.toHaveBeenCalled(); expect(h.evaluate).not.toHaveBeenCalled();
  expect(h.getActiveNoteState).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
}
afterEach(() => vi.restoreAllMocks());

describe("OrganizationTargetReader", () => {
  it("reads the exact collected file into frozen short-lived input with no active fallback", async () => {
    const h = harness();
    const result = await h.reader.read(h.target);
    expect(result).toEqual({ status: "ready", source: h.target.source, snapshot: h.target.snapshot,
      note: { title: "記録", path: "Inbox/記録.MD", body: "Synthetic exact body" } });
    if (result.status !== "ready") throw new Error("Expected ready");
    expect([result, result.note, result.snapshot].every(Object.isFrozen)).toBe(true);
    expect(result.source).toBe(h.target.source);
    expect(h.vault.read).toHaveBeenCalledExactlyOnceWith(h.file);
    expect(h.vault.getAbstractFileByPath).toHaveBeenNthCalledWith(1, h.target.snapshot.path);
    expect(h.vault.getAbstractFileByPath).toHaveBeenNthCalledWith(2, h.target.snapshot.path);
    expectNoAnalysis(h);
  });

  it("keeps the target when active note switches during read and sends only that body", async () => {
    const h = harness();
    h.vault.read.mockImplementation(async () => {
      h.getActiveNoteState.mockResolvedValue({ status: "ready", source: h.target.source,
        note: { title: "Switched", path: "Switched.md", body: "Other body" } });
      return "Synthetic exact body";
    });
    const result = await h.analyze();
    expect(result.status).toBe("ready");
    expect(h.classify.mock.calls[0]).toEqual([expect.objectContaining({ path: h.target.snapshot.path, body: "Synthetic exact body" }), expect.any(Array), undefined]);
    expect(h.evaluate.mock.calls[0]).toEqual([expect.objectContaining({ path: h.target.snapshot.path, body: "Synthetic exact body" }), expect.any(Array), undefined]);
    expect(h.getActiveNoteState).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
    expect(h.vault.read).toHaveBeenCalledExactlyOnceWith(h.file);
    expect(h.getApiKey.mock.invocationCallOrder[0]).toBeGreaterThan(h.vault.getAbstractFileByPath.mock.invocationCallOrder[1]);
  });

  it.each(changes)("rejects %s before read without Secret/provider work", async kind => {
    const h = harness(); change(h, kind);
    expect(await h.analyze()).toEqual({ status: "failure", reason: "source-changed" });
    expect(h.vault.read).not.toHaveBeenCalled(); expectNoAnalysis(h);
  });

  it.each(changes)("rejects %s during read without forwarding stale body", async kind => {
    const h = harness();
    h.vault.read.mockImplementation(async () => { change(h, kind); return "Synthetic stale body"; });
    expect(await h.analyze()).toEqual({ status: "failure", reason: "source-changed" });
    expect(h.vault.read).toHaveBeenCalledExactlyOnceWith(h.file); expectNoAnalysis(h);
    expect(h.target.snapshot).toEqual({ path: "Inbox/記録.MD", mtime: 42, size: 123 });
  });

  it("rejects a snapshot path inconsistent with source instead of rebinding", async () => {
    const h = harness();
    expect(await h.reader.read({ source: h.target.source, snapshot: { ...h.target.snapshot, path: "Other.md" } }))
      .toEqual({ status: "failure", reason: "source-changed" });
    expect(h.vault.read).not.toHaveBeenCalled(); expectNoAnalysis(h);
  });

  it("sanitizes read exceptions without logging path, body or exception details", async () => {
    const h = harness();
    const log = vi.spyOn(console, "log"), warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error");
    const fetch = vi.spyOn(globalThis, "fetch");
    h.vault.read.mockRejectedValue(new Error("/private/synthetic/path Synthetic exact body"));
    expect(await h.analyze()).toEqual({ status: "failure", reason: "read-failed" });
    expectNoAnalysis(h);
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["entry", "resolution"])("cancels at %s with no body read", async stage => {
    const h = harness(); const controller = new AbortController();
    if (stage === "entry") controller.abort("private synthetic reason");
    else h.vault.getAbstractFileByPath.mockImplementation(() => { controller.abort(); return h.file as unknown as TFile; });
    expect(await h.analyze(controller.signal)).toEqual({ status: "cancelled" });
    expect(h.vault.read).not.toHaveBeenCalled(); expectNoAnalysis(h);
    if (stage === "entry") expect(h.vault.getAbstractFileByPath).not.toHaveBeenCalled();
  });

  it.each([false, true])("waits for in-flight read then cancels, including read rejection: %s", async rejects => {
    const h = harness(); const controller = new AbortController();
    let finish!: () => void;
    h.vault.read.mockImplementation(() => new Promise((resolve, reject) => {
      finish = () => rejects ? reject(new Error("private read error")) : resolve("Synthetic body");
    }));
    const pending = h.analyze(controller.signal);
    controller.abort("private synthetic reason");
    expectNoAnalysis(h);
    finish();
    expect(await pending).toEqual({ status: "cancelled" }); expectNoAnalysis(h);
    expect(h.vault.read).toHaveBeenCalledOnce();
  });
});
