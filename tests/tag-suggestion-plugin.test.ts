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
    text = "";
    private clickHandler: (() => void) | undefined;

    empty(): void {
      this.children = [];
    }

    createEl(_tag: string, options?: { text?: string }): Element {
      const child = new Element();
      child.text = options?.text ?? "";
      this.children.push(child);
      return child;
    }

    addEventListener(event: string, handler: () => void): void {
      if (event === "click") {
        this.clickHandler = handler;
      }
    }

    click(): void {
      this.clickHandler?.();
    }
  }

  class Modal {
    static instances: Modal[] = [];
    constructor() { Modal.instances.push(this); }
    contentEl = new Element();

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
function harness() {
  const issue = vi.spyOn(TagSuggestionGrantIssuer.prototype, "issue");
  const original = new FakeFile("A.md") as TFile;
  const other = new FakeFile("B.md") as TFile;
  let active = original;
  const forbidden = vi.fn(() => { throw new Error("Forbidden mutation"); });
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
      getFileByPath: (path: string) => path === original.path ? original : other,
      modify: forbidden, rename: forbidden, delete: forbidden, create: forbidden, createFolder: forbidden, cachedRead: forbidden },
    metadataCache: { getFileCache, on, offref },
    secretStorage: { getSecret },
    fileManager: { processFrontMatter: forbidden, renameFile: forbidden },
  } as unknown as App;
  const runtime = plugin as unknown as { commands: Array<{ id: string; name: string; callback: () => void }> };
  return { plugin, runtime, issue, getSecret, on, offref, emit, listeners, original, other, read, getFileCache, forbidden, switchNote: () => { active = other; } };
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
  it("actual plugin wiring captures matching proof and keeps it until read-only Modal Close", async () => {
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
      expect(modals[0].preparation.applyPreparation.status).toBe("available");
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
    expect(modal.preparation.applyPreparation).toEqual({ status: "unavailable", reason: "freshness-unverified" });
    h.switchNote(); expect(grant.source.matches(h.other)).toBe(false);
    expect(modal.contentEl.children.map(child => child.text)).toEqual(["Suggested tags for “A”", "", "Close"]);
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
