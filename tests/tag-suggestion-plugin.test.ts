import type { App, TFile, CachedMetadata, EventRef } from "obsidian";
import { Notice } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "../src/classification/classification-errors";
import type { TagEvaluator } from "../src/tags/tag-evaluator";
const provider = vi.hoisted(() => ({ evaluate: vi.fn<TagEvaluator["evaluate"]>(), classify: vi.fn() }));
vi.mock("../src/classification/typesafe-adapter", () => ({ TypeSafeAdapter: class {
  evaluate = provider.evaluate;
  classify = provider.classify;
} }));
vi.mock("../src/settings-tab", () => ({ JevaultSettingTab: class {} }));
vi.mock("obsidian", async () => {
  class Element {
    children: Element[] = [];
    disabled = false;
    checked = false;
    type = "";
    tag = "div";
    text = "";
    ownerDocument = { activeElement: null as Element | null };
    private handlers = new Map<string, (event: { detail: number }) => void>();

    empty(): void {
      this.children = [];
      this.ownerDocument.activeElement = null;
    }

    createEl(tag: string, options?: { text?: string; type?: string }): Element {
      const child = new Element();
      child.tag = tag;
      child.type = options?.type ?? "";
      child.text = options?.text ?? "";
      child.ownerDocument = this.ownerDocument;
      this.children.push(child);
      return child;
    }

    addEventListener(event: string, handler: (event: { detail: number }) => void): void {
      this.handlers.set(event, handler);
    }

    setText(text: string): void { this.text = text; }
    click(): void { this.handlers.get("click")?.({ detail: 1 }); }
    change(checked: boolean): void { this.checked = checked; this.handlers.get("change")?.({ detail: 0 }); }
    focus(): void { this.ownerDocument.activeElement = this; }
    closest(): Element | null { return null; }
  }

  class Modal {
    static instances: Modal[] = [];
    constructor() { Modal.instances.push(this); }
    contentEl = new Element();
    scope = {
      handlers: new Map<string, (event: KeyboardEvent) => unknown>(),
      register(_modifiers: string[], key: string, handler: (event: KeyboardEvent) => unknown): void { this.handlers.set(key, handler); },
      press: (key: string, options: Partial<KeyboardEvent> = {}): void => {
        if (key === "Escape") this.close();
        else this.scope.handlers.get(key)?.({ key, ...options } as KeyboardEvent);
      },
    };

    open(): void {
      (this as unknown as { onOpen(): void }).onOpen();
    }

    close(): void {
      (this as unknown as { onClose(): void }).onClose();
    }
  }

  class Notice {
    static instances: Notice[] = [];
    hidden = false;
    constructor(readonly message: string) { Notice.instances.push(this); }
    hide(): void { this.hidden = true; }
  }
  class Plugin {
    app: unknown;
    commands: Array<{ id: string; name: string; callback: () => void }> = [];
    async loadData() { return { apiKeySecretName: "synthetic-reference" }; }
    addCommand(command: { id: string; name: string; callback: () => void }) { this.commands.push(command); }
    addSettingTab() {}
  }
  return { TFile: (await import("./helpers/obsidian-move")).TFile, parseFrontMatterTags: () => [], App: class {}, Modal, Notice, Plugin, getAllTags: (cache: { canonical: string[] }) => cache.canonical };
});


import JevaultPlugin from "../src/main";
import { Modal } from "obsidian";
import { TFile as FakeFile } from "./helpers/obsidian-move";
import type { TagApplyPreparedPresentation } from "../src/tags/tag-apply-preparation";
import { TagSuggestionGrantIssuer, isIssuedSuggestionGrant } from "../src/tags/tag-suggestion-grant";
import type { TagSuggestionServiceResult } from "../src/tags/tag-suggestion-service";
import { TagApplyService } from "../src/tags/tag-apply-service";
interface TestElement {
  children: TestElement[];
  disabled: boolean;
  checked: boolean;
  tag: string;
  text: string;
  click(): void;
  change(checked: boolean): void;
  focus(): void;
}
interface TestModal {
  preparation: TagApplyPreparedPresentation;
  contentEl: TestElement;
  close(): void;
  scope: { press(key: string, options?: Partial<KeyboardEvent>): void };
}
function currentModal(): TestModal {
  return (Modal as unknown as { instances: TestModal[] }).instances.at(-1)!;
}
function descendants(element: TestElement): TestElement[] {
  return [element, ...element.children.flatMap(descendants)];
}
function button(modal: TestModal, text: string): TestElement {
  return descendants(modal.contentEl).find(element => element.tag === "button" && element.text === text)!;
}
function checkboxes(modal: TestModal): TestElement[] {
  return descendants(modal.contentEl).filter(element => element.tag === "input");
}
function rendered(modal: TestModal): string[] {
  return descendants(modal.contentEl).map(element => element.text).filter(Boolean);
}
function harness() {
  const issue = vi.spyOn(TagSuggestionGrantIssuer.prototype, "issue");
  const original = new FakeFile("A.md") as TFile;
  const other = new FakeFile("B.md") as TFile;
  let active = original;
  const forbidden = vi.fn(() => { throw new Error("Forbidden mutation"); });
  const processFrontMatter = vi.fn<(file: TFile, callback: (frontmatter: Record<string, unknown>) => void) => Promise<void>>(async () => { forbidden(); });
  const getFileByPath = vi.fn((path: string) => path === original.path ? original : path === other.path ? other : null);
  const read = vi.fn(async () => "Synthetic Markdown body");
  const getFileCache = vi.fn((file: TFile) => ({ canonical: file === original ? ["#aws"] : ["#cloud", "#rails"] }));
  const listeners = new Map<EventRef, (file: TFile, data: string, cache: CachedMetadata) => void>();
  const on = vi.fn((_name: string, callback: (file: TFile, data: string, cache: CachedMetadata) => void) => {
    const ref = {} as EventRef; listeners.set(ref, callback); return ref;
  });
  const offref = vi.fn((ref: EventRef) => { listeners.delete(ref); });
  const emit = (file: TFile) => { for (const callback of listeners.values()) callback(file, "Synthetic Markdown body", getFileCache(file) as CachedMetadata); };
  const getSecret = vi.fn(() => "unit-test-only");
  const plugin = new JevaultPlugin({} as App, {} as never);
  plugin.app = {
    workspace: { getActiveFile: () => active },
    vault: { read, getMarkdownFiles: () => [original, other],
      getFileByPath,
      modify: forbidden, rename: forbidden, delete: forbidden, create: forbidden, createFolder: forbidden, cachedRead: forbidden },
    metadataCache: { getFileCache, on, offref },
    secretStorage: { getSecret },
    fileManager: { processFrontMatter, renameFile: forbidden },
  } as unknown as App;
  const runtime = plugin as unknown as { commands: Array<{ id: string; name: string; callback: () => void }> };
  return { plugin, runtime, issue, getSecret, on, offref, emit, listeners, original, other, read, getFileCache, forbidden, processFrontMatter, getFileByPath, switchNote: () => { active = other; } };
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

afterEach(() => { vi.restoreAllMocks(); });

beforeEach(() => {
    vi.clearAllMocks();
    (Modal as unknown as { instances: unknown[] }).instances = [];
    provider.evaluate.mockResolvedValue({ evaluations: [{ tagId: "tag_001", tagName: "#aws", choice: "match", matchProbability: 0.96 }] });
    (Notice as unknown as { instances: unknown[] }).instances = [];
});

describe("Tag Suggest plugin wiring and read-only safety", () => {
  it("plugin load and Settings registration start no tracker or event body fingerprints", async () => {
    const h = harness();
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    try {
      await h.plugin.onload();
      h.emit(h.original); h.emit(h.other);
      expect(h.on).not.toHaveBeenCalled(); expect(h.listeners.size).toBe(0);
      expect(h.issue).not.toHaveBeenCalled(); expect(h.getSecret).not.toHaveBeenCalled();
      expect(digest).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled();
      expect(provider.evaluate).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
      h.plugin.onunload(); expect(h.offref).not.toHaveBeenCalled();
    } finally { digest.mockRestore(); }
  });
  it("registers the command without evaluation and runs only after explicit execution", async () => {
    const h = harness();
    await h.plugin.onload();
    expect(provider.evaluate).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
    const command = h.runtime.commands.find(command => command.id === "suggest-tags-for-current-note")!;
    expect(command.name).toBe("Suggest tags for current note");
    command.callback();
    command.callback();
    h.switchNote();
    await flush();
    expect(provider.evaluate).toHaveBeenCalledOnce();
    expect(provider.classify).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledExactlyOnceWith(h.original);
    expect(h.getFileCache).toHaveBeenLastCalledWith(h.original);
    const notices = (Notice as unknown as { instances: Array<{ message: string; hidden: boolean }> }).instances;
    expect(notices).toEqual([expect.objectContaining({ message: "Jevault is suggesting tags for this note...", hidden: true })]);
    const folderDispose = vi.spyOn(h.plugin.classificationCommand!, "dispose");
    const tagDispose = vi.spyOn(h.plugin.tagSuggestionCommand!, "dispose");
    h.plugin.onunload();
    expect(folderDispose).toHaveBeenCalledOnce();
    expect(tagDispose).toHaveBeenCalledOnce();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("actual plugin wiring keeps advisory freshness and an empty Grant until read-only Modal Close", async () => {
    const h = harness();
    Object.assign(h.original, { stat: { ctime: 1, mtime: 2, size: 10 } });
    let resolve!: (value: { evaluations: [] }) => void;
    provider.evaluate.mockImplementation(() => new Promise(r => { resolve = r; }));
    const apply = vi.spyOn(TagApplyService.prototype, "apply");
    try {
      await h.plugin.onload(); const run = h.plugin.tagSuggestionCommand!.execute();
      expect(h.on).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(provider.evaluate).toHaveBeenCalledOnce());
      const realDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
      let pending!: Promise<ArrayBuffer>;
      const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, bytes) => {
        pending = realDigest(algorithm, bytes); return pending;
      });
      try {
        h.emit(h.other); expect(digest).not.toHaveBeenCalled();
        h.emit(h.original); await pending; await flush();
      } finally { digest.mockRestore(); }
      resolve({ evaluations: [] }); await run;
      const modals = (Modal as unknown as { instances: Array<{ preparation: TagApplyPreparedPresentation; close(): void }> }).instances;
      expect(modals).toHaveLength(1);
      expect(modals[0].preparation.getReadiness([])).toEqual({ status: "blocked", reason: "empty-selection", freshness: "matching" });
      const grant = modals[0].preparation.suggestionGrant!;
      expect(grant.allowedTags).toEqual([]);
      expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(true);
      expect(h.listeners.size).toBe(1); modals[0].close();
      expect(h.listeners.size).toBe(0); expect(h.offref).toHaveBeenCalledOnce();
      expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(false);
      h.plugin.onunload(); expect(apply).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
      expect(provider.evaluate).toHaveBeenCalledOnce();
    } finally { apply.mockRestore(); }
  });
  it("unload while evaluation provenance digest is pending removes tracking and suppresses UI", async () => {
    const h = harness(); Object.assign(h.original, { stat: { ctime: 1, mtime: 2, size: 10 } });
    let resolve!: (value: ArrayBuffer) => void;
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockReturnValue(new Promise(r => { resolve = r; }));
    try {
      await h.plugin.onload(); const run = h.plugin.tagSuggestionCommand!.execute();
      await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
      h.plugin.onunload(); expect(h.listeners.size).toBe(0); expect(h.offref).toHaveBeenCalledOnce();
      resolve(new ArrayBuffer(32)); await run;
      expect(provider.evaluate).not.toHaveBeenCalled();
      expect((Modal as unknown as { instances: unknown[] }).instances).toEqual([]);
      expect(h.forbidden).not.toHaveBeenCalled();
    } finally { digest.mockRestore(); }
  });
  it("aborts the actual application operation on unload and cleans loading before completion", async () => {
    const h = harness();
    let resolve!: (value: { evaluations: [] }) => void;
    provider.evaluate.mockImplementation(() => new Promise(r => { resolve = r; }));
    await h.plugin.onload();
    const execution = h.plugin.tagSuggestionCommand!.execute();
    await flush();
    const signal = provider.evaluate.mock.calls[0][2]!;
    h.plugin.onunload();
    expect(signal.aborted).toBe(true);
    expect((Notice as unknown as { instances: Array<{ hidden: boolean }> }).instances.every(notice => notice.hidden)).toBe(true);
    resolve({ evaluations: [] });
    await execution;
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("handles an explicit failure without automatic retry or mutation", async () => {
    const h = harness();
    provider.evaluate.mockRejectedValue(new NetworkError());
    await h.plugin.onload();
    await h.plugin.tagSuggestionCommand!.execute();
    await flush();
    expect(provider.evaluate).toHaveBeenCalledOnce();
    h.plugin.onunload();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
});

describe("Suggestion Grant production migration safety", () => {
  it("issues only final displayed matches without metadata proof; read-only Modal Close revokes it", async () => {
    const h = harness(); Object.assign(h.original, { stat: { ctime: 1, mtime: 2, size: 10 } });
    const apply = vi.spyOn(TagApplyService.prototype, "apply");
    provider.evaluate.mockResolvedValue({ evaluations: [
      { tagId: "tag_003", tagName: "#rails", choice: "other", matchProbability: 1 },
      { tagId: "tag_001", tagName: "#aws", choice: "match", matchProbability: 0.96 },
      { tagId: "tag_002", tagName: "#cloud", choice: "match", matchProbability: 0.98 },
    ] });
    await h.plugin.onload(); await h.plugin.tagSuggestionCommand!.execute();
    const modal = (Modal as unknown as { instances: Array<{
      preparation: TagApplyPreparedPresentation; outcome: TagSuggestionServiceResult;
      contentEl: { children: Array<{ text: string; click(): void }> }; close(): void;
    }> }).instances[0];
    const grant = modal.preparation.suggestionGrant!;
    expect(h.issue).toHaveBeenCalledOnce(); expect(grant.source).toBe(modal.outcome.source);
    expect(grant.source.matches(h.original)).toBe(true);
    expect(grant.allowedTags).toEqual(["#cloud", "#aws"]);
    expect(grant.allowedTags).not.toContain("#AWS"); expect(grant.allowedTags).not.toContain("#rails");
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(true);
    expect(modal.preparation.getReadiness(["#aws"])).toEqual({ status: "confirmable", freshness: "unknown" });
    h.switchNote(); expect(grant.source.matches(h.other)).toBe(false);
    const displayed = rendered(modal as unknown as TestModal);
    expect(displayed).toContain("Suggested tags for “A”");
    expect(displayed.filter(text => text.startsWith("#"))).toEqual(["#cloud — 98.0%", "#aws — 96.0% — Already on note"]);
    expect(checkboxes(modal as unknown as TestModal).map(input => input.checked)).toEqual([false, false]);
    expect(button(modal as unknown as TestModal, "Apply selected tags").disabled).toBe(true);
    expect(provider.evaluate).toHaveBeenCalledOnce(); expect(h.getSecret).toHaveBeenCalledOnce();
    modal.contentEl.children.at(-1)!.click(); modal.close();
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(false);
    expect(h.listeners.size).toBe(0); expect(h.offref).toHaveBeenCalledOnce();
    h.plugin.onunload(); expect(apply).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
    expect(h.issue).toHaveBeenCalledOnce(); expect(provider.evaluate).toHaveBeenCalledOnce(); expect(h.getSecret).toHaveBeenCalledOnce();
  });
  it("unload revokes an open grant even with unavailable evaluation provenance", async () => {
    const h = harness(); const apply = vi.spyOn(TagApplyService.prototype, "apply");
    await h.plugin.onload(); await h.plugin.tagSuggestionCommand!.execute();
    const modal = (Modal as unknown as { instances: Array<{ preparation: TagApplyPreparedPresentation }> }).instances[0];
    const grant = modal.preparation.suggestionGrant!;
    expect(grant.evaluationProvenance).toBeUndefined(); expect(grant.allowedTags).toEqual(["#aws"]);
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(true);
    h.plugin.onunload(); h.plugin.onunload();
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(false);
    expect(h.listeners.size).toBe(0); expect(apply).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
    expect(provider.evaluate).toHaveBeenCalledOnce(); expect(h.getSecret).toHaveBeenCalledOnce();
  });
  it("late provider completion after unload cannot issue or resurrect a Modal", async () => {
    const h = harness(); let resolve!: (value: { evaluations: [] }) => void;
    provider.evaluate.mockImplementation(() => new Promise(r => { resolve = r; }));
    await h.plugin.onload(); const run = h.plugin.tagSuggestionCommand!.execute(); await flush();
    expect(h.issue).not.toHaveBeenCalled(); h.plugin.onunload(); resolve({ evaluations: [] }); await run;
    expect(h.issue).not.toHaveBeenCalled(); expect((Modal as unknown as { instances: unknown[] }).instances).toEqual([]);
    expect(h.listeners.size).toBe(0); expect(h.forbidden).not.toHaveBeenCalled();
    expect(provider.evaluate).toHaveBeenCalledOnce(); expect(h.getSecret).toHaveBeenCalledOnce();
  });
});

describe("Manual Tag Apply plugin integration", () => {
  it("requires final confirmation, applies to the original note, and adds no provider or Secret access", async () => {
    const h = harness();
    const frontmatter: Record<string, unknown> = { tags: ["existing"], title: "Synthetic title" };
    h.processFrontMatter.mockImplementation(async (_file, callback) => { callback(frontmatter); });
    const apply = vi.spyOn(TagApplyService.prototype, "apply");
    await h.plugin.onload();
    h.runtime.commands.find(command => command.id === "suggest-tags-for-current-note")!.callback();
    await vi.waitFor(() => expect((Modal as unknown as { instances: unknown[] }).instances).toHaveLength(1));
    const modal = currentModal();
    const grant = modal.preparation.suggestionGrant!;
    const confirm = vi.spyOn(modal.preparation, "confirm");
    const dispose = vi.spyOn(modal.preparation, "dispose");
    const close = vi.spyOn(modal, "close");
    expect(rendered(modal)).toContain("#aws — 96.0% — Already on note");
    expect(checkboxes(modal).map(input => input.checked)).toEqual([false]);
    expect(button(modal, "Apply selected tags").disabled).toBe(true);
    expect(confirm).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
    expect(h.processFrontMatter).not.toHaveBeenCalled();

    checkboxes(modal)[0].change(true);
    expect(button(modal, "Apply selected tags").disabled).toBe(false);
    expect(confirm).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
    h.switchNote();
    button(modal, "Apply selected tags").click();
    expect(rendered(modal)).toContain("A.md");
    expect(rendered(modal)).toContain("#aws");
    expect(confirm).not.toHaveBeenCalled(); expect(h.processFrontMatter).not.toHaveBeenCalled();
    const add = button(modal, "Add tags");
    add.click(); add.click(); modal.scope.press("Enter", { repeat: true });
    await flush();
    expect(confirm).toHaveBeenCalledExactlyOnceWith(["#aws"]);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0].confirmation).toBe(confirm.mock.results[0].value);
    expect(apply.mock.calls[0][0].confirmation.grant).toBe(grant);
    expect(h.processFrontMatter).toHaveBeenCalledExactlyOnceWith(h.original, expect.any(Function));
    expect(frontmatter).toEqual({ tags: ["existing", "aws"], title: "Synthetic title" });
    const notices = (Notice as unknown as { instances: Array<{ message: string }> }).instances;
    expect(notices.filter(notice => notice.message === "Added 1 tag.")).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce(); expect(modal.contentEl.children).toEqual([]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(false);
    expect(h.listeners.size).toBe(0); expect(h.offref).toHaveBeenCalledOnce();
    add.click(); await flush();
    expect(confirm).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce();
    expect(provider.evaluate).toHaveBeenCalledOnce(); expect(h.getSecret).toHaveBeenCalledOnce();
    expect(provider.classify).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
    expect(notices.map(notice => notice.message).join(" ")).not.toContain("Synthetic Markdown body");
    expect(notices.map(notice => notice.message).join(" ")).not.toContain("unit-test-only");
    modal.close(); h.plugin.onunload();
    expect(dispose).toHaveBeenCalledOnce();
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(false);
    expect(h.listeners.size).toBe(0);
  });

  it("confirmation Cancel disposes the result and revokes the Grant without mutation", async () => {
    const h = harness(); const apply = vi.spyOn(TagApplyService.prototype, "apply");
    await h.plugin.onload(); await h.plugin.tagSuggestionCommand!.execute();
    const modal = currentModal(), grant = modal.preparation.suggestionGrant!;
    const confirm = vi.spyOn(modal.preparation, "confirm");
    checkboxes(modal)[0].change(true); button(modal, "Apply selected tags").click();
    const staleAdd = button(modal, "Add tags"); button(modal, "Cancel").click(); staleAdd.click();
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(false);
    expect(modal.contentEl.children).toEqual([]); expect(h.listeners.size).toBe(0);
    expect(confirm).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
    expect(h.processFrontMatter).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
    h.plugin.onunload();
  });

  it("uses current frontmatter case equivalence for a normal no-change result", async () => {
    const h = harness();
    const frontmatter: Record<string, unknown> = { tags: ["AWS"], title: "Preserved" };
    const tags = frontmatter.tags;
    h.processFrontMatter.mockImplementation(async (_file, callback) => { callback(frontmatter); });
    const apply = vi.spyOn(TagApplyService.prototype, "apply");
    await h.plugin.onload(); await h.plugin.tagSuggestionCommand!.execute();
    const modal = currentModal();
    const grant = modal.preparation.suggestionGrant!;
    const dispose = vi.spyOn(modal.preparation, "dispose");
    const close = vi.spyOn(modal, "close");
    checkboxes(modal)[0].change(true); button(modal, "Apply selected tags").click();
    button(modal, "Add tags").click(); await flush();
    expect(apply).toHaveBeenCalledOnce();
    expect(await apply.mock.results[0].value).toEqual({ status: "no-change" });
    expect(frontmatter).toEqual({ tags: ["AWS"], title: "Preserved" });
    expect(frontmatter.tags).toBe(tags);
    expect((Notice as unknown as { instances: Array<{ message: string }> }).instances.filter(notice => notice.message === "No tags needed to be added.")).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce(); expect(modal.contentEl.children).toEqual([]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(false);
    expect(h.listeners.size).toBe(0); expect(h.offref).toHaveBeenCalledOnce();
    expect(provider.evaluate).toHaveBeenCalledOnce(); expect(h.getSecret).toHaveBeenCalledOnce();
    expect(h.forbidden).not.toHaveBeenCalled(); modal.close(); h.plugin.onunload();
  });

  it.each(["close", "Escape", "unload"] as const)("%s after processFrontMatter starts allows its actual result and defers authority disposal", async action => {
    const h = harness();
    const frontmatter: Record<string, unknown> = { title: "Synthetic title" };
    let callback!: (frontmatter: Record<string, unknown>) => void;
    let complete!: () => void;
    h.processFrontMatter.mockImplementation((_file, applyTags) => {
      callback = applyTags;
      return new Promise<void>(resolve => { complete = resolve; });
    });
    const apply = vi.spyOn(TagApplyService.prototype, "apply");
    await h.plugin.onload(); await h.plugin.tagSuggestionCommand!.execute();
    const modal = currentModal();
    const grant = modal.preparation.suggestionGrant!;
    const dispose = vi.spyOn(modal.preparation, "dispose");
    checkboxes(modal)[0].change(true); button(modal, "Apply selected tags").click();
    const add = button(modal, "Add tags"); add.click();
    expect(h.processFrontMatter).toHaveBeenCalledExactlyOnceWith(h.original, expect.any(Function));
    const noticeCount = (Notice as unknown as { instances: unknown[] }).instances.length;
    if (action === "close") modal.close(); else if (action === "Escape") modal.scope.press("Escape"); else h.plugin.onunload();
    expect(apply.mock.calls[0][1].aborted).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(true);
    expect(modal.contentEl.children).toEqual([]);
    callback(frontmatter); complete(); await flush();
    expect(await apply.mock.results[0].value).toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(frontmatter).toEqual({ title: "Synthetic title", tags: ["aws"] });
    expect(dispose).toHaveBeenCalledOnce();
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(false);
    expect(h.listeners.size).toBe(0); expect(h.offref).toHaveBeenCalledOnce();
    expect(modal.contentEl.children).toEqual([]);
    expect((Notice as unknown as { instances: unknown[] }).instances).toHaveLength(noticeCount);
    add.click(); modal.scope.press("Enter"); await flush();
    expect(apply).toHaveBeenCalledOnce(); expect(h.processFrontMatter).toHaveBeenCalledOnce();
    expect(provider.evaluate).toHaveBeenCalledOnce(); expect(h.getSecret).toHaveBeenCalledOnce();
    expect(h.forbidden).not.toHaveBeenCalled(); h.plugin.onunload();
  });

  it.each(["close", "unload"] as const)("%s reentered from final core confirmation aborts before processFrontMatter", async action => {
    const h = harness();
    const apply = vi.spyOn(TagApplyService.prototype, "apply");
    await h.plugin.onload(); await h.plugin.tagSuggestionCommand!.execute();
    const modal = currentModal();
    const grant = modal.preparation.suggestionGrant!;
    const originalConfirm = modal.preparation.confirm.bind(modal.preparation);
    const confirm = vi.spyOn(modal.preparation, "confirm").mockImplementation(selectedTags => {
      const intent = originalConfirm(selectedTags);
      if (action === "close") modal.close(); else h.plugin.onunload();
      return intent;
    });
    checkboxes(modal)[0].change(true); button(modal, "Apply selected tags").click();
    button(modal, "Add tags").click(); await flush();
    expect(confirm).toHaveBeenCalledExactlyOnceWith(["#aws"]);
    expect(h.processFrontMatter).not.toHaveBeenCalled();
    expect(modal.contentEl.children).toEqual([]);
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(false);
    expect(h.listeners.size).toBe(0);
    expect(provider.evaluate).toHaveBeenCalledOnce(); expect(h.getSecret).toHaveBeenCalledOnce();
    expect(h.forbidden).not.toHaveBeenCalled();
    expect(apply.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
    h.plugin.onunload();
  });

  it.each(["close", "unload"] as const)("%s during Apply source resolution still starts no processFrontMatter", async action => {
    const h = harness();
    const apply = vi.spyOn(TagApplyService.prototype, "apply");
    await h.plugin.onload(); await h.plugin.tagSuggestionCommand!.execute();
    const modal = currentModal();
    const grant = modal.preparation.suggestionGrant!;
    checkboxes(modal)[0].change(true); button(modal, "Apply selected tags").click();
    h.getFileByPath.mockImplementation(path => {
      if (apply.mock.calls.length > 0) {
        if (action === "close") modal.close(); else h.plugin.onunload();
      }
      return path === h.original.path ? h.original : path === h.other.path ? h.other : null;
    });
    button(modal, "Add tags").click(); await flush();
    expect(apply).toHaveBeenCalledOnce();
    expect(await apply.mock.results[0].value).toEqual({ status: "cancelled" });
    expect(h.processFrontMatter).not.toHaveBeenCalled();
    expect(isIssuedSuggestionGrant(grant, h.plugin.app.vault)).toBe(false);
    expect(h.listeners.size).toBe(0); expect(modal.contentEl.children).toEqual([]);
    expect(provider.evaluate).toHaveBeenCalledOnce(); expect(h.getSecret).toHaveBeenCalledOnce();
    expect(h.forbidden).not.toHaveBeenCalled(); h.plugin.onunload();
  });
});
