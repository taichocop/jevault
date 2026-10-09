import type { App, Modal as ObsidianModal, TAbstractFile, TFile as ObsidianFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async () => ({ ...await import("./helpers/obsidian-move"), parseFrontMatterTags: () => null }));
import { NoteSource } from "../src/note-source";
import { OrganizationApplyFlow } from "../src/organizer/organization-apply-flow";
import { OrganizationApplyModal } from "../src/organizer/organization-apply-modal";
import { OrganizationApplyService } from "../src/organizer/organization-apply-service";
import { OrganizationApplyConfirmationSession } from "../src/organizer/organization-apply-confirmation";
import { OrganizationReviewModal } from "../src/organizer/organization-review-modal";
import { OrganizationReviewSession } from "../src/organizer/organization-review-session";
import { acquireVaultMutationLease } from "../src/vault-mutation-coordinator";
import type { OrganizationNoteAnalysis } from "../src/organizer/organization-analysis-result";
import { Element, Modal, TFile, TFolder } from "./helpers/obsidian-move";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function all(modal: ObsidianModal) { return (modal.contentEl as unknown as Element).all(); }
function button(modal: ObsidianModal, text: string) { return all(modal).find(e => e.tag === "button" && e.text === text)!; }
function text(modal: ObsidianModal) { return all(modal).map(e => e.text).filter(Boolean).join("\n"); }
function harness(count = 1, unavailable = false) {
  const files = Array.from({ length: count }, (_, index) => Object.assign(new TFile(`Inbox/${index}.md`),
    { stat: { ctime: 1, mtime: 2, size: 100 } }) as ObsidianFile);
  const dest = new TFolder("Dest"), inbox = new TFolder("Inbox");
  const entries = new Map<string, unknown>([["Dest", dest], ["Inbox", inbox], ...files.map(f => [f.path, f] as const)]);
  const forbidden = vi.fn(() => { throw new Error("Forbidden boundary"); });
  const vault = { configDir: ".obsidian", getAllFolders: vi.fn(() => [dest, inbox] as never),
    getAbstractFileByPath: vi.fn((path: string) => (entries.get(path) ?? null) as TAbstractFile | null),
    getFileByPath: vi.fn((path: string) => (entries.get(path) ?? null) as ObsidianFile | null),
    read: forbidden, cachedRead: forbidden, create: forbidden, createFolder: forbidden, delete: forbidden,
    modify: forbidden, secretLookup: forbidden, typesafe: forbidden, recollection: forbidden,
  };
  const fm = files.map(() => ({ tags: ["keep"] } as Record<string, unknown>));
  const manager = {
    processFrontMatter: vi.fn(async (f: ObsidianFile, cb: (fm: Record<string, unknown>) => void) => {
      cb(fm[files.indexOf(f)]); f.stat.mtime++; f.stat.size++;
    }),
    renameFile: vi.fn(async (f: TAbstractFile, path: string) => {
      entries.delete(f.path); f.path = path; entries.set(path, f);
    }),
  };
  const notes: OrganizationNoteAnalysis[] = files.map((file, i) => {
    const source = new NoteSource(file);
    return { source, snapshot: Object.freeze({ path: source.path, mtime: file.stat.mtime, size: file.stat.size }),
      status: unavailable && i === 0 ? "failed" : "success",
      folder: { status: "not-run", reason: "disabled" },
      tags: { status: "success", value: { status: "success", source, noteTitle: "Synthetic", suggestions: [] } } };
  });
  const review = new OrganizationReviewSession({ status: "completed", results: notes,
    progress: { total: count, processed: count, failed: unavailable ? 1 : 0 } }, ["Dest", "Inbox"], ["#reviewed", "#keep"],
  files.map(() => ({ status: "unavailable" })));
  const lifetime = new AbortController();
  const settings = { inboxPath: "", ignoredFolders: [] as string[] };
  const service = new OrganizationApplyService(vault, manager, () => settings);
  const apply = vi.spyOn(service, "apply"), confirm = vi.spyOn(OrganizationApplyConfirmationSession.prototype, "confirm");
  const dispose = vi.spyOn(review, "dispose");
  let modal!: OrganizationApplyModal;
  const reviewModal = new OrganizationReviewModal({} as App, review, lifetime.signal, session => {
    const flow = new OrganizationApplyFlow(vault, session, service, lifetime.signal);
    modal = new OrganizationApplyModal({} as App, flow); modal.open();
  });
  reviewModal.open();
  const finish = (tags: string[] = ["#reviewed"], folder: string | null = "Dest") => {
    notes.forEach((note, index) => {
      if (note.status === "failed") return;
      review.selectFolder(index, folder === null ? { kind: "keep-current" } : { kind: "existing-folder", path: folder });
      tags.forEach(name => review.selectTag(index, name, true));
    });
    button(reviewModal, "Finish review").click();
  };
  const navigate = () => { button(reviewModal, "Apply selected changes").click(); return modal; };
  return { files, entries, vault, manager, fm, forbidden, review, lifetime, service, apply, confirm, dispose, settings,
    reviewModal, finish, navigate, modal: () => modal };
}
afterEach(() => vi.restoreAllMocks());

describe("#111 real UI -> original confirmation -> production service", () => {
  it("Finish only exposes navigation; exact session/result survives one-owner transfer with no I/O", () => {
    const h = harness(2, true);
    expect(button(h.reviewModal, "Apply selected changes")).toBeUndefined();
    expect(h.confirm).not.toHaveBeenCalled(); h.finish();
    const exact = h.review.getResult()!, staleApply = button(h.reviewModal, "Apply selected changes");
    const modal = h.navigate(); staleApply.click(); h.reviewModal.close(); h.reviewModal.onOpen();
    expect(h.review.getResult()).toBe(exact); expect(h.dispose).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled(); expect(h.apply).not.toHaveBeenCalled();
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect(h.vault.getAllFolders).not.toHaveBeenCalled(); expect(h.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(text(modal)).toContain("Reviewed: 1. Unavailable: 1 (excluded from Apply).");
    expect(text(modal)).toContain("Inbox/1.md\nFolder: Dest\nTags: #reviewed");
    expect(text(modal)).toContain("Planned moves: 1. Tag selections: 1.");
    expect(text(modal)).toContain("Tag + Move is not atomic");
    expect(text(modal)).toContain("Inbox/0.md: Analysis unavailable; excluded from Apply.");
    modal.close(); expect(h.dispose).toHaveBeenCalledOnce(); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(["Cancel", "Escape", "X", "unload", "onClose"])("%s before final Confirm rejects all stale DOM actions without issuing a token", action => {
    const h = harness(); h.finish(); const modal = h.navigate(), stale = button(modal, "Confirm Apply");
    if (action === "Cancel") button(modal, "Cancel").click();
    else if (action === "Escape") (modal as unknown as Modal).scope.press("Escape");
    else if (action === "unload") h.lifetime.abort();
    else if (action === "onClose") modal.onClose(); else modal.close();
    stale.click(); stale.focus(); (modal as unknown as Modal).scope.press("Enter"); modal.onOpen();
    expect(h.confirm).not.toHaveBeenCalled(); expect(h.apply).not.toHaveBeenCalled();
    expect(h.dispose).toHaveBeenCalledOnce(); expect(text(modal)).toBe("");
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("single final keyboard Confirm disables synchronously; repetition/click/stale Close cannot replay", async () => {
    const h = harness(); h.finish(); const exact = h.review.getResult()!, modal = h.navigate();
    const gate = deferred(), original = h.manager.processFrontMatter.getMockImplementation()!;
    h.manager.processFrontMatter.mockImplementation(async (...args) => { await original(...args); await gate.promise; });
    const confirm = button(modal, "Confirm Apply"), staleCancel = button(modal, "Cancel");
    confirm.focus(); (modal as unknown as Modal).scope.press("Enter", { repeat: true }); expect(h.confirm).not.toHaveBeenCalled();
    (modal as unknown as Modal).scope.press("Enter"); confirm.click(); confirm.focus(); (modal as unknown as Modal).scope.press("Enter"); staleCancel.click();
    expect(confirm.disabled).toBe(true); expect(h.confirm).toHaveBeenCalledOnce(); expect(h.apply).toHaveBeenCalledOnce();
    expect(h.review.getResult()).toBe(exact); expect(h.dispose).not.toHaveBeenCalled();
    expect(text(modal)).toContain("Current: Inbox/0.md");
    gate.resolve(); await flush();
    expect(h.dispose).toHaveBeenCalledOnce(); expect(text(modal)).toContain("Moved and tags updated");
    expect(text(modal)).toContain("Tags: Applied. Move: Applied."); expect(text(modal)).toContain("Inbox/0.md");
    expect(h.files[0].path).toBe("Dest/0.md"); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each([
    { tags: [], folder: null, outcome: "Unchanged", phase: "No tags selected. Move: Keep current folder", tag: 0, move: 0 },
    { tags: ["#reviewed"], folder: null, outcome: "Updated tags", phase: "Applied. Move: Keep current folder", tag: 1, move: 0 },
    { tags: [], folder: "Dest", outcome: "Moved", phase: "No tags selected. Move: Applied", tag: 0, move: 1 },
    { tags: ["#reviewed"], folder: "Inbox", outcome: "Updated tags", phase: "Applied. Move: Unchanged (same folder)", tag: 1, move: 0 },
  ])("renders actual Keep-current/same-folder/Tag-only/Move-only: $outcome $folder", async c => {
    const h = harness(); h.finish(c.tags, c.folder); const modal = h.navigate();
    expect(text(modal)).toContain(`Planned moves: ${c.move}. Tag selections: ${c.tags.length}.`);
    button(modal, "Confirm Apply").click(); await flush();
    expect(text(modal)).toContain(c.outcome); expect(text(modal)).toContain(c.phase);
    expect(h.manager.processFrontMatter).toHaveBeenCalledTimes(c.tag); expect(h.manager.renameFile).toHaveBeenCalledTimes(c.move);
  });
  it("completed-with-failure reports Tag-applied/Move-failed partial truth and original order, without raw errors", async () => {
    const h = harness(3, true); h.finish(); const modal = h.navigate();
    h.manager.renameFile.mockRejectedValueOnce(new Error("/private/synthetic-body-secret-provider"));
    button(modal, "Confirm Apply").click(); await flush();
    const ui = text(modal);
    expect(ui).toContain("Apply completed. Individual notes may have failed or been skipped.");
    expect(ui).toContain("2 / 2 processed. Failed: 1. Stale: 0.");
    expect(ui).toContain("Notes with applied changes: 2. Partial success: 1. No terminal result: 0.");
    expect(ui).toContain("Inbox/1.md\nPartial success\nTags: Applied. Move: Failed.");
    expect(ui.indexOf("Inbox/1.md")).toBeLessThan(ui.indexOf("Inbox/2.md"));
    expect(ui).not.toMatch(/synthetic-body|private|secret-provider|No changes were made/);
    expect(h.fm[1].tags).toContain("reviewed"); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(["stale", "replaced", "collision", "ineligible", "missing", "busy", "tag-failed", "move-failed"])("presents finite safe service reason: %s", async mode => {
    const h = harness(); h.finish(); const modal = h.navigate(); let held: ReturnType<typeof acquireVaultMutationLease>;
    if (mode === "stale") h.files[0].stat.mtime++;
    if (mode === "replaced") h.entries.set(h.files[0].path, Object.assign(new TFile(h.files[0].path), { stat: { ...h.files[0].stat } }));
    if (mode === "collision") h.entries.set("Dest/0.md", new TFile("Dest/0.md"));
    if (mode === "ineligible") h.settings.ignoredFolders = ["Dest"];
    if (mode === "missing") h.entries.delete("Dest");
    if (mode === "busy") held = acquireVaultMutationLease(h.vault, h.files[0].path);
    if (mode === "tag-failed") h.manager.processFrontMatter.mockRejectedValueOnce(new Error("private body"));
    if (mode === "move-failed") h.manager.renameFile.mockRejectedValueOnce(new Error("private body"));
    button(modal, "Confirm Apply").click(); await flush(); held?.release();
    expect(text(modal)).toContain(mode === "stale" || mode === "replaced" ? "Stale / skipped" : mode === "move-failed" ? "Partial success" : "Failed");
    const reason = { stale: "original source changed", replaced: "original source changed", collision: "target already exists",
      ineligible: "no longer eligible", missing: "no longer available", busy: "Another Jevault mutation", "tag-failed": "Tag operation failed", "move-failed": "Move operation failed" };
    expect(text(modal)).toContain(reason[mode as keyof typeof reason]); expect(text(modal)).not.toContain("private body");
  });
  it("expired original confirmation fails closed on final Confirm and cannot retry", async () => {
    const h = harness(); h.finish(); const modal = h.navigate(), confirm = button(modal, "Confirm Apply"); h.review.dispose();
    confirm.click(); confirm.click(); await flush();
    expect(h.confirm).toHaveBeenCalledOnce(); expect(h.apply).not.toHaveBeenCalled();
    expect(text(modal)).toContain("Confirmation or Apply is unavailable");
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it.each(["tag", "move"])("Stop during %s retains authority/lease through settlement and never starts next Note", async phase => {
    const h = harness(2); h.finish(); const exact = h.review.getResult()!, modal = h.navigate();
    const gate = deferred();
    if (phase === "tag") {
      const original = h.manager.processFrontMatter.getMockImplementation()!;
      h.manager.processFrontMatter.mockImplementation(async (...args) => { await original(...args); await gate.promise; });
    } else {
      const original = h.manager.renameFile.getMockImplementation()!;
      h.manager.renameFile.mockImplementation(async (...args) => { await original(...args); await gate.promise; });
    }
    button(modal, "Confirm Apply").click(); await flush(); const stop = button(modal, "Stop"); stop.click(); stop.click();
    expect(text(modal)).toContain("Stop requested. Waiting for in-flight work to settle.");
    expect(h.review.getResult()).toBe(exact); expect(h.dispose).not.toHaveBeenCalled();
    expect(acquireVaultMutationLease(h.vault, "Inbox/0.md", "Dest/0.md")).toBeUndefined();
    gate.resolve(); await flush();
    expect(text(modal)).toContain("Apply cancelled"); expect(text(modal)).toContain("1 / 2 processed");
    expect(text(modal)).toContain("No terminal result: 1"); expect(text(modal)).not.toContain("Inbox/1.md");
    expect(text(modal)).toContain(phase === "tag" ? "Cancelled after partial success" : "Moved and tags updated");
    expect(h.manager.processFrontMatter).toHaveBeenCalledOnce(); expect(h.manager.renameFile).toHaveBeenCalledTimes(phase === "tag" ? 0 : 1);
    expect(h.dispose).toHaveBeenCalledOnce(); const lease = acquireVaultMutationLease(h.vault, "Inbox/0.md", "Dest/0.md"); expect(lease).toBeDefined(); lease?.release();
  });
  it.each(["X", "Escape", "unload", "onClose"])("%s during Apply detaches UI synchronously but owns authority until actual settlement", async action => {
    const h = harness(2); h.finish(); const exact = h.review.getResult()!, modal = h.navigate();
    const gate = deferred(), original = h.manager.processFrontMatter.getMockImplementation()!;
    h.manager.processFrontMatter.mockImplementation(async (...args) => { await original(...args); await gate.promise; });
    button(modal, "Confirm Apply").click(); const staleStop = button(modal, "Stop");
    if (action === "unload") h.lifetime.abort(); else if (action === "Escape") (modal as unknown as Modal).scope.press("Escape");
    else if (action === "onClose") modal.onClose(); else modal.close();
    const empty = vi.spyOn(modal.contentEl, "empty"), create = vi.spyOn(modal.contentEl, "createEl");
    expect(h.review.getResult()).toBe(exact); expect(h.dispose).not.toHaveBeenCalled();
    staleStop.click(); modal.onOpen(); gate.resolve(); await flush();
    expect(h.dispose).toHaveBeenCalledOnce(); expect(empty).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    expect(h.manager.processFrontMatter).toHaveBeenCalledOnce(); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect(text(modal)).toBe(""); expect(h.fm[0].tags).toContain("reviewed");
  });
  it("authority failure during Apply stops and retains actual phase truth", async () => {
    const h = harness(); h.finish(); const modal = h.navigate();
    const gate = deferred(), original = h.manager.processFrontMatter.getMockImplementation()!;
    h.manager.processFrontMatter.mockImplementation(async (...args) => { await original(...args); await gate.promise; });
    button(modal, "Confirm Apply").click(); h.review.dispose(); gate.resolve(); await flush();
    expect(text(modal)).toContain("Apply stopped"); expect(text(modal)).toContain("original confirmation is no longer valid");
    expect(text(modal)).toContain("Partial success\nTags: Applied. Move: Not started (prior failure).");
  });
  it("selected frontmatter Tags already present render unchanged phase without claiming applied changes", async () => {
    const h = harness(); h.finish(["#keep"], "Inbox"); const modal = h.navigate();
    button(modal, "Confirm Apply").click(); await flush();
    expect(text(modal)).toContain("Unchanged\nTags: Unchanged. Move: Unchanged (same folder).");
    expect(text(modal)).toContain("Notes with applied changes: 0");
    expect(h.manager.processFrontMatter).toHaveBeenCalledOnce(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("render failure aborts and detaches while retaining original owner until in-flight settlement", async () => {
    const h = harness(); h.finish(); const modal = h.navigate(), exact = h.review.getResult();
    const gate = deferred(), original = h.manager.processFrontMatter.getMockImplementation()!;
    h.manager.processFrontMatter.mockImplementation(async (...args) => { await original(...args); await gate.promise; });
    button(modal, "Confirm Apply").click();
    vi.spyOn(modal.contentEl, "createEl").mockImplementationOnce(() => { throw new Error("synthetic UI failure"); });
    button(modal, "Stop").click();
    expect(h.review.getResult()).toBe(exact); expect(h.dispose).not.toHaveBeenCalled();
    gate.resolve(); await flush(); expect(h.dispose).toHaveBeenCalledOnce(); expect(text(modal)).toBe("");
    expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("zero eligible Review results never offer navigation", () => {
    const h = harness(1, true); h.finish(); expect(button(h.reviewModal, "Apply selected changes")).toBeUndefined();
    expect(h.confirm).not.toHaveBeenCalled(); expect(h.apply).not.toHaveBeenCalled();
  });
});
