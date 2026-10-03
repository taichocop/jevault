import type { App, EventRef, MetadataCache, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeElement {
  children: FakeElement[];
  disabled: boolean;
  checked: boolean;
  type: string;
  text: string;
  tag: string;
  click(detail?: number): void;
  change(checked: boolean): void;
  focus(): void;
}
interface FakeScope { press(key: string, options?: Partial<KeyboardEvent>): void }

vi.mock("obsidian", async () => {
  const { TFile } = await import("./helpers/obsidian-move");
  class Element {
    children: Element[] = [];
    disabled = false;
    checked = false;
    type = "";
    text = "";
    tag = "";
    ownerDocument: { activeElement: Element | null };
    private handlers = new Map<string, (event: unknown) => void>();
    constructor(doc = { activeElement: null as Element | null }) { this.ownerDocument = doc; }
    empty(): void { this.children = []; this.ownerDocument.activeElement = null; }
    createEl(tag: string, options?: { text?: string; type?: string; attr?: Record<string, string> }): Element {
      const child = new Element(this.ownerDocument);
      child.tag = tag; child.text = options?.text ?? ""; child.type = options?.type ?? options?.attr?.type ?? "";
      this.children.push(child); return child;
    }
    addEventListener(event: string, handler: (event: unknown) => void): void { this.handlers.set(event, handler); }
    // stale/disabled callbackも呼び、DOMだけに依存しない状態guardを検証する。
    click(detail = 1): void { this.handlers.get("click")?.({ detail }); }
    change(checked: boolean): void { this.checked = checked; this.handlers.get("change")?.({ target: this }); }
    focus(): void { this.ownerDocument.activeElement = this; }
  }
  class Scope {
    active = false;
    private handlers = new Map<string, (event: KeyboardEvent) => unknown>();
    register(_modifiers: string[], key: string, handler: (event: KeyboardEvent) => unknown): void { this.handlers.set(key, handler); }
    press(key: string, options: Partial<KeyboardEvent> = {}): void { if (this.active) this.handlers.get(key)?.({ key, ...options } as KeyboardEvent); }
  }
  class Modal {
    contentEl = new Element();
    scope = new Scope();
    constructor() { this.scope.register([], "Escape", () => this.close()); }
    open(): void { this.scope.active = true; (this as unknown as { onOpen(): void }).onOpen(); }
    close(): void { this.scope.active = false; (this as unknown as { onClose(): void }).onClose(); }
  }
  return { App: class {}, Modal, TFile, getAllTags: () => [], parseFrontMatterTags: () => [] };
});

import { NoteSource } from "../src/note-source";
import type { TagApplyFailureReason } from "../src/tags/tag-apply-authorization";
import { isActiveConfirmedTagApplyIntent, TagApplyPreparationSession, type TagApplyReadiness } from "../src/tags/tag-apply-preparation";
import { TagApplyService, type TagApplyResult } from "../src/tags/tag-apply-service";
import type { ExistingTagSnapshot } from "../src/tags/existing-tag-snapshot";
import type { TagSuggestionFreshness } from "../src/tags/tag-suggestion-freshness";
import { TagSuggestionGrantIssuer } from "../src/tags/tag-suggestion-grant";
import { TagSuggestionModal } from "../src/tags/tag-suggestion-modal";
import type { TagSuggestionServiceResult } from "../src/tags/tag-suggestion-service";
import { TFile as FakeFile } from "./helpers/obsidian-move";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function all(element: FakeElement): FakeElement[] { return [element, ...element.children.flatMap(all)]; }
function texts(element: FakeElement): string[] { return all(element).map(node => node.text).filter(Boolean); }
function harness(options: { tags?: string[]; snapshot?: ExistingTagSnapshot; realService?: boolean } = {}) {
  const file = Object.assign(new FakeFile("Synthetic/Original.md"), { stat: { ctime: 1, mtime: 2, size: 100 } }) as TFile;
  const source = new NoteSource(file);
  const outcome: TagSuggestionServiceResult = {
    status: "success", source, noteTitle: "Synthetic <note>",
    suggestions: (options.tags ?? ["#aws", "#cloud", "#programming/aws"]).map((tagName, index) => ({
      tagId: `synthetic_${index}`, tagName, choice: "match", matchProbability: [0.96, 0.88, 0.82][index] ?? 1,
    })),
  };
  const forbidden = vi.fn(() => { throw new Error("Forbidden synthetic boundary"); });
  const vault = { getFileByPath: vi.fn((path: string) => path === source.path ? file : null) };
  const metadata = { on: vi.fn(() => ({} as EventRef)), offref: vi.fn() };
  const session = new TagApplyPreparationSession(vault, metadata as Pick<MetadataCache, "on" | "offref">, file);
  session.prepare(outcome, new TagSuggestionGrantIssuer(vault).issue(outcome));
  let freshness: TagSuggestionFreshness = "matching";
  const getReadiness = vi.fn((selected: readonly string[]): TagApplyReadiness => ({ ...session.getReadiness(selected), freshness }));
  const confirm = vi.fn((selected: readonly string[]) => session.confirm(selected));
  const dispose = vi.fn(() => session.dispose());
  const preparation = {
    get suggestionGrant() { return session.suggestionGrant; },
    get suggestionFreshness() { return freshness; },
    getReadiness, confirm, dispose,
  };
  const frontmatter: Record<string, unknown> = {};
  const fileManager = { processFrontMatter: vi.fn(async (_file: TFile, callback: (value: Record<string, unknown>) => void) => { callback(frontmatter); }) };
  const service = new TagApplyService(vault, fileManager);
  const apply = vi.fn<TagApplyService["apply"]>(options.realService ? service.apply.bind(service) : async () => ({ status: "no-change" }));
  const notify = vi.fn();
  const owner = new AbortController();
  const app = { workspace: { getActiveFile: forbidden }, provider: forbidden, getApiKey: forbidden } as unknown as App;
  const modal = new TagSuggestionModal(app, outcome, options.snapshot ?? { status: "available", names: ["#aws", "#CLOUD"] }, owner.signal, preparation, { apply }, notify);
  const content = modal.contentEl as unknown as FakeElement;
  const scope = modal.scope as unknown as FakeScope;
  const buttons = () => all(content).filter(node => node.tag === "button");
  const button = (name: string) => {
    const found = buttons().find(node => node.text === name);
    if (!found) throw new Error(`Missing synthetic button: ${name}`);
    return found;
  };
  const checkboxes = () => all(content).filter(node => node.tag === "input" && node.type === "checkbox");
  const select = (...indices: number[]) => { for (const index of indices) checkboxes()[index].change(true); };
  const showConfirmation = () => button("Apply selected tags").click();
  const add = () => button("Add tags").click();
  const assertNoApply = () => {
    expect(confirm).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
    expect(fileManager.processFrontMatter).not.toHaveBeenCalled(); expect(forbidden).not.toHaveBeenCalled();
  };
  const settle = async () => { await vi.waitFor(() => expect(button("Apply selected tags").disabled).toBe(false)); };
  return { file, source, outcome, vault, session, preparation, getReadiness, confirm, dispose, frontmatter,
    fileManager, service, apply, notify, owner, modal, content, scope, buttons, button, checkboxes, select,
    showConfirmation, add, assertNoApply, settle, forbidden, setFreshness: (value: TagSuggestionFreshness) => { freshness = value; } };
}

afterEach(() => vi.restoreAllMocks());

describe("TagSuggestionModal manual selection", () => {
  it("preserves exact order, case, probabilities and annotations with labeled unchecked checkboxes", () => {
    const h = harness(); h.modal.open();
    expect(texts(h.content)).toContain("Suggested tags for “Synthetic <note>”");
    expect(texts(h.content).filter(text => text.startsWith("#"))).toEqual([
      "#aws — 96.0% — Already on note", "#cloud — 88.0%", "#programming/aws — 82.0%",
    ]);
    expect(h.checkboxes()).toHaveLength(3); expect(h.checkboxes().every(input => !input.checked)).toBe(true);
    expect(all(h.content).filter(node => node.tag === "label")).toHaveLength(3);
    expect(all(h.content).filter(node => ["input", "select", "textarea"].includes(node.tag)).every(node => node.type === "checkbox")).toBe(true);
    expect(h.button("Apply selected tags").disabled).toBe(true);
    h.assertNoApply(); h.select(1); h.assertNoApply(); h.modal.close();
  });

  it("keeps service order and exact allowed tag spelling through confirmation and Apply", async () => {
    const h = harness({ tags: ["#programming/aws", "#AWS", "#aws"] }); h.modal.open(); h.select(2, 0);
    h.showConfirmation(); h.assertNoApply(); h.add(); await h.settle();
    expect(h.confirm).toHaveBeenCalledExactlyOnceWith(["#programming/aws", "#aws"]);
    const request = h.apply.mock.calls[0][0];
    expect(isActiveConfirmedTagApplyIntent(request.confirmation, h.vault)).toBe(true);
    expect(request.confirmation.selectedTags).toEqual(["#programming/aws", "#aws"]);
    expect(request.confirmation.grant.source).toBe(h.source);
    expect(request).toEqual({ confirmation: h.confirm.mock.results[0].value }); h.modal.close();
  });

  it("opens a normal empty state without confirmation or an alarming readiness error", () => {
    const h = harness({ tags: [] }); h.modal.open();
    expect(texts(h.content)).toContain("No matching tags were suggested for this note."); expect(h.checkboxes()).toEqual([]);
    expect(h.buttons().filter(button => button.text === "Apply selected tags").every(button => button.disabled)).toBe(true);
    expect(texts(h.content).join(" ")).not.toMatch(/no longer valid|unavailable in the expected|session.*closed/i);
    h.assertNoApply(); h.modal.close();
  });

  it("keeps empty selection disabled and cannot confirm through its disabled callback", () => {
    const h = harness(); h.modal.open(); h.button("Apply selected tags").click();
    expect(h.button("Apply selected tags").disabled).toBe(true);
    expect(texts(h.content).join(" ")).not.toMatch(/no longer valid|could not|no longer available/i);
    h.assertNoApply(); h.modal.close();
  });

  it("keeps unavailable inline metadata advisory without claiming existing tags are absent", () => {
    const h = harness({ snapshot: { status: "unavailable" } }); h.modal.open();
    expect(texts(h.content)).toContain("Existing tags on this note are unknown because metadata is unavailable.");
    expect(texts(h.content).join(" ")).not.toContain("Already on note");
    h.select(0); expect(h.button("Apply selected tags").disabled).toBe(false); h.showConfirmation(); h.assertNoApply(); h.modal.close();
  });

  it.each(["matching", "changed", "unknown"] as const)("allows confirmation for %s advisory freshness", freshness => {
    const h = harness(); h.setFreshness(freshness); h.modal.open(); h.select(0);
    expect(h.button("Apply selected tags").disabled).toBe(false); h.showConfirmation(); expect(h.button("Add tags").disabled).toBe(false);
    const rendered = texts(h.content).join(" ");
    if (freshness === "changed") expect(rendered).toMatch(/changed/i);
    if (freshness === "unknown") expect(rendered).toMatch(/unknown|couldn't determine/i);
    h.assertNoApply(); h.modal.close();
  });

  it("refreshes freshness on selection and again before opening confirmation", () => {
    const h = harness(); h.modal.open(); h.setFreshness("changed"); h.select(1); expect(texts(h.content).join(" ")).toMatch(/changed/i);
    h.setFreshness("unknown"); h.showConfirmation(); expect(texts(h.content).join(" ")).toMatch(/unknown|couldn't determine/i);
    expect(h.getReadiness).toHaveBeenLastCalledWith(["#cloud"]); h.assertNoApply(); h.modal.close();
  });

  it.each(["session-closed", "grant-unavailable", "source-changed", "invalid-selection", "empty-selection"] as const)(
    "keeps suggestions visible and prevents confirmation for blocked %s", reason => {
      const h = harness(); h.getReadiness.mockReturnValue({ status: "blocked", reason, freshness: "unknown" }); h.modal.open(); h.select(1);
      expect(texts(h.content).join(" ")).toContain("#cloud — 88.0%"); expect(h.button("Apply selected tags").disabled).toBe(true);
      h.button("Apply selected tags").click(); h.assertNoApply(); h.modal.close();
    },
  );

  it("rechecks source change between selection and confirmation without retargeting", () => {
    const h = harness(); h.modal.open(); h.select(0); h.vault.getFileByPath.mockReturnValue(new FakeFile(h.source.path) as TFile);
    h.showConfirmation(); expect(h.button("Apply selected tags").disabled).toBe(true); h.assertNoApply(); h.modal.close();
  });

  it("preserves Close-only display and preparation disposal when Apply is not wired", () => {
    const h = harness(); const modal = new TagSuggestionModal({} as App, h.outcome, { status: "available", names: [] }, h.owner.signal, h.preparation);
    modal.open(); const content = modal.contentEl as unknown as FakeElement;
    expect(all(content).filter(node => ["button", "input", "select", "textarea"].includes(node.tag)).map(node => node.text)).toEqual(["Close"]);
    all(content).find(node => node.tag === "button")!.click(); modal.onClose(); modal.open();
    expect(content.children).toEqual([]); expect(h.dispose).toHaveBeenCalledOnce(); h.assertNoApply();
  });
});

describe("TagSuggestionModal explicit confirmation", () => {
  it("shows only selected exact tags and the original Grant-bound source", () => {
    const h = harness(); h.modal.open(); h.select(1); h.showConfirmation(); const rendered = texts(h.content).join(" ");
    expect(rendered).toContain(h.source.path); expect(rendered).toContain("#cloud"); expect(rendered).not.toContain("#programming/aws");
    h.assertNoApply(); h.modal.close();
  });

  it("Cancel disposes the result like Esc and stale confirmation cannot Apply", () => {
    const h = harness(); h.modal.open(); h.select(0); h.showConfirmation(); const staleAdd = h.button("Add tags");
    h.button("Cancel").click(); h.assertNoApply(); staleAdd.click(); h.assertNoApply();
    expect(h.dispose).toHaveBeenCalledOnce(); expect(h.session.suggestionGrant).toBeUndefined();
    expect(h.content.children).toEqual([]); h.modal.open(); expect(h.content.children).toEqual([]);
  });

  it("selection changes before final confirmation use only the current selected tags", async () => {
    const h = harness(); h.modal.open(); h.select(0); const staleInput = h.checkboxes()[1];
    h.checkboxes()[0].change(false); staleInput.change(true); h.select(2); h.showConfirmation(); expect(texts(h.content).join(" ")).not.toContain("#aws");
    h.add(); await h.settle(); expect(h.confirm).toHaveBeenCalledExactlyOnceWith(["#programming/aws"]);
    expect(h.apply.mock.calls[0][0].confirmation.selectedTags).toEqual(["#programming/aws"]); h.modal.close();
  });

  it.each(["review", "confirmation"])("Close and Esc at %s dispose once without Apply and cannot reopen", state => {
    for (const action of ["Close", "Escape"] as const) {
      const h = harness(); h.modal.open(); h.select(0); if (state === "confirmation") h.showConfirmation();
      if (action === "Escape") h.scope.press("Escape"); else if (state === "review") h.button("Close").click(); else h.modal.close();
      h.modal.onClose(); h.modal.open(); expect(h.content.children).toEqual([]); expect(h.dispose).toHaveBeenCalledOnce(); h.assertNoApply();
    }
  });

  it("requires core-issued confirmation and shows safe feedback when confirmation is unavailable", () => {
    const h = harness(); h.confirm.mockReturnValue(undefined); h.modal.open(); h.select(0); h.showConfirmation(); h.add();
    expect(h.confirm).toHaveBeenCalledExactlyOnceWith(["#aws"]); expect(h.apply).not.toHaveBeenCalled();
    expect(texts(h.content)).toContain("This confirmation is no longer valid. Review the tags again.");
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled(); h.modal.close();
  });

  it("blocks double-click, pending selection, stale handlers and repeated Enter from starting a second attempt", async () => {
    const h = harness(); const pending = deferred<TagApplyResult>(); h.apply.mockReturnValue(pending.promise);
    h.modal.open(); h.select(0); const oldInput = h.checkboxes()[1]; const review = h.button("Apply selected tags");
    review.click(); const add = h.button("Add tags"); review.click(2); add.click(2); expect(h.confirm).not.toHaveBeenCalled();
    add.click(); add.click(); h.scope.press("Enter", { repeat: true }); h.scope.press("Enter"); oldInput.change(true); review.click();
    expect(h.confirm).toHaveBeenCalledExactlyOnceWith(["#aws"]); expect(h.apply).toHaveBeenCalledOnce(); expect(h.button("Add tags").disabled).toBe(true);
    pending.resolve({ status: "no-change" }); await h.settle(); add.click(); expect(h.apply).toHaveBeenCalledOnce(); h.modal.close();
  });

  it("allows one deliberate Enter and ignores held, composing or modified Enter", async () => {
    const h = harness(); const pending = deferred<TagApplyResult>(); h.apply.mockReturnValue(pending.promise);
    h.modal.open(); h.select(1); h.showConfirmation(); h.button("Add tags").focus();
    for (const options of [{ repeat: true }, { isComposing: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) h.scope.press("Enter", options);
    h.assertNoApply(); h.scope.press("Enter"); h.scope.press("Enter", { repeat: true });
    expect(h.confirm).toHaveBeenCalledExactlyOnceWith(["#cloud"]); expect(h.apply).toHaveBeenCalledOnce();
    pending.resolve({ status: "no-change" }); await h.settle(); h.modal.close();
  });

  it("does not turn Enter on review or Cancel into Add tags", () => {
    const h = harness(); h.modal.open(); h.select(0); h.scope.press("Enter"); h.assertNoApply();
    h.showConfirmation(); h.button("Cancel").focus(); h.scope.press("Enter"); h.assertNoApply(); h.modal.close();
  });
});

describe("TagSuggestionModal Apply feedback and lifecycle", () => {
  it.each([
    { result: { status: "applied", addedTags: ["#aws", "#cloud"] }, text: "Added 2 tags." },
    { result: { status: "no-change" }, text: "No tags needed to be added." },
    { result: { status: "failure", reason: "busy" }, text: "Tag changes are already being applied." },
    { result: { status: "failure", reason: "source-changed" }, text: "The original note is no longer available in the expected location." },
    { result: { status: "failure", reason: "invalid-confirmation" }, text: "This confirmation is no longer valid. Review the tags again." },
    { result: { status: "failure", reason: "invalid-selection" }, text: "The selected tags are no longer valid." },
    { result: { status: "failure", reason: "unexpected" }, text: "Jevault could not add the selected tags." },
  ] as const)("maps $result.status/$text to safe feedback without automatic retry", async ({ result, text }) => {
    const h = harness(); h.apply.mockResolvedValue(result); h.modal.open(); h.select(1); h.showConfirmation(); h.add(); await h.settle();
    expect(h.notify).toHaveBeenCalledExactlyOnceWith(text); expect(h.apply).toHaveBeenCalledOnce(); expect(h.confirm).toHaveBeenCalledOnce(); h.modal.close();
  });

  it.each(["revision-changed", "tag-state-changed", "metadata-unavailable", "freshness-unverified", "metadata-stale"] as const)(
    "maps historical %s failure to a safe generic message", async (reason: TagApplyFailureReason) => {
      const h = harness(); h.apply.mockResolvedValue({ status: "failure", reason }); h.modal.open(); h.select(0); h.showConfirmation(); h.add(); await h.settle();
      expect(h.notify).toHaveBeenCalledExactlyOnceWith("Jevault could not add the selected tags."); h.modal.close();
    },
  );

  it("treats cancelled Apply as silent and returns to review without automatic retry", async () => {
    const h = harness(); h.apply.mockResolvedValue({ status: "cancelled" }); h.modal.open(); h.select(0); h.showConfirmation(); h.add(); await h.settle();
    expect(h.notify).not.toHaveBeenCalled(); expect(h.apply).toHaveBeenCalledOnce(); h.modal.close();
  });

  it("catches raw rejection without leaking body, digest, absolute path, Secret or exception", async () => {
    const h = harness(); const raw = "PRIVATE_BODY PRIVATE_DIGEST /private/Synthetic.md SYNTHETIC_SECRET";
    h.apply.mockRejectedValue(new Error(raw)); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.modal.open(); h.select(0); h.showConfirmation(); h.add(); await h.settle();
    expect(h.notify).toHaveBeenCalledExactlyOnceWith("Jevault could not add the selected tags.");
    expect(texts(h.content).join(" ")).not.toContain(raw); expect(log).not.toHaveBeenCalled(); h.modal.close();
  });

  it("lets current frontmatter prevent a case-equivalent duplicate and reports normal no-change", async () => {
    const h = harness({ realService: true }); h.frontmatter.tags = ["AWS"]; h.modal.open(); h.select(0); h.showConfirmation(); h.add(); await h.settle();
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce(); expect(h.frontmatter.tags).toEqual(["AWS"]);
    expect(h.notify).toHaveBeenCalledExactlyOnceWith("No tags needed to be added."); expect(h.forbidden).not.toHaveBeenCalled(); h.modal.close();
  });

  it("uses the original Grant-bound file for Apply without consulting a switched active note", async () => {
    const h = harness({ realService: true }); h.modal.open(); h.select(1); h.showConfirmation(); expect(texts(h.content)).toContain(h.source.path); h.add(); await h.settle();
    expect(h.fileManager.processFrontMatter.mock.calls[0][0]).toBe(h.file); expect(h.apply.mock.calls[0][0].confirmation.grant.source).toBe(h.source);
    expect(h.frontmatter.tags).toEqual(["cloud"]); expect(h.forbidden).not.toHaveBeenCalled(); h.modal.close();
  });

  it.each(["Close", "Escape", "unload"] as const)("%s before mutation starts aborts Apply and suppresses late feedback", async action => {
    const h = harness(); const start = deferred<void>(); h.apply.mockImplementation(async (request, signal) => { await start.promise; return h.service.apply(request, signal); });
    h.modal.open(); h.select(0); h.showConfirmation(); h.add(); const signal = h.apply.mock.calls[0][1];
    if (action === "unload") h.owner.abort(); else if (action === "Escape") h.scope.press("Escape"); else h.modal.close();
    expect(signal.aborted).toBe(true); expect(h.content.children).toEqual([]); start.resolve();
    await vi.waitFor(() => expect(h.dispose).toHaveBeenCalledOnce()); expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled(); h.modal.open(); expect(h.content.children).toEqual([]);
  });

  it.each(["Close", "Escape", "unload"] as const)("%s after API start defers disposal, finishes the actual operation and cannot revive UI", async action => {
    const h = harness({ realService: true }); const complete = deferred<void>(); h.fileManager.processFrontMatter.mockImplementation(async (_file, callback) => { await complete.promise; callback(h.frontmatter); });
    h.modal.open(); h.select(2); h.showConfirmation(); h.add(); expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
    if (action === "unload") h.owner.abort(); else if (action === "Escape") h.scope.press("Escape"); else h.modal.close();
    expect(h.apply.mock.calls[0][1].aborted).toBe(true); expect(h.dispose).not.toHaveBeenCalled(); expect(h.content.children).toEqual([]); complete.resolve();
    await vi.waitFor(() => expect(h.dispose).toHaveBeenCalledOnce());
    expect(await h.apply.mock.results[0].value).toEqual({ status: "applied", addedTags: ["#programming/aws"] });
    expect(h.frontmatter.tags).toEqual(["programming/aws"]); expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
    expect(h.notify).not.toHaveBeenCalled(); expect(h.content.children).toEqual([]); expect(h.forbidden).not.toHaveBeenCalled();
    h.modal.onClose(); h.modal.open(); expect(h.dispose).toHaveBeenCalledOnce(); expect(h.content.children).toEqual([]);
  });

  it("closes on owner unload before confirmation and cannot reopen", () => {
    const h = harness(); h.modal.open(); h.owner.abort(); h.modal.open(); expect(h.content.children).toEqual([]); expect(h.dispose).toHaveBeenCalledOnce(); h.assertNoApply();
  });
});
