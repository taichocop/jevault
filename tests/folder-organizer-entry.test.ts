import type { App, Menu, TAbstractFile, EventRef } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ classify: vi.fn(), evaluate: vi.fn() }));
vi.mock("../src/classification/typesafe-adapter", () => ({ TypeSafeAdapter: class {
  classify = provider.classify;
  evaluate = provider.evaluate;
} }));
vi.mock("../src/settings-tab", () => ({ JevaultSettingTab: class {} }));
vi.mock("obsidian", async () => {
  const base = await import("./helpers/obsidian-move");
  class Plugin {
    app: unknown;
    registered: unknown[] = [];
    async loadData() { return {}; }
    saveData = vi.fn();
    addCommand() {}
    addSettingTab() {}
    registerEvent(ref: unknown) { this.registered.push(ref); }
  }
  return { ...base, Plugin, Notice: class {} };
});

import { readFileSync } from "node:fs";
import { FolderOrganizerService } from "../src/organizer/folder-organizer-service";
import { ClassificationService } from "../src/classification/classification-service";
import { TagSuggestionService } from "../src/tags/tag-suggestion-service";
import type { FolderOrganizerAnalysisResult, FolderOrganizerProgress, OrganizationAnalysisStopReason } from "../src/organizer/organization-analysis-result";
import type { OrganizationTarget } from "../src/organizer/target-file-collector";

import JevaultPlugin from "../src/main";
import { FolderOrganizerScopeModal } from "../src/organizer/folder-organizer-scope-modal";
import { TargetFileCollector } from "../src/organizer/target-file-collector";
import { OrganizationScope } from "../src/organizer/organization-scope";
import { Element, TFile, TFolder } from "./helpers/obsidian-move";

class RadioElement extends Element {
  checked = false;
  private changeHandler?: (event: Partial<MouseEvent> & { detail: number }) => void;
  override createEl(tag: string, options?: { text?: string }): RadioElement {
    const child = new RadioElement(tag, options?.text, this.ownerDocument);
    this.children.push(child);
    return child;
  }
  override addEventListener(event: string, handler: (event: Partial<MouseEvent> & { detail: number }) => void): void {
    if (event === "change") this.changeHandler = handler;
    else super.addEventListener(event, handler);
  }
  change(): void { this.checked = true; this.changeHandler?.({ detail: 0 }); }
}
function note(path: string) { return Object.assign(new TFile(path), { stat: { mtime: 1, size: 2 } }); }
function folder(path: string, children: TFolder["children"] = []) { return Object.assign(new TFolder(path), { children }); }
function menu() {
  const items: Array<{ title: string; click(): void }> = [];
  const value = { addItem(callback: (item: unknown) => void) {
    const item = { title: "", click: () => {},
      setTitle(title: string) { this.title = title; return this; },
      onClick(click: () => void) { this.click = click; return this; } };
    callback(item); items.push(item);
  } } as unknown as Menu;
  return { value, items };
}
function harness() {
  const root = folder("Inbox", [note("Inbox/A.md"), folder("Inbox/Nested", [note("Inbox/Nested/B.md")])]);
  const entries = new Map<string, TFolder | TFile>();
  const register = (file: TFolder | TFile) => { entries.set(file.path, file); if (file instanceof TFolder) file.children.forEach(register); };
  register(root);
  const forbidden = vi.fn(() => { throw new Error("Forbidden synthetic boundary"); });
  const deny = () => vi.fn<(...args: unknown[]) => unknown>(() => forbidden());
  const getSecret = vi.fn();
  let active: TFolder | TFile = note("Other.md");
  const listeners = new Map<EventRef, (menu: Menu, file: TAbstractFile) => void>();
  const on = vi.fn((_name: string, callback: (menu: Menu, file: TAbstractFile) => void) => {
    const ref = {} as EventRef; listeners.set(ref, callback); return ref;
  });
  const plugin = new JevaultPlugin({} as App, {} as never);
  const vault = { configDir: ".obsidian", getAbstractFileByPath: vi.fn((path: string) => entries.get(path) ?? null),
    read: deny(), cachedRead: deny(), modify: deny(), create: deny(), createFolder: deny(),
    delete: deny(), rename: deny(), process: deny(), getMarkdownFiles: deny(), getAllFolders: deny() };
  plugin.app = { workspace: { on, getActiveFile: () => active }, vault,
    secretStorage: { getSecret }, fileManager: { renameFile: deny(), processFrontMatter: deny() }, metadataCache: {},
  } as unknown as App;
  const collect = vi.spyOn(TargetFileCollector.prototype, "collect");
  const opened: FolderOrganizerScopeModal[] = [];
  vi.spyOn(FolderOrganizerScopeModal.prototype, "open").mockImplementation(function (this: FolderOrganizerScopeModal) {
    Object.assign(this, { contentEl: new RadioElement() });
    opened.push(this); this.onOpen();
  });
  const emit = (file: TFolder | TFile | object = root) => {
    const m = menu(); for (const callback of listeners.values()) callback(m.value, file as TAbstractFile); return m;
  };
  const open = () => { emit().items[0].click(); return opened.at(-1)!; };
  return { plugin, root, entries, vault, forbidden, getSecret, on, collect, opened, emit, open,
    switchActive: (file: TFolder | TFile) => { active = file; } };
}
function elements(modal: FolderOrganizerScopeModal) { return (modal.contentEl as unknown as RadioElement).all() as RadioElement[]; }
function button(modal: FolderOrganizerScopeModal, text: string) { return elements(modal).find(e => e.tag === "button" && e.text === text)!; }
function radio(modal: FolderOrganizerScopeModal, index: number) { return elements(modal).filter(e => e.tag === "input")[index]; }
function text(modal: FolderOrganizerScopeModal) { return elements(modal).map(e => e.text).filter(Boolean); }
function press(modal: FolderOrganizerScopeModal, key: string, options: Partial<KeyboardEvent> = {}) {
  const scope = modal.scope as unknown as { handlers: Map<string, (event: KeyboardEvent) => unknown> };
  scope.handlers.get(key)?.({ key, ...options } as KeyboardEvent);
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("Folder Organizer public plugin entry", () => {
  it("registers public file-menu with Plugin lifecycle; only TFolder gets the exact item", async () => {
    const h = harness(); await h.plugin.onload();
    expect(h.on).toHaveBeenCalledExactlyOnceWith("file-menu", expect.any(Function));
    expect((h.plugin as unknown as { registered: unknown[] }).registered).toEqual([...h.on.mock.results.map(r => r.value)]);
    expect(h.emit().items.map(i => i.title)).toEqual(["Jevault: Organize notes in this folder"]);
    expect(h.emit(note("A.md")).items).toEqual([]); expect(h.emit({ path: "Inbox" }).items).toEqual([]);
    expect(h.collect).not.toHaveBeenCalled(); expect(h.opened).toEqual([]);
    h.plugin.onunload(); expect(h.emit().items).toEqual([]);
  });

  it.each([false, true])("captures scope at menu click, consumes current settings only on Preview: recursive=%s", async recursive => {
    const h = harness(); await h.plugin.onload(); const m = h.emit();
    h.root.path = "InboxBeforeClick"; m.items[0].click(); h.root.path = "Inbox";
    const captured = h.opened[0]; expect(text(captured)).toContain("InboxBeforeClick"); captured.close();
    const modal = h.open();
    expect(text(modal)).toContain("Inbox"); expect(h.collect).not.toHaveBeenCalled();
    radio(modal, recursive ? 1 : 0).change(); expect(h.collect).not.toHaveBeenCalled();
    h.switchActive(note("Elsewhere.md")); h.switchActive(folder("Other"));
    h.plugin.settings = { ...h.plugin.settings, ignoredFolders: ["Unrelated"], inboxPath: "Inbox" };
    button(modal, "Preview notes").click(); expect(h.collect).toHaveBeenCalledOnce();
    const [scope, settings, signal] = h.collect.mock.calls[0];
    expect(scope).toBeInstanceOf(OrganizationScope); expect(scope.matches(h.root as never)).toBe(true);
    expect(scope.rootFolderPath).toBe("Inbox"); expect(scope.includeSubfolders).toBe(recursive);
    expect(settings).toEqual({ ignoredFolders: ["Unrelated"] }); expect(signal?.aborted).toBe(false);
    expect(text(modal)).toContain(recursive ? "2 Markdown notes found." : "1 Markdown note found.");
    expect(text(modal)).toContain("Analyze notes");
    expect(text(modal)).toContain(`Scope: ${recursive ? "Include subfolders" : "This folder only"}`);
    expect(h.forbidden).not.toHaveBeenCalled(); h.plugin.onunload();
  });

  it.each(["rename", "move", "delete", "replacement"])("fails closed after %s, retaining captured path without retarget", async change => {
    const h = harness(); await h.plugin.onload(); const modal = h.open();
    if (change === "rename") h.root.path = "Renamed";
    if (change === "move") h.root.path = "Other/Inbox";
    if (change === "delete") h.entries.delete("Inbox");
    if (change === "replacement") h.entries.set("Inbox", folder("Inbox", [note("Inbox/New.md")]));
    radio(modal, 1).change(); expect(text(modal)).toContain("Inbox");
    const preview = button(modal, "Preview notes"); preview.click(); preview.click();
    expect(h.collect).toHaveBeenCalledOnce(); expect(h.collect.mock.calls[0][0].rootFolderPath).toBe("Inbox");
    expect(text(modal)).toEqual(["The selected folder is no longer available. Open Folder Organizer again.", "Close"]);
    expect(h.forbidden).not.toHaveBeenCalled(); h.plugin.onunload();
  });

  it.each(["empty", "excluded", "invalid", "exception", "cancelled"])("renders safe one-shot result: %s", async outcome => {
    const h = harness(); await h.plugin.onload(); const modal = h.open();
    if (outcome === "empty") h.root.children = [];
    if (outcome === "excluded") h.plugin.settings.ignoredFolders = ["Inbox"];
    if (outcome === "invalid") h.root.children.push(note("Outside/A.md"));
    if (outcome === "exception") h.collect.mockImplementation(() => { throw new Error("/private/synthetic/secret-body"); });
    if (outcome === "cancelled") h.collect.mockReturnValue({ status: "cancelled" });
    const preview = button(modal, "Preview notes"); preview.click(); preview.click(); radio(modal, 1)?.change();
    expect(h.collect).toHaveBeenCalledOnce();
    const expected = { empty: ["No Markdown notes found in this scope.", "Close"],
      excluded: ["This folder is excluded from Folder Organizer.", "Close"],
      invalid: ["Jevault couldn't safely inspect this folder.", "Close"],
      exception: ["Jevault couldn't safely inspect this folder.", "Close"], cancelled: [] };
    expect(text(modal)).toEqual(expected[outcome as keyof typeof expected]);
    expect(h.forbidden).not.toHaveBeenCalled(); h.plugin.onunload();
  });

  it.each(["Cancel", "Escape", "Close", "unload"])("%s before Preview invalidates all stale callbacks", async action => {
    const h = harness(); await h.plugin.onload(); const staleMenu = h.emit(); const modal = h.open();
    const preview = button(modal, "Preview notes"); const recursive = radio(modal, 1);
    if (action === "Cancel") button(modal, "Cancel").click();
    if (action === "Escape") press(modal, "Escape");
    if (action === "Close") modal.close();
    if (action === "unload") h.plugin.onunload();
    recursive.change(); preview.click(); preview.focus(); press(modal, "Enter"); modal.onOpen();
    expect(h.collect).not.toHaveBeenCalled(); expect(text(modal)).toEqual([]);
    h.plugin.onunload(); staleMenu.items[0].click(); expect(h.opened).toHaveLength(1);
    expect(h.forbidden).not.toHaveBeenCalled(); expect(h.getSecret).not.toHaveBeenCalled();
  });

  it.each(["close", "unload"])("suppresses result and repeated callback at re-entrant collection %s boundary", async action => {
    const h = harness(); await h.plugin.onload(); const modal = h.open(); const preview = button(modal, "Preview notes");
    const collect = h.collect.getMockImplementation()!;
    h.collect.mockImplementation(function (this: TargetFileCollector, ...args) {
      preview.click();
      if (action === "close") modal.close(); else h.plugin.onunload();
      return collect.apply(this, args);
    });
    preview.click(); expect(h.collect).toHaveBeenCalledOnce();
    expect(h.collect.mock.calls[0][2]?.aborted).toBe(true); expect(text(modal)).toEqual([]);
    preview.click(); modal.onOpen(); expect(text(modal)).toEqual([]); expect(h.collect).toHaveBeenCalledOnce();
    h.plugin.onunload();
  });

  it("double clicks, Enter repeats, stale handlers consume at most once; separate operations remain independent", async () => {
    const h = harness(); await h.plugin.onload(); const first = h.open(); const second = h.open();
    const preview = button(first, "Preview notes"); preview.focus();
    press(first, "Enter", { repeat: true }); press(first, "Enter", { isComposing: true });
    expect(h.collect).not.toHaveBeenCalled(); press(first, "Enter"); press(first, "Enter");
    preview.click(2); preview.click(); radio(first, 1)?.change();
    expect(h.collect).toHaveBeenCalledOnce(); button(second, "Preview notes").click();
    expect(h.collect).toHaveBeenCalledTimes(2); h.plugin.onunload();
  });

  it("closing invalidates immediately even when Obsidian delays onClose", async () => {
    const h = harness(); await h.plugin.onload(); const modal = h.open(); const preview = button(modal, "Preview notes");
    const base = await import("./helpers/obsidian-move");
    vi.spyOn(base.Modal.prototype, "close").mockImplementation(() => {});
    modal.close(); preview.click(); expect(h.collect).not.toHaveBeenCalled(); modal.onClose(); h.plugin.onunload();
  });

  it("performs zero body reads, mutations, Secret/provider requests, network, telemetry or logs", async () => {
    const h = harness(); const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const fetch = vi.spyOn(globalThis, "fetch");
    await h.plugin.onload(); const modal = h.open(); radio(modal, 1).change(); button(modal, "Preview notes").click();
    button(modal, "Cancel").click(); h.plugin.onunload();
    expect(h.forbidden).not.toHaveBeenCalled(); expect(h.getSecret).not.toHaveBeenCalled();
    expect(provider.classify).not.toHaveBeenCalled(); expect(provider.evaluate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled(); for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function analysisHarness() {
  const h = harness();
  const pending = deferred<FolderOrganizerAnalysisResult>();
  let publish!: (progress: FolderOrganizerProgress) => void;
  const analyze = vi.spyOn(FolderOrganizerService.prototype, "analyze").mockImplementation((_targets, _signal, onProgress) => {
    publish = onProgress!;
    return pending.promise;
  });
  return { ...h, analyze, pending, publish: (progress: FolderOrganizerProgress) => publish(progress) };
}
const finalProgress = Object.freeze({ total: 2, processed: 2, failed: 1 });
const completed: FolderOrganizerAnalysisResult = Object.freeze({ status: "completed", results: Object.freeze([]), progress: finalProgress });

describe("Folder Organizer explicit analysis UI (#97)", () => {
  it.each([false, true])("discloses exact scope/data/credits only after local Preview, recursive=%s", async recursive => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open();
    expect(h.analyze).not.toHaveBeenCalled(); expect(button(modal, "Analyze notes")).toBeUndefined();
    radio(modal, recursive ? 1 : 0).change(); expect(h.analyze).not.toHaveBeenCalled();
    button(modal, "Preview notes").click();
    expect(text(modal)).toEqual([
      recursive ? "2 Markdown notes found." : "1 Markdown note found.",
      "Selected folder: Inbox", `Scope: ${recursive ? "Include subfolders" : "This folder only"}`,
      "Analysis: Folder suggestions + Tag suggestions",
      "Analyzing these notes sends note titles, Vault-relative note paths, Markdown bodies, candidate folder paths, and existing Vault Tag candidates to TypeSafe and may use TypeSafe-managed credits.",
      "Folder then Tag analysis can make up to 2 TypeSafe requests per fully analyzed note. Failures or cancellation may produce fewer requests.",
      "No changes will be made to your Vault.", "Analyze notes", "Cancel",
    ]);
    expect(h.analyze).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
    expect(h.getSecret).not.toHaveBeenCalled(); expect(provider.classify).not.toHaveBeenCalled(); expect(provider.evaluate).not.toHaveBeenCalled();
    h.plugin.onunload();
  });

  it.each(["empty", "failure", "exception"])("%s Preview cannot expose Analyze", async outcome => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open();
    if (outcome === "empty") h.root.children = [];
    if (outcome === "failure") h.collect.mockReturnValue({ status: "failure", reason: "invalid-target" });
    if (outcome === "exception") h.collect.mockImplementation(() => { throw new Error("synthetic-private-body"); });
    button(modal, "Preview notes").click(); press(modal, "Enter");
    expect(button(modal, "Analyze notes")).toBeUndefined(); expect(h.analyze).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled(); h.plugin.onunload();
  });

  it.each(["click", "Enter"])("%s consumes Analyze once with the exact retained array, no recollection or active fallback", async activation => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open(); radio(modal, 1).change();
    const preview = button(modal, "Preview notes"); preview.click();
    const targets = (h.collect.mock.results[0].value as { targets: readonly OrganizationTarget[] }).targets;
    const later = note("Inbox/Later.md"); h.root.children.push(later); h.entries.set(later.path, later);
    h.switchActive(note("Elsewhere.md")); h.switchActive(folder("Elsewhere"));
    const analyze = button(modal, "Analyze notes"); analyze.focus();
    if (activation === "Enter") {
      press(modal, "Enter", { repeat: true }); press(modal, "Enter", { isComposing: true }); press(modal, "Enter", { ctrlKey: true });
      expect(h.analyze).not.toHaveBeenCalled(); press(modal, "Enter");
    } else analyze.click();
    analyze.click(2); analyze.click(); press(modal, "Enter"); preview.click();
    expect(analyze.disabled).toBe(true); expect(h.analyze).toHaveBeenCalledOnce(); expect(h.collect).toHaveBeenCalledOnce();
    expect(h.analyze.mock.calls[0][0]).toBe(targets);
    expect(h.analyze.mock.calls[0][0].map(t => t.snapshot.path)).toEqual(["Inbox/A.md", "Inbox/Nested/B.md"]);
    h.pending.resolve(completed); await flush(); analyze.click(); press(modal, "Enter"); preview.click();
    expect(h.analyze).toHaveBeenCalledOnce(); expect(h.collect).toHaveBeenCalledOnce();
    h.plugin.onunload();
  });

  it("renders service snapshots, a stable progress indicator and safe current path", async () => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open();
    button(modal, "Preview notes").click(); button(modal, "Analyze notes").click();
    const indicator = elements(modal).find(e => e.tag === "progress") as unknown as HTMLProgressElement;
    const stop = button(modal, "Stop"); stop.focus();
    for (const progress of [
      { total: 12, processed: 0, failed: 0, currentPath: "Inbox/A.md" },
      { total: 12, processed: 3, failed: 1, currentPath: "Inbox/Nested/B.md" },
      { total: 12, processed: 4, failed: 1 },
    ]) {
      expect(() => h.publish(progress)).not.toThrow();
      expect(text(modal)).toContain(`${progress.processed} / ${progress.total} processed`);
      expect(text(modal)).toContain(`Failed: ${progress.failed}`);
      expect(text(modal)).toContain(`Current: ${progress.currentPath ?? "—"}`);
      expect(indicator.max).toBe(progress.total); expect(indicator.value).toBe(progress.processed);
      expect(button(modal, "Stop")).toBe(stop); expect(stop.ownerDocument.activeElement).toBe(stop);
    }
    h.plugin.onunload(); h.pending.resolve(completed); await flush();
    expect(text(modal)).toEqual([]);
  });

  it.each(["click", "Enter"])("Stop via %s aborts analysis only, remains stopping until settled, idempotent", async activation => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open();
    button(modal, "Preview notes").click(); const analyze = button(modal, "Analyze notes"); analyze.click();
    const signal = h.analyze.mock.calls[0][1]!;
    const lifetime = h.collect.mock.calls[0][2]!;
    const abort = vi.fn(); signal.addEventListener("abort", abort);
    h.publish({ total: 12, processed: 4, failed: 1 });
    const stop = button(modal, "Stop"); stop.focus();
    if (activation === "Enter") press(modal, "Enter"); else stop.click();
    stop.click(); press(modal, "Enter"); analyze.click();
    expect(signal.aborted).toBe(true); expect(lifetime.aborted).toBe(false); expect(abort).toHaveBeenCalledOnce();
    expect(stop.disabled).toBe(true); expect(h.analyze).toHaveBeenCalledOnce();
    expect(text(modal)).toContain("Stopping... No new note analysis will start.");
    expect(text(modal)).not.toContain("Analysis complete."); expect(modal.getAnalysisResult()).toBeUndefined();
    const cancelled: FolderOrganizerAnalysisResult = { status: "cancelled", results: [], progress: { total: 12, processed: 4, failed: 1 } };
    h.pending.resolve(cancelled); await flush();
    expect(text(modal)).toEqual(["Analysis stopped.", "4 / 12 notes processed.", "1 failed.", "No further notes were analyzed.", "No changes were made to your Vault.", "Close"]);
    expect(modal.getAnalysisResult()).toBe(cancelled); stop.click(); analyze.click(); expect(h.analyze).toHaveBeenCalledOnce();
    button(modal, "Close").click(); expect(modal.getAnalysisResult()).toBeUndefined(); h.plugin.onunload();
  });

  it("completed with failures reports counts without promising all-success, retry, review or Apply", async () => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open();
    button(modal, "Preview notes").click(); const analyze = button(modal, "Analyze notes"); analyze.click();
    h.pending.resolve(completed); await flush();
    expect(text(modal)).toEqual(["Analysis complete.", "2 / 2 notes processed.", "1 failed.", "No changes were made to your Vault.", "Close"]);
    expect(modal.getAnalysisResult()).toBe(completed); analyze.click(); expect(h.analyze).toHaveBeenCalledOnce();
    h.plugin.onunload();
  });

  const reasons: Array<[OrganizationAnalysisStopReason, string]> = [
    ["missing-api-key", "A TypeSafe API key is required to analyze these notes."],
    ["no-candidates", "Jevault couldn't continue because no eligible analysis candidates were available."],
    ["network", "A network error stopped the analysis."],
    ["typesafe-api", "TypeSafe couldn't complete an analysis request."],
    ["invalid-response", "TypeSafe returned an invalid response, so the analysis stopped."],
    ["unexpected-error", "Jevault couldn't continue the analysis safely."],
  ];
  it.each(reasons)("stopped %s uses sanitized feedback, preserves partial results and counts in memory", async (reason, message) => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open();
    radio(modal, 1).change(); button(modal, "Preview notes").click(); button(modal, "Analyze notes").click();
    const target = h.analyze.mock.calls[0][0][0];
    const partial = Object.freeze({ source: target.source, snapshot: target.snapshot, status: "partial" as const,
      folder: Object.freeze({ status: "success" as const, value: { status: "success" as const, noteTitle: "Synthetic title", source: target.source, result: { candidates: [{ path: "Synthetic", probability: 0.9 }] } } }),
      tags: Object.freeze({ status: "failure" as const, reason }) });
    const result = Object.freeze({ status: "stopped" as const, reason, results: Object.freeze([partial]), progress: Object.freeze({ total: 2, processed: 1, failed: 1 }),
      rawResponse: "synthetic-provider-body", body: "synthetic-note-body", secret: "synthetic-secret-marker", error: new Error("synthetic-error-marker") });
    h.pending.resolve(result); await flush();
    expect(text(modal)).toEqual(["Analysis stopped.", "1 / 2 notes processed.", "1 failed.", message, "No changes were made to your Vault.", "Close"]);
    const stored = modal.getAnalysisResult()!;
    expect(stored).toBe(result); expect(stored.results[0]).toBe(partial); expect(stored.results[0].source).toBe(target.source);
    for (const forbidden of ["selectedFolderPath", "selectedTags", "reviewStatus", "confirmation", "applyToken"]) {
      expect(stored).not.toHaveProperty(forbidden); expect(stored.results[0]).not.toHaveProperty(forbidden);
    }
    expect((h.plugin as unknown as { saveData: ReturnType<typeof vi.fn> }).saveData).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled(); h.plugin.onunload(); expect(modal.getAnalysisResult()).toBeUndefined();
  });

  it("an unexpected rejected service promise shows no raw exception and permits no retry", async () => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open();
    button(modal, "Preview notes").click(); const analyze = button(modal, "Analyze notes"); analyze.click();
    h.publish(finalProgress); h.pending.reject(new Error("synthetic-secret-body-response")); await flush();
    expect(text(modal)).toEqual(["Analysis stopped.", "2 / 2 notes processed.", "1 failed.", reasons[5][1], "No changes were made to your Vault.", "Close"]);
    expect(modal.getAnalysisResult()).toBeUndefined(); analyze.click(); expect(h.analyze).toHaveBeenCalledOnce(); h.plugin.onunload();
  });

  it.each(["Cancel", "Escape", "X", "unload"])("%s after Preview consumes stale Analyze without starting analysis", async action => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open(); button(modal, "Preview notes").click();
    const analyze = button(modal, "Analyze notes");
    if (action === "Cancel") button(modal, "Cancel").click();
    else if (action === "Escape") press(modal, "Escape");
    else if (action === "X") modal.close(); else h.plugin.onunload();
    analyze.click(); analyze.focus(); press(modal, "Enter"); modal.onOpen();
    expect(h.analyze).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
    expect(text(modal)).toEqual([]); h.plugin.onunload();
  });

  it.each(["Close", "Escape", "X", "unload", "onClose"])("%s aborts and disposes active analysis, no late progress/result or new-operation contamination", async action => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open();
    button(modal, "Preview notes").click(); const analyze = button(modal, "Analyze notes"); analyze.click(); const stop = button(modal, "Stop");
    const signal = h.analyze.mock.calls[0][1]!;
    if (action === "Close") button(modal, "Close").click(); else if (action === "Escape") press(modal, "Escape");
    else if (action === "X") modal.close(); else if (action === "onClose") modal.onClose(); else h.plugin.onunload();
    expect(signal.aborted).toBe(true); expect(text(modal)).toEqual([]);
    const fresh = action === "unload" ? undefined : h.open();
    expect(() => h.publish({ total: 99, processed: 88, failed: 7, currentPath: "Synthetic-late.md" })).not.toThrow();
    h.pending.resolve(completed); await flush();
    analyze.click(); stop.click(); modal.onOpen(); expect(text(modal)).toEqual([]); expect(modal.getAnalysisResult()).toBeUndefined();
    expect(h.analyze).toHaveBeenCalledOnce(); if (fresh) expect(text(fresh)).not.toContain("Analysis complete.");
    expect(h.forbidden).not.toHaveBeenCalled(); h.plugin.onunload();
  });

  it("close invalidates analysis immediately even with delayed Obsidian onClose", async () => {
    const h = analysisHarness(); await h.plugin.onload(); const modal = h.open();
    button(modal, "Preview notes").click(); button(modal, "Analyze notes").click();
    const base = await import("./helpers/obsidian-move"); vi.spyOn(base.Modal.prototype, "close").mockImplementation(() => {});
    const prior = text(modal); modal.close();
    expect(h.analyze.mock.calls[0][1]!.aborted).toBe(true);
    h.publish(finalProgress); h.pending.resolve(completed); await flush(); expect(text(modal)).toEqual(prior);
    expect(modal.getAnalysisResult()).toBeUndefined(); modal.onClose(); h.plugin.onunload();
  });
});

describe("Folder Organizer production service composition", () => {
  it.each(["unchanged", "renamed", "moved", "deleted", "replaced", "edited"])("exact %s target uses #92/#95 semantics and never retargets", async change => {
    const h = harness(); const analyze = vi.spyOn(FolderOrganizerService.prototype, "analyze");
    const folderAnalysis = vi.spyOn(ClassificationService.prototype, "classifyNote").mockImplementation(async (note, source) => ({ status: "success", noteTitle: note.title, source, result: { candidates: [] } }));
    const tagAnalysis = vi.spyOn(TagSuggestionService.prototype, "suggestForNote").mockImplementation(async (note, source) => ({ status: "success", noteTitle: note.title, source, suggestions: [] }));
    h.vault.read.mockImplementation(async () => "synthetic read-only body" as never);
    await h.plugin.onload(); const modal = h.open(); radio(modal, 1).change(); button(modal, "Preview notes").click();
    const targets = (h.collect.mock.results[0].value as { targets: readonly OrganizationTarget[] }).targets;
    const first = h.entries.get("Inbox/A.md") as TFile & { stat: { mtime: number; size: number } };
    if (change === "renamed") first.path = "Inbox/Renamed.md";
    if (change === "moved") first.path = "Elsewhere/A.md";
    if (change === "deleted") h.entries.delete("Inbox/A.md");
    if (change === "replaced") h.entries.set("Inbox/A.md", note("Inbox/A.md"));
    if (change === "edited") first.stat.mtime++;
    const added = note("Inbox/New.md"); h.entries.set(added.path, added); h.root.children.push(added);
    h.switchActive(note("Elsewhere.md")); h.switchActive(folder("Elsewhere"));
    button(modal, "Analyze notes").click(); await analyze.mock.results[0].value; await flush();
    expect(analyze).toHaveBeenCalledOnce(); expect(analyze.mock.calls[0][0]).toBe(targets); expect(h.collect).toHaveBeenCalledOnce();
    const result = modal.getAnalysisResult()!;
    expect(result.status).toBe("completed"); expect(result.progress).toEqual({ total: 2, processed: 2, failed: change === "unchanged" ? 0 : 1 });
    expect(result.results.map(r => r.snapshot.path)).toEqual(["Inbox/A.md", "Inbox/Nested/B.md"]);
    if (change !== "unchanged") expect(result.results[0].readFailure).toBe("source-changed");
    expect(folderAnalysis).toHaveBeenCalledTimes(change === "unchanged" ? 2 : 1);
    expect(tagAnalysis).toHaveBeenCalledTimes(change === "unchanged" ? 2 : 1);
    expect(folderAnalysis.mock.calls.at(-1)![1]).toBe(targets[1].source);
    expect(tagAnalysis.mock.calls.at(-1)![1]).toBe(targets[1].source);
    expect(h.getSecret).not.toHaveBeenCalled(); h.plugin.onunload();
  });

  it("Stop during exact read lets in-flight read settle but starts no provider or later target", async () => {
    const h = harness(); const pending = deferred<never>();
    h.vault.read.mockImplementation(() => pending.promise);
    const analyze = vi.spyOn(FolderOrganizerService.prototype, "analyze");
    const folders = vi.spyOn(ClassificationService.prototype, "classifyNote");
    const tags = vi.spyOn(TagSuggestionService.prototype, "suggestForNote");
    await h.plugin.onload(); const modal = h.open(); radio(modal, 1).change(); button(modal, "Preview notes").click();
    expect(h.vault.read).not.toHaveBeenCalled(); button(modal, "Analyze notes").click(); expect(h.vault.read).toHaveBeenCalledOnce();
    button(modal, "Stop").click(); expect(text(modal)).not.toContain("Analysis stopped.");
    pending.resolve("synthetic body" as never); await analyze.mock.results[0].value; await flush();
    expect(modal.getAnalysisResult()!.status).toBe("cancelled"); expect(h.vault.read).toHaveBeenCalledOnce();
    expect(folders).not.toHaveBeenCalled(); expect(tags).not.toHaveBeenCalled(); expect(h.getSecret).not.toHaveBeenCalled();
    expect(provider.classify).not.toHaveBeenCalled(); expect(provider.evaluate).not.toHaveBeenCalled(); h.plugin.onunload();
  });

  it("production provider/Secret path is first reachable at explicit Analyze, sharing existing Folder/Tag services", async () => {
    const h = harness(); h.vault.read.mockImplementation(async () => "synthetic body" as never);
    h.vault.getAllFolders.mockImplementation(() => [folder("Dest")] as never);
    h.vault.getMarkdownFiles.mockImplementation(() => [] as never);
    const { TagDiscoveryService } = await import("../src/tags/tag-discovery-service");
    vi.spyOn(TagDiscoveryService.prototype, "discover").mockReturnValue([{ id: "synthetic", name: "#synthetic" }]);
    h.getSecret.mockReturnValue("unit-test-only");
    provider.classify.mockResolvedValue({ candidates: [{ path: "Dest", probability: 1 }] });
    provider.evaluate.mockResolvedValue({ evaluations: [] });
    const analyze = vi.spyOn(FolderOrganizerService.prototype, "analyze");
    await h.plugin.onload(); h.plugin.settings.apiKeySecretName = "synthetic-reference";
    const modal = h.open(); radio(modal, 0).change(); button(modal, "Preview notes").click();
    expect(h.vault.read).not.toHaveBeenCalled(); expect(h.getSecret).not.toHaveBeenCalled(); expect(provider.classify).not.toHaveBeenCalled(); expect(provider.evaluate).not.toHaveBeenCalled();
    button(modal, "Analyze notes").click(); await analyze.mock.results[0].value; await flush();
    expect(provider.classify).toHaveBeenCalledOnce(); expect(provider.evaluate).toHaveBeenCalledOnce(); expect(h.getSecret).toHaveBeenCalledTimes(2);
    expect(provider.classify.mock.calls[0][0]).toEqual({ title: "A", path: "Inbox/A.md", body: "synthetic body" });
    expect(provider.evaluate.mock.calls[0][0]).toEqual(provider.classify.mock.calls[0][0]);
    expect(modal.getAnalysisResult()!.status).toBe("completed");
    expect(h.vault.modify).not.toHaveBeenCalled(); expect(h.vault.create).not.toHaveBeenCalled(); expect(h.vault.createFolder).not.toHaveBeenCalled(); expect(h.vault.delete).not.toHaveBeenCalled();
    expect(h.plugin.app.fileManager.renameFile).not.toHaveBeenCalled(); expect(h.plugin.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(text(modal).join(" ")).not.toContain("synthetic body"); expect(text(modal).join(" ")).not.toContain("unit-test-only"); h.plugin.onunload();
  });

  it("documentation matches explicit trigger, exact targets, privacy, credits and deferred capabilities", () => {
    const docs = Object.fromEntries(["README.md", "PRIVACY.md", "SECURITY.md"].map(name => [name, readFileSync(new URL(`../${name}`, import.meta.url), "utf8")]));
    for (const doc of Object.values(docs)) {
      expect(doc).toContain("**Analyze notes**"); expect(doc).toContain("Preview"); expect(doc).toContain("exact");
      expect(doc).toContain("TypeSafe"); expect(doc).toContain("Vault");
    }
    for (const name of ["README.md", "PRIVACY.md"]) {
      expect(docs[name]).toContain("up to 2"); expect(docs[name]).toContain("TypeSafe-managed credits may be used");
      expect(docs[name]).toContain("operation memory");
    }
    expect(docs["README.md"]).toContain("Analysis Options remain deferred");
    expect(docs["README.md"]).toContain("Review and Apply are not available");
    expect(docs["PRIVACY.md"]).toContain("does not persist results or bodies");
  });
});
