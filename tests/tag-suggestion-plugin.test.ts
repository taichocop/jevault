import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "../src/classification/classification-errors";
import type { TagEvaluator } from "../src/tags/tag-evaluator";
const provider = vi.hoisted(() => ({ evaluate: vi.fn<TagEvaluator["evaluate"]>(), classify: vi.fn() }));
vi.mock("../src/classification/typesafe-adapter", () => ({ TypeSafeAdapter: class {
  evaluate = provider.evaluate;
  classify = provider.classify;
} }));
vi.mock("../src/settings-tab", () => ({ JevaultSettingTab: class {} }));
vi.mock("obsidian", () => {
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
  return { App: class {}, Modal, Notice, Plugin, getAllTags: (cache: { canonical: string[] }) => cache.canonical };
});


import JevaultPlugin from "../src/main";
function harness() {
  const original = { path: "A.md", basename: "A", extension: "md" } as TFile;
  const other = { path: "B.md", basename: "B", extension: "md" } as TFile;
  let active = original;
  const forbidden = vi.fn(() => { throw new Error("Forbidden mutation"); });
  const read = vi.fn(async () => "Synthetic Markdown body");
  const getFileCache = vi.fn((file: TFile) => ({ canonical: file === original ? ["#aws"] : ["#cloud"] }));
  const plugin = new JevaultPlugin({} as App, {} as never);
  plugin.app = {
    workspace: { getActiveFile: () => active },
    vault: { read, getMarkdownFiles: () => [original, other],
      getFileByPath: (path: string) => path === original.path ? original : other,
      modify: forbidden, rename: forbidden, delete: forbidden, create: forbidden, createFolder: forbidden, cachedRead: forbidden },
    metadataCache: { getFileCache },
    secretStorage: { getSecret: () => "unit-test-only" },
    fileManager: { processFrontMatter: forbidden, renameFile: forbidden },
  } as unknown as App;
  const runtime = plugin as unknown as { commands: Array<{ id: string; name: string; callback: () => void }> };
  return { plugin, runtime, original, other, read, getFileCache, forbidden, switchNote: () => { active = other; } };
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

describe("Tag Suggest plugin wiring and read-only safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provider.evaluate.mockResolvedValue({ evaluations: [{ tagId: "tag_001", tagName: "#aws", choice: "match", matchProbability: 0.96 }] });
    (Notice as unknown as { instances: unknown[] }).instances = [];
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
