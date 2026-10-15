import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async () => ({ ...await import("./helpers/obsidian-move") }));

import { readFileSync } from "node:fs";
import { NoteSource } from "../src/note-source";
import type { ExistingTagSnapshot } from "../src/tags/existing-tag-snapshot";
import type { FolderOrganizerAnalysisResult, OrganizationNoteAnalysis } from "../src/organizer/organization-analysis-result";
import { OrganizationReviewSession } from "../src/organizer/organization-review-session";
import { OrganizationReviewService } from "../src/organizer/organization-review-service";
import { OrganizationReviewModal } from "../src/organizer/organization-review-modal";
import { Element, Modal, TFile } from "./helpers/obsidian-move";

class ReviewElement extends Element {
  checked = false;
  value = "";
  type?: string;
  attr?: Record<string, string>;
  private changeHandler?: (event: Partial<MouseEvent> & { detail: number }) => void;
  override createEl(tag: string, options?: { text?: string; type?: string; value?: string; attr?: Record<string, string> }): ReviewElement {
    const child = new ReviewElement(tag, options?.text, this.ownerDocument);
    child.type = options?.type; child.value = options?.value ?? ""; child.attr = options?.attr;
    this.children.push(child); return child;
  }
  override addEventListener(event: string, handler: (event: Partial<MouseEvent> & { detail: number }) => void): void {
    if (event === "change") this.changeHandler = handler; else super.addEventListener(event, handler);
  }
  change(value: boolean | string = true): void {
    if (typeof value === "boolean") this.checked = value; else this.value = value;
    this.changeHandler?.({ detail: 0 });
  }
}
function analysisNote(path = "Inbox/A.md", status: OrganizationNoteAnalysis["status"] = "success"): OrganizationNoteAnalysis {
  const source = new NoteSource(Object.assign(new TFile(path), { stat: { mtime: 1, size: 2 } }) as never);
  return Object.freeze({ source, snapshot: Object.freeze({ path, mtime: 1, size: 2 }), status,
    folder: Object.freeze({ status: "success", value: Object.freeze({ status: "success", source, noteTitle: "Synthetic",
      result: Object.freeze({ candidates: Object.freeze([
        Object.freeze({ path: "Dest", probability: 0.99 }), Object.freeze({ path: "Other", probability: 0.01 }),
        Object.freeze({ path: "Stale", probability: 0 }),
      ]) }) }) }),
    tags: Object.freeze({ status: "success", value: Object.freeze({ status: "success", source, noteTitle: "Synthetic",
      suggestions: Object.freeze([
        Object.freeze({ tagId: "1", tagName: "#Ruby", choice: "match", matchProbability: 0.99 }),
        Object.freeze({ tagId: "2", tagName: "#nested/tag", choice: "match", matchProbability: 0.8 }),
        Object.freeze({ tagId: "3", tagName: "#Stale", choice: "match", matchProbability: 0.1 }),
      ]) }) }),
  });
}
function result(notes = [analysisNote()]): FolderOrganizerAnalysisResult {
  return Object.freeze({ status: "completed", results: Object.freeze(notes),
    progress: Object.freeze({ total: notes.length, processed: notes.length, failed: notes.filter(n => n.status === "failed").length }) });
}
function harness(notes = [analysisNote()], current?: ExistingTagSnapshot[], universe?: { folders: string[]; tags: string[] }) {
  const analysis = result(notes);
  const folders = universe?.folders ?? ["Dest", "Other", "Manual", "Inbox"];
  const tags = universe?.tags ?? ["#Ruby", "#ruby", "#nested/tag", "#manual"];
  const snapshots = current ?? notes.map(() => ({ status: "available" as const, names: ["#Ruby"] }));
  const session = new OrganizationReviewSession(analysis, folders, tags, snapshots);
  const owner = new AbortController();
  const modal = new OrganizationReviewModal({} as App, session, owner.signal);
  Object.assign(modal, { contentEl: new ReviewElement() }); modal.open();
  const all = () => (modal.contentEl as unknown as ReviewElement).all() as ReviewElement[];
  const texts = () => all().map(e => e.text).filter(Boolean);
  const button = (text: string) => all().find(e => e.tag === "button" && e.text === text)!;
  const radios = () => all().filter(e => e.type === "radio");
  const checkboxes = () => all().filter(e => e.type === "checkbox");
  const selects = () => all().filter(e => e.tag === "select");
  const section = (kind: "folder" | "tags") => all().filter(e => e.tag === "fieldset")[kind === "folder" ? 0 : 1];
  const scope = (modal as unknown as Modal).scope;
  return { analysis, folders, tags, snapshots, session, owner, modal, all, texts, button, radios, checkboxes, selects, section, scope };
}
afterEach(() => vi.restoreAllMocks());

describe("Review authority and preparation (#101 tests 4–14, 22, 24, 31–33, 37)", () => {
  it.each(["stopped", "cancelled"] as const)("rejects %s analysis before any local work", status => {
    const local = vi.fn();
    const service = new OrganizationReviewService({ getAvailableFolderPaths: local }, { discover: local }, { snapshot: local }, local);
    const analysis: FolderOrganizerAnalysisResult = status === "stopped" ? { ...result(), status, reason: "network" } : { ...result(), status };
    expect(service.prepare(analysis, new AbortController().signal)).toBeUndefined(); expect(local).not.toHaveBeenCalled();
    expect(() => new OrganizationReviewSession(analysis, [], [], [])).toThrow("Review unavailable");
  });
  it("captures one existing universe and exact-source metadata per Note, with exact analysis authority", () => {
    const analysis = result([analysisNote(), analysisNote("Other/B.md", "failed")]);
    const settings = { inboxPath: "Inbox", ignoredFolders: ["Templates"] };
    const folders = vi.fn(() => ["Dest"]), discover = vi.fn(() => [{ id: "1", name: "#Ruby" }]);
    const snapshot = vi.fn<(source: NoteSource) => ExistingTagSnapshot>(() => ({ status: "available", names: ["#Ruby"] }));
    const service = new OrganizationReviewService({ getAvailableFolderPaths: folders }, { discover }, { snapshot }, () => settings);
    const session = service.prepare(analysis, new AbortController().signal)!;
    expect(session.getAnalysisResult()).toBe(analysis); expect(folders).toHaveBeenCalledExactlyOnceWith(settings);
    expect(discover).toHaveBeenCalledOnce(); expect(snapshot.mock.calls.map(call => call[0])).toEqual(analysis.results.map(n => n.source));
    session.selectFolder(0, { kind: "keep-current" }); session.selectTag(0, "#Ruby", true); session.finish();
    expect(folders).toHaveBeenCalledOnce(); expect(discover).toHaveBeenCalledOnce(); expect(snapshot).toHaveBeenCalledTimes(2);
  });
  it.each(["settings", "folders", "tags", "snapshot"])("%s preparation exceptions create no session/intent", stage => {
    const fail = () => { throw new Error("synthetic-private-path-response"); };
    const service = new OrganizationReviewService(
      { getAvailableFolderPaths: stage === "folders" ? fail : () => ["Dest"] },
      { discover: stage === "tags" ? fail : () => [] }, { snapshot: stage === "snapshot" ? fail : () => ({ status: "unavailable" }) },
      stage === "settings" ? fail : () => ({ inboxPath: "Inbox", ignoredFolders: [] }),
    );
    expect(service.prepare(result(), new AbortController().signal)).toBeUndefined();
  });
  it.each(["before", "settings", "folders", "tags", "snapshot"])("unload during %s preparation fails closed", stage => {
    const owner = new AbortController(); if (stage === "before") owner.abort();
    const abort = (name: string) => { if (stage === name) owner.abort(); };
    const service = new OrganizationReviewService({ getAvailableFolderPaths: () => { abort("folders"); return ["Dest"]; } },
      { discover: () => { abort("tags"); return []; } }, { snapshot: () => { abort("snapshot"); return { status: "unavailable" }; } },
      () => { abort("settings"); return { inboxPath: "Inbox", ignoredFolders: [] }; });
    expect(service.prepare(result(), owner.signal)).toBeUndefined();
  });
  it("copies candidate and metadata arrays; later local edits cannot rebind review choices", () => {
    const h = harness(); h.folders.push("Later"); h.tags.push("#later");
    if (h.snapshots[0].status === "available") (h.snapshots[0].names as string[]).push("#later");
    expect(h.session.isFolderAvailable("Later")).toBe(false); expect(h.session.isTagAvailable("#later")).toBe(false);
    expect(h.session.getCurrentTags(0)).toEqual({ status: "available", names: ["#Ruby"] });
  });
});

describe("Folder intent and UI (#101 tests 15–30, 54, 78–79)", () => {
  it("starts entirely unreviewed with no Keep current, AI or manual preselection even at 99%", () => {
    const h = harness(); expect(h.radios().every(r => !r.checked)).toBe(true); expect(h.selects()[0].value).toBe("");
    expect(h.session.getDraft(0)?.folder).toEqual({ kind: "unreviewed" }); expect(h.session.getResult()).toBeUndefined();
    expect(h.session.getDraft(0)).not.toHaveProperty("selectedFolderPath");
  });
  it("renders original ordered history/probabilities and disables stale Folder suggestions", () => {
    const h = harness();
    expect(h.texts().filter(t => / — .*%/.test(t)).slice(0, 3)).toEqual(["Dest — 99.0%", "Other — 1.0%", "Stale — 0.0% — unavailable"]);
    expect(h.radios()[3].disabled).toBe(true); h.radios()[3].change();
    expect(h.session.getDraft(0)?.folder.kind).toBe("unreviewed");
    expect(h.session.selectFolder(0, { kind: "existing-folder", path: "Stale" })).toBe(false);
  });
  it.each(["Inbox/A.md", "Templates/A.md", "Excluded/A.md", "A.md"])("Keep current remains explicit for %s", path => {
    const h = harness([analysisNote(path)]); h.radios()[0].change();
    expect(h.session.getDraft(0)?.folder).toEqual({ kind: "keep-current" });
    expect(h.texts()).toContain(`Current folder: ${path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "Vault root"}`);
  });
  it("chooses AI Folder explicitly and replaces it with alternate/Keep current, one intent only", () => {
    const h = harness(); h.radios()[1].change(); expect(h.session.getDraft(0)?.folder).toEqual({ kind: "existing-folder", path: "Dest" });
    h.selects()[0].change("Manual"); expect(h.session.getDraft(0)?.folder).toEqual({ kind: "existing-folder", path: "Manual" });
    h.radios()[0].change(); expect(h.session.getDraft(0)?.folder).toEqual({ kind: "keep-current" });
    expect(h.radios().filter(r => r.checked)).toHaveLength(1); expect(h.selects()[0].value).toBe("");
  });
  it("alternate list uses captured eligible paths and excludes the current Folder", () => {
    const h = harness(); expect(h.selects()[0].children.map(e => e.text)).toEqual(["Choose a folder...", "Dest", "Other", "Manual"]);
    for (const path of ["New", "Templates", "", "/", "Inbox/New"]) {
      h.selects()[0].change(path); expect(h.session.selectFolder(0, { kind: "existing-folder", path })).toBe(false);
    }
    expect(h.session.getDraft(0)?.folder.kind).toBe("unreviewed");
    expect(h.all().filter(e => e.tag === "input").every(e => e.type === "radio" || e.type === "checkbox")).toBe(true);
  });
  it.each(["disabled", "prior-failure", "cancelled", "failure", "empty"] as const)("%s Folder history remains truthful and manual selection works", phase => {
    const note = analysisNote();
    const folder: OrganizationNoteAnalysis["folder"] = phase === "empty" ? { status: "success", value: { status: "success", source: note.source, noteTitle: "Synthetic", result: { candidates: [] } } }
      : phase === "failure" ? { status: "failure", reason: "network" } : { status: "not-run", reason: phase };
    const h = harness([{ ...note, folder }]); expect(h.radios()).toHaveLength(1);
    expect(h.texts()).toContain(phase === "empty" ? "No Folder suggestions." : phase === "disabled" ? "Folder analysis was disabled." : "Folder analysis is unavailable.");
    h.selects()[0].change("Manual"); expect(h.session.getDraft(0)?.folder).toEqual({ kind: "existing-folder", path: "Manual" });
    h.radios()[0].change(); expect(h.session.canFinish()).toBe(true);
  });
});

describe("Tag intent and UI (#101 tests 31–47, 59–61)", () => {
  it("shows advisory current Tags and ordered match probabilities; all start unchecked/unreviewed", () => {
    const h = harness(); expect(h.texts()).toContain("Current tags (advisory): #Ruby");
    expect(h.texts()).toContain("#Ruby — 99.0%"); expect(h.texts()).toContain("#nested/tag — 80.0%");
    expect(h.checkboxes().every(c => !c.checked)).toBe(true); expect(h.session.getDraft(0)?.tags).toEqual({ kind: "unreviewed" });
    expect(h.selects()[1].value).toBe(""); expect(h.selects()[1].children.map(e => e.text)).toEqual(["Choose an existing tag...", ...h.tags]);
  });
  it.each(["unavailable", "empty"])("renders %s current metadata safely without altering selection", state => {
    const h = harness([analysisNote()], [state === "empty" ? { status: "available", names: [] } : { status: "unavailable" }]);
    expect(h.texts()).toContain(state === "empty" ? "Current tags (advisory): None" : "Current tags are unknown (metadata unavailable).");
    expect(h.session.getDraft(0)?.tags.kind).toBe("unreviewed"); h.checkboxes()[0].change();
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: ["#Ruby"] });
  });
  it("stale exact representation is unavailable even if a case-equivalent Tag exists", () => {
    const note = analysisNote();
    const h = harness([{ ...note, tags: { status: "success", value: { status: "success", source: note.source, noteTitle: "Synthetic",
      suggestions: [{ tagId: "1", tagName: "#RUBY", choice: "match", matchProbability: 1 }] } } }]);
    expect(h.checkboxes()[0].disabled).toBe(true); expect(h.texts()).toContain("#RUBY — 100.0% — unavailable");
    h.checkboxes()[0].change(); expect(h.session.getDraft(0)?.tags.kind).toBe("unreviewed");
    expect(h.session.selectTag(0, "#RUBY", true)).toBe(false); h.selects()[1].change("#ruby");
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: ["#ruby"] });
  });
  it.each([0, 1, 3])("supports explicit %s Tag intent including return-to-zero", count => {
    const h = harness(); for (const name of h.tags.filter(n => n !== "#ruby").slice(0, count)) h.session.selectTag(0, name, true);
    if (count === 0) { h.session.selectTag(0, "#Ruby", true); h.session.selectTag(0, "#Ruby", false); }
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: h.tags.filter(n => n !== "#ruby").slice(0, count) });
  });
  it.each([["#Ruby", "#ruby"], ["#ruby", "#Ruby"]])("de-duplicates %s / %s without rewriting chosen representation", (first, second) => {
    const h = harness(); h.session.selectTag(0, first, true); h.session.selectTag(0, second, true);
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: [first] });
    h.session.selectFolder(0, { kind: "keep-current" }); expect(h.session.finish()?.reviewed[0].selectedTags).toEqual([first]);
  });
  it("manual existing non-suggested Tag can be added/unchecked without removing current Tags", () => {
    const h = harness(); h.selects()[1].change("#manual");
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: ["#manual"] });
    expect(h.texts()).toContain("Current tags (advisory): #Ruby"); h.checkboxes().at(-1)!.change(false);
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: [] });
    expect(h.texts()).toContain("Current tags (advisory): #Ruby");
    expect(h.texts().some(t => /remove|rename/i.test(t))).toBe(false);
  });
  it.each(["#new", "Ruby", "", "#Stale"])("rejects %s outside captured existing universe", name => {
    const h = harness(); h.selects()[1].change(name); expect(h.session.selectTag(0, name, true)).toBe(false);
    expect(h.session.getDraft(0)?.tags.kind).toBe("unreviewed");
  });
  it.each(["disabled", "prior-failure", "cancelled", "failure", "empty"] as const)("%s Tag history differs from empty success and permits existing manual choice", phase => {
    const note = analysisNote();
    const tags: OrganizationNoteAnalysis["tags"] = phase === "empty" ? { status: "success", value: { status: "success", source: note.source, noteTitle: "Synthetic", suggestions: [] } }
      : phase === "failure" ? { status: "failure", reason: "network" } : { status: "not-run", reason: phase };
    const h = harness([{ ...note, tags }]); expect(h.checkboxes()).toHaveLength(0);
    expect(h.texts()).toContain(phase === "empty" ? "No Tag suggestions." : phase === "disabled" ? "Tag analysis was disabled." : "Tag analysis is unavailable.");
    expect(h.texts()).toContain("Current tags (advisory): #Ruby"); h.selects()[1].change("#manual");
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: ["#manual"] });
  });
});

describe("Finish, failed Notes, immutable result (#101 tests 10–12, 48–77)", () => {
  it("opening and navigation create no reviewed intent; drafts persist across Previous/Next", () => {
    const h = harness([analysisNote(), analysisNote("Other/B.md")]); h.button("Next").click(); h.button("Previous").click();
    expect(h.session.getResult()).toBeUndefined(); expect(h.session.getDraft(0)?.tags.kind).toBe("unreviewed");
    h.radios()[1].change(); h.checkboxes()[0].change(); h.button("Next").click(); h.radios()[0].change(); h.button("Previous").click();
    expect(h.radios()[1].checked).toBe(true); expect(h.checkboxes()[0].checked).toBe(true);
    expect(h.session.getDraft(1)?.folder.kind).toBe("keep-current"); expect(h.session.getResult()).toBeUndefined();
  });
  it("failed Notes remain visible with zero controls and intent, and do not block successful Note review", () => {
    const h = harness([analysisNote("Inbox/Failed.md", "failed"), analysisNote("Inbox/B.md")]);
    expect(h.texts()).toContain("Inbox/Failed.md"); expect(h.texts()).toContain("Analysis unavailable for this note.");
    expect(h.radios()).toEqual([]); expect(h.checkboxes()).toEqual([]); expect(h.selects()).toEqual([]);
    expect(h.session.getDraft(0)).toBeUndefined(); expect(h.session.selectFolder(0, { kind: "keep-current" })).toBe(false);
    expect(h.session.selectTag(0, "#Ruby", true)).toBe(false); h.button("Next").click(); h.radios()[0].change();
    expect(h.button("Finish review").disabled).toBe(false); h.button("Finish review").click();
    expect(h.session.getResult()?.reviewed).toHaveLength(1); expect(h.session.getResult()?.unavailable[0].source).toBe(h.analysis.results[0].source);
    expect(h.session.getResult()?.unavailable[0].snapshot).toBe(h.analysis.results[0].snapshot);
  });
  it.each([0, 1, 3])("%s failed-only Notes cannot fabricate an empty successful review", count => {
    const h = harness(Array.from({ length: count }, (_, i) => analysisNote(`Inbox/${i}.md`, "failed")));
    expect(h.button("Finish review").disabled).toBe(true); h.button("Finish review").click();
    expect(h.session.finish()).toBeUndefined(); expect(h.session.getResult()).toBeUndefined();
  });
  it("Finish requires explicit Folder choice for every reviewable Note and guides remaining Notes", () => {
    const h = harness([analysisNote(), analysisNote("Inbox/B.md")]);
    expect(h.button("Finish review").disabled).toBe(true); h.button("Finish review").click(); expect(h.session.getResult()).toBeUndefined();
    h.radios()[0].change(); expect(h.button("Finish review").disabled).toBe(true); expect(h.texts()).toContain("Choose a Folder intent for Notes: 2.");
    h.button("Next").click(); h.radios()[1].change(); expect(h.button("Finish review").disabled).toBe(false);
  });
  it("only explicit Finish converts untouched Tags to selected([]), preserving explicit 0/N draft", () => {
    const h = harness([analysisNote(), analysisNote("Inbox/B.md"), analysisNote("Inbox/C.md")]);
    h.session.selectTag(1, "#Ruby", true); h.session.selectTag(1, "#Ruby", false); h.session.selectTag(2, "#manual", true);
    for (let index = 0; index < 3; index++) h.session.selectFolder(index, { kind: "keep-current" });
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "unreviewed" }); expect(h.session.getResult()).toBeUndefined();
    const reviewed = h.session.finish()!; expect(reviewed.reviewed.map(n => n.selectedTags)).toEqual([[], [], ["#manual"]]);
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: [] });
    expect(h.session.finish()).toBeUndefined(); expect(h.session.selectTag(0, "#Ruby", true)).toBe(false);
  });
  it("preserves exact source, snapshot and separate unchanged analysis; all owned result structures are immutable", () => {
    const h = harness(); const baseline = JSON.stringify(h.analysis);
    h.session.selectFolder(0, { kind: "existing-folder", path: "Manual" }); h.session.selectTag(0, "#ruby", true);
    const reviewed = h.session.finish()!, note = reviewed.reviewed[0];
    expect(note.source).toBe(h.analysis.results[0].source); expect(note.snapshot).toBe(h.analysis.results[0].snapshot); expect(note.analysis).toBe(h.analysis.results[0]);
    expect(note.folder).toEqual({ kind: "existing-folder", path: "Manual" }); expect(note.reviewStatus).toBe("reviewed");
    for (const value of [reviewed, reviewed.reviewed, reviewed.unavailable, note, note.folder, note.selectedTags]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => (note.selectedTags as string[]).push("#new")).toThrow(); expect(() => Object.assign(note.folder, { path: "New" })).toThrow();
    expect(JSON.stringify(h.analysis)).toBe(baseline); expect(Object.keys(note)).toEqual(["source", "snapshot", "analysis", "folder", "selectedTags", "reviewStatus"]);
    for (const key of ["body", "apiKey", "secret", "rawResponse", "confirmation", "applyToken", "apply", "selectedFolderPath"]) {
      expect(reviewed).not.toHaveProperty(key); expect(note).not.toHaveProperty(key); expect(note.analysis).not.toHaveProperty(key);
    }
  });
  it("terminal copy is Review complete with no Vault changes and no Apply button", () => {
    const h = harness(); h.radios()[0].change(); h.button("Finish review").click();
    expect(h.texts()).toContain("Review complete."); expect(h.texts()).toContain("No changes were made to your Vault.");
    expect(h.all().filter(e => e.tag === "button").map(e => e.text)).toEqual(["Close"]);
    expect(h.session.getResult()?.reviewed[0].folder).toEqual({ kind: "keep-current" });
  });
});

describe("Review lifecycle (#101 tests 80–84)", () => {
  it.each(["Cancel", "Escape", "X", "unload", "onClose"])("%s clears draft/result and kills old callbacks before Finish", action => {
    const h = harness(); const folder = h.radios()[1], tag = h.checkboxes()[0], finish = h.button("Finish review"), next = h.button("Next");
    h.radios()[0].change();
    if (action === "Cancel") h.button("Cancel").click(); else if (action === "Escape") (h.modal as unknown as Modal).scope.press("Escape");
    else if (action === "unload") h.owner.abort(); else if (action === "onClose") h.modal.onClose(); else h.modal.close();
    folder.change(); tag.change(); finish.click(); next.click(); h.modal.onOpen();
    expect(h.texts()).toEqual([]); expect(h.session.getAnalysisResult()).toBeUndefined(); expect(h.session.getDraft(0)).toBeUndefined();
    expect(h.session.getResult()).toBeUndefined(); expect(h.session.canFinish()).toBe(false);
  });
  it.each(["Close", "unload"])("%s after Finish clears owned result without changing an externally retained immutable result", action => {
    const h = harness(); h.radios()[0].change(); h.button("Finish review").click(); const reviewed = h.session.getResult()!;
    if (action === "unload") h.owner.abort(); else h.button("Close").click();
    expect(h.session.getResult()).toBeUndefined(); expect(reviewed.reviewed[0].folder.kind).toBe("keep-current");
  });
  it("invalidates immediately even when Obsidian delays onClose", () => {
    const h = harness(); const keep = h.radios()[0], tag = h.checkboxes()[0];
    vi.spyOn(Modal.prototype, "close").mockImplementation(() => {}); h.modal.close(); keep.change(); tag.change();
    expect(h.session.getDraft(0)).toBeUndefined(); expect(h.session.finish()).toBeUndefined();
    h.modal.onClose(); expect(h.texts()).toEqual([]);
  });
  it("previous render handlers cannot alter another Note, return navigation, or completed result", () => {
    const h = harness([analysisNote(), analysisNote("Inbox/B.md")]); const keep = h.radios()[0], tag = h.checkboxes()[0], next = h.button("Next");
    next.click(); keep.change(); tag.change(); next.click(); expect(h.texts()).toContain("Note 2 / 2");
    expect(h.session.getDraft(0)?.folder.kind).toBe("unreviewed"); expect(h.session.getDraft(1)?.tags.kind).toBe("unreviewed");
    h.radios()[0].change(); h.button("Previous").click(); keep.change(); expect(h.session.getDraft(0)?.folder.kind).toBe("unreviewed");
  });
  it("an already-aborted owner opens no UI and retains no authority", () => {
    const h = harness(); h.owner.abort(); h.modal.open(); expect(h.texts()).toEqual([]); expect(h.session.getAnalysisResult()).toBeUndefined();
  });
});

describe("Review documentation (#101 tests 85–87)", () => {
  it.each(["README.md", "PRIVACY.md", "SECURITY.md"])("%s describes local Review, no body/Secret/provider work and no Apply authority", path => {
    const doc = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    expect(doc).toContain("Review results"); expect(doc).toContain("Finish review"); expect(doc).toContain("Confirm Apply");
    expect(doc).toMatch(/Secret/); expect(doc).toMatch(/body/); expect(doc).toMatch(/TypeSafe/);
    expect(doc).toMatch(/mutation authority|modify your Vault/);
  });
});

describe("Review section number shortcuts (#139)", () => {
  it("shows section focus instructions and stable numbers including unavailable positions", () => {
    const h = harness();
    const labels = (kind: "folder" | "tags") => h.section(kind).all().filter(e => e.tag === "label")
      .map(e => e.children.filter(c => c.tag === "span").map(c => c.text).join(""));
    expect(labels("folder").slice(0, 4)).toEqual([
      "[1] Keep current folder", "[2] Dest — 99.0%", "[3] Other — 1.0%", "[4] Stale — 0.0% — unavailable",
    ]);
    expect(labels("tags").slice(0, 3)).toEqual([
      "[1] #Ruby — 99.0%", "[2] #nested/tag — 80.0%", "[3] #Stale — 10.0% — unavailable",
    ]);
    for (const kind of ["folder", "tags"] as const) {
      const section = h.section(kind);
      expect(section.attr?.tabindex).toBe("0");
      expect(section.all().find(e => (e as ReviewElement).attr?.id === section.attr?.["aria-describedby"])?.text)
        .toContain(kind === "folder" ? "press 1–9 to select" : "press 1–9 to toggle");
    }
    expect(h.session.getDraft(0)).toEqual({ folder: { kind: "unreviewed" }, tags: { kind: "unreviewed" } });
  });
  it.each([["1", { kind: "keep-current" }], ["2", { kind: "existing-folder", path: "Dest" }],
    ["3", { kind: "existing-folder", path: "Other" }]] as const)("Folder %s matches mouse through the same selection boundary", (key, intent) => {
    const keyboard = harness(), mouse = harness();
    const select = vi.spyOn(keyboard.session, "selectFolder");
    keyboard.section("folder").focus(); expect(keyboard.scope.press(key)).toBe(false);
    mouse.radios()[Number(key) - 1].change();
    expect(select).toHaveBeenCalledExactlyOnceWith(0, intent);
    expect(keyboard.session.getDraft(0)).toEqual(mouse.session.getDraft(0));
    expect(keyboard.radios().filter(r => r.checked)).toHaveLength(1);
    expect(keyboard.section("folder").ownerDocument.activeElement).toBe(keyboard.section("folder"));
    expect(keyboard.session.getResult()).toBeUndefined();
  });
  it("toggles exact Tags in sequence, preserving multiple selections and matching checkbox drafts", () => {
    const note = analysisNote();
    if (note.tags.status !== "success") throw new Error("Synthetic fixture");
    const notes = [{ ...note, tags: { ...note.tags, value: { ...note.tags.value, suggestions: [
      ...note.tags.value.suggestions.slice(0, 2), { tagId: "4", tagName: "#manual", choice: "match" as const, matchProbability: 0.5 },
    ] } } }];
    const keyboard = harness(notes), mouse = harness(notes);
    const select = vi.spyOn(keyboard.session, "selectTag");
    keyboard.section("tags").focus();
    for (const [key, checked, names] of [["1", true, ["#Ruby"]], ["3", true, ["#Ruby", "#manual"]],
      ["1", false, ["#manual"]], ["3", false, []]] as const) {
      expect(keyboard.scope.press(key)).toBe(false); mouse.checkboxes()[Number(key) - 1].change(checked);
      expect(keyboard.session.getDraft(0)?.tags).toEqual({ kind: "selected", names });
      expect(keyboard.session.getDraft(0)).toEqual(mouse.session.getDraft(0));
      expect(keyboard.checkboxes().map(c => c.checked)).toEqual(mouse.checkboxes().map(c => c.checked));
      expect(keyboard.section("tags").ownerDocument.activeElement).toBe(keyboard.section("tags"));
    }
    expect(select.mock.calls).toEqual([[0, "#Ruby", true], [0, "#manual", true], [0, "#Ruby", false], [0, "#manual", false]]);
    expect(keyboard.session.getDraft(0)?.folder.kind).toBe("unreviewed");
    expect(keyboard.session.getResult()).toBeUndefined();
  });
  it("uses the selected exact spelling and existing identity rules after mouse/select changes", () => {
    const h = harness(); h.selects()[1].change("#ruby"); h.section("tags").focus(); h.scope.press("1");
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: [] });
    h.scope.press("1"); expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: ["#Ruby"] });
    h.checkboxes()[0].change(false); h.section("tags").focus(); h.scope.press("1");
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: ["#Ruby"] });
  });
  it("never routes the same key to both sections, or routes from outside section focus", () => {
    const h = harness(), folder = vi.spyOn(h.session, "selectFolder"), tag = vi.spyOn(h.session, "selectTag");
    expect(h.scope.press("1")).toBeUndefined();
    h.button("Finish review").focus(); expect(h.scope.press("1")).toBeUndefined();
    expect(folder).not.toHaveBeenCalled(); expect(tag).not.toHaveBeenCalled();
    h.section("folder").focus(); h.scope.press("1");
    expect(folder).toHaveBeenCalledOnce(); expect(tag).not.toHaveBeenCalled();
    h.section("tags").focus(); expect(h.scope.press("4")).toBeUndefined();
    expect(folder).toHaveBeenCalledOnce(); expect(tag).not.toHaveBeenCalled();
    h.section("tags").focus(); h.scope.press("1");
    expect(folder).toHaveBeenCalledOnce(); expect(tag).toHaveBeenCalledOnce();
    expect(h.session.getDraft(0)).toEqual({ folder: { kind: "keep-current" }, tags: { kind: "selected", names: ["#Ruby"] } });
  });
  it.each(["folder", "tags"] as const)("unavailable %s consumes no key and never retargets to an available choice", kind => {
    const h = harness(); h.section(kind).focus();
    const baseline = h.session.getDraft(0);
    const folder = vi.spyOn(h.session, "selectFolder"), tag = vi.spyOn(h.session, "selectTag");
    expect(h.scope.press(kind === "folder" ? "4" : "3")).toBeUndefined();
    expect(h.session.getDraft(0)).toBe(baseline); expect(folder).not.toHaveBeenCalled(); expect(tag).not.toHaveBeenCalled();
  });
  it.each(["altKey", "ctrlKey", "metaKey", "shiftKey", "repeat", "isComposing"])("rejects %s for both sections without consuming the key", flag => {
    const h = harness(), baseline = h.session.getDraft(0);
    for (const kind of ["folder", "tags"] as const) {
      h.section(kind).focus(); expect(h.scope.press("1", { [flag]: true })).toBeUndefined();
      expect(h.session.getDraft(0)).toBe(baseline);
    }
  });
  it.each(["input", "textarea", "select", "contenteditable", "textbox"])("does not interfere with %s editing in either section", kind => {
    const h = harness(), baseline = h.session.getDraft(0);
    for (const section of ["folder", "tags"] as const) {
      const input = h.section(section).createEl(kind === "contenteditable" || kind === "textbox" ? "div" : kind);
      input.editable = true; input.focus(); expect(h.scope.press("1")).toBeUndefined();
      // contenteditableはsection自身/祖先から継承する場合も拒否する。
      h.section(section).editable = true; h.section(section).focus(); expect(h.scope.press("1")).toBeUndefined();
      expect(h.session.getDraft(0)).toBe(baseline);
    }
  });
  it("ignores numbers on a focused radio or checkbox as well as dropdowns", () => {
    const h = harness(), baseline = h.session.getDraft(0);
    for (const control of [...h.radios(), ...h.checkboxes(), ...h.selects()]) {
      control.focus(); expect(h.scope.press("1")).toBeUndefined(); expect(h.session.getDraft(0)).toBe(baseline);
    }
  });
  it("ignores repeat after a real toggle instead of turning the Tag back off", () => {
    const h = harness(); h.section("tags").focus(); h.scope.press("1"); h.scope.press("1", { repeat: true });
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: ["#Ruby"] });
  });
  it.each(["0", "5", "9", "Enter", "a"])("ignores unmapped key %s without consuming it", key => {
    const h = harness(), baseline = h.session.getDraft(0);
    for (const kind of ["folder", "tags"] as const) {
      h.section(kind).focus(); expect(h.scope.press(key)).toBeUndefined(); expect(h.session.getDraft(0)).toBe(baseline);
    }
    expect(h.session.getResult()).toBeUndefined();
  });
  it("scopes shortcuts to the active Modal, including before open and while covered", () => {
    const h = harness(), baseline = h.session.getDraft(0);
    h.scope.active = false;
    for (const kind of ["folder", "tags"] as const) {
      h.section(kind).focus(); h.scope.press("1"); expect(h.session.getDraft(0)).toBe(baseline);
    }
    const unopened = new OrganizationReviewModal({} as App, h.session, h.owner.signal);
    (unopened as unknown as Modal).scope.press("1"); expect(h.session.getDraft(0)).toBe(baseline);
    h.scope.active = true; h.section("folder").focus(); h.scope.press("1");
    expect(h.session.getDraft(0)?.folder.kind).toBe("keep-current");
  });
  it("rejects saved shortcut callbacks after rerender, Next, Previous and Finish", () => {
    const h = harness([analysisNote(), analysisNote("Inbox/B.md")]);
    const oldSection = h.section("folder"), old = h.scope.handlers.get("1")!;
    h.section("folder").focus(); h.scope.press("2");
    h.section("tags").focus(); expect(old({ key: "1" } as KeyboardEvent)).toBeUndefined();
    expect(h.session.getDraft(0)?.tags.kind).toBe("unreviewed");
    const beforeNext = h.scope.handlers.get("1")!;
    h.button("Next").click(); h.section("folder").focus(); beforeNext({ key: "1" } as KeyboardEvent);
    expect(h.session.getDraft(1)?.folder.kind).toBe("unreviewed");
    oldSection.focus(); h.scope.press("1"); expect(h.session.getDraft(1)?.folder.kind).toBe("unreviewed");
    h.section("folder").focus(); h.scope.press("1"); const beforePrevious = h.scope.handlers.get("2")!;
    h.button("Previous").click(); h.section("tags").focus(); beforePrevious({ key: "2" } as KeyboardEvent);
    expect(h.session.getDraft(0)?.tags.kind).toBe("unreviewed");
    h.scope.press("2"); expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: ["#nested/tag"] });
    const beforeFinish = h.scope.handlers.get("1")!;
    h.button("Finish review").click(); const completed = h.session.getResult();
    expect(h.scope.handlers.size).toBe(1); expect(h.scope.handlers.has("Escape")).toBe(true);
    beforeFinish({ key: "1" } as KeyboardEvent); h.scope.press("1");
    expect(h.session.getResult()).toBe(completed);
  });
  it.each(["close", "onClose", "unload", "delayed-close", "session-dispose"])("rejects keys and saved callbacks after %s", action => {
    const h = harness(); h.section("tags").focus(); const old = h.scope.handlers.get("1")!;
    if (action === "delayed-close") vi.spyOn(Modal.prototype, "close").mockImplementation(() => {});
    if (action === "session-dispose") h.session.dispose();
    else if (action === "onClose") h.modal.onClose(); else if (action === "unload") h.owner.abort(); else h.modal.close();
    expect(() => old({ key: "1" } as KeyboardEvent)).not.toThrow(); h.scope.press("1");
    expect(h.session.getDraft(0)).toBeUndefined(); expect(h.session.getResult()).toBeUndefined();
    if (action !== "session-dispose") expect(h.scope.handlers.size).toBe(1);
  });
  it("keeps numbers in order through nine and leaves further candidates and dropdowns usable", () => {
    const base = analysisNote();
    if (base.folder.status !== "success" || base.tags.status !== "success") throw new Error("Synthetic fixture");
    const folders = Array.from({ length: 11 }, (_, i) => `Folder${i + 1}`);
    const tags = Array.from({ length: 11 }, (_, i) => `#tag${i + 1}`);
    const note = { ...base, folder: { ...base.folder, value: { ...base.folder.value,
      result: { candidates: folders.map(path => ({ path, probability: 0.1 })) } } },
    tags: { ...base.tags, value: { ...base.tags.value,
      suggestions: tags.map((tagName, i) => ({ tagId: String(i), tagName, choice: "match" as const, matchProbability: 0.1 })) } } };
    const h = harness([note], undefined, { folders, tags });
    expect(h.radios()).toHaveLength(12); expect(h.checkboxes()).toHaveLength(11);
    for (const kind of ["folder", "tags"] as const) {
      expect(h.section(kind).all().filter(e => /^\[\d\] /.test(e.text)).map(e => e.text))
        .toEqual(Array.from({ length: 9 }, (_, i) => `[${i + 1}] `));
    }
    h.section("folder").focus(); h.scope.press("9");
    expect(h.session.getDraft(0)?.folder).toEqual({ kind: "existing-folder", path: "Folder8" });
    h.section("tags").focus(); h.scope.press("9");
    expect(h.session.getDraft(0)?.tags).toEqual({ kind: "selected", names: ["#tag9"] });
    h.radios()[11].change(); h.checkboxes()[10].change();
    h.selects()[0].change("Folder10"); h.selects()[1].change("#tag10");
    expect(h.session.getDraft(0)).toEqual({ folder: { kind: "existing-folder", path: "Folder10" },
      tags: { kind: "selected", names: ["#tag9", "#tag11", "#tag10"] } });
    expect(h.scope.handlers.size).toBe(10); expect(h.scope.handlers.has("0")).toBe(false);
  });
  it("creates no shortcut controls for an unavailable Note and no stale mapping from the previous Note", () => {
    const h = harness([analysisNote(), analysisNote("Inbox/Failed.md", "failed")]);
    const stale = h.scope.handlers.get("1")!; h.button("Next").click(); stale({ key: "1" } as KeyboardEvent);
    expect(h.scope.handlers.size).toBe(1); expect(h.session.getDraft(1)).toBeUndefined();
    expect(h.session.getDraft(0)?.folder.kind).toBe("unreviewed");
  });
});
