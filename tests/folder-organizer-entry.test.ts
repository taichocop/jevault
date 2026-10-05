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
    addCommand() {}
    addSettingTab() {}
    registerEvent(ref: unknown) { this.registered.push(ref); }
  }
  return { ...base, Plugin, Notice: class {} };
});

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
  const getSecret = vi.fn();
  let active: TFolder | TFile = note("Other.md");
  const listeners = new Map<EventRef, (menu: Menu, file: TAbstractFile) => void>();
  const on = vi.fn((_name: string, callback: (menu: Menu, file: TAbstractFile) => void) => {
    const ref = {} as EventRef; listeners.set(ref, callback); return ref;
  });
  const plugin = new JevaultPlugin({} as App, {} as never);
  const vault = { configDir: ".obsidian", getAbstractFileByPath: vi.fn((path: string) => entries.get(path) ?? null),
    read: forbidden, cachedRead: forbidden, modify: forbidden, create: forbidden, createFolder: forbidden,
    delete: forbidden, rename: forbidden, process: forbidden, getMarkdownFiles: forbidden, getAllFolders: forbidden };
  plugin.app = { workspace: { on, getActiveFile: () => active }, vault,
    secretStorage: { getSecret }, fileManager: { renameFile: forbidden, processFrontMatter: forbidden }, metadataCache: {},
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
    expect(text(modal)).toEqual([recursive ? "2 Markdown notes found." : "1 Markdown note found.", "Close"]);
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
    button(modal, "Close").click(); h.plugin.onunload();
    expect(h.forbidden).not.toHaveBeenCalled(); expect(h.getSecret).not.toHaveBeenCalled();
    expect(provider.classify).not.toHaveBeenCalled(); expect(provider.evaluate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled(); for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
