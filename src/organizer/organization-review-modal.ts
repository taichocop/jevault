import { type App, Modal } from "obsidian";

import type { AnalysisPhaseResult } from "./organization-analysis-result";
import { OrganizationReviewSession, type ReviewedFolderIntent } from "./organization-review-session";

function phaseFeedback(phase: AnalysisPhaseResult<unknown>, category: string): string {
  return phase.status === "not-run" && phase.reason === "disabled"
    ? `${category} analysis was disabled.` : `${category} analysis is unavailable.`;
}

/** 描画とlifecycleだけを担当し、選択・Finish規則はsessionに委譲する。 */
export class OrganizationReviewModal extends Modal {
  private static nextId = 0;
  private readonly folderGroup = `jevault-review-folder-${OrganizationReviewModal.nextId++}`;
  private opened = false;
  private disposed = false;
  private index = 0;
  private generation = 0;
  private readonly closeFromOwner = (): void => this.close();

  constructor(app: App, private readonly session: OrganizationReviewSession, private readonly ownerSignal: AbortSignal) {
    super(app);
  }

  private active(): boolean { return this.opened && !this.disposed && !this.ownerSignal.aborted; }
  onOpen(): void {
    if (this.disposed || this.ownerSignal.aborted) { this.close(); return; }
    this.opened = true;
    this.ownerSignal.addEventListener("abort", this.closeFromOwner, { once: true });
    this.render();
  }

  private render(): void {
    if (!this.active()) return;
    const generation = ++this.generation;
    const index = this.index;
    // detached DOMや前Noteの遅延イベントを新しいdraft操作へ変換しない。
    const editable = () => this.active() && this.generation === generation && !this.session.getResult();
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Organization Review" });
    this.contentEl.createEl("p", { text: "Review selections only. No changes will be made to your Vault. Apply is unavailable." });
    if (this.session.getResult()) {
      this.contentEl.createEl("p", { text: "Review complete.", attr: { role: "status" } });
      this.contentEl.createEl("p", { text: "No changes were made to your Vault." });
      this.closeButton("Close");
      return;
    }
    const notes = this.session.getAnalysisResult()?.results ?? [];
    const note = notes[index];
    if (note) {
      this.contentEl.createEl("p", { text: `Note ${index + 1} / ${notes.length}` });
      this.contentEl.createEl("p", { text: note.snapshot.path });
      const draft = this.session.getDraft(index);
      if (!draft) this.contentEl.createEl("p", { text: "Analysis unavailable for this note." });
      else {
        const folder = this.contentEl.createEl("fieldset");
        folder.createEl("legend", { text: "Folder" });
        folder.createEl("p", { text: `Current folder: ${this.session.getCurrentFolder(index) || "Vault root"}` });
        const folderChoice = (text: string, intent: ReviewedFolderIntent, available = true) => {
          const label = folder.createEl("div").createEl("label");
          const radio = label.createEl("input", { type: "radio", attr: { name: this.folderGroup } });
          radio.disabled = !available;
          radio.checked = available && (intent.kind === "keep-current" ? draft.folder.kind === "keep-current"
            : draft.folder.kind === "existing-folder" && draft.folder.path === intent.path);
          label.createEl("span", { text: `${text}${available ? "" : " — unavailable"}` });
          radio.addEventListener("change", () => {
            if (editable() && available && radio.checked && this.session.selectFolder(index, intent)) this.render();
          });
        };
        folderChoice("Keep current folder", { kind: "keep-current" });
        if (note.folder.status === "success") {
          if (note.folder.value.result.candidates.length === 0) folder.createEl("p", { text: "No Folder suggestions." });
          for (const candidate of note.folder.value.result.candidates) {
            folderChoice(`${candidate.path} — ${(candidate.probability * 100).toFixed(1)}%`,
              { kind: "existing-folder", path: candidate.path }, this.session.isFolderAvailable(candidate.path));
          }
        } else folder.createEl("p", { text: phaseFeedback(note.folder, "Folder") });
        const folderLabel = folder.createEl("label", { text: "Choose another existing folder" });
        const folderSelect = folderLabel.createEl("select");
        folderSelect.createEl("option", { text: "Choose a folder...", value: "" });
        const alternatives = this.session.getAlternateFolders(index);
        for (const path of alternatives) folderSelect.createEl("option", { text: path, value: path });
        folderSelect.value = draft.folder.kind === "existing-folder" && alternatives.includes(draft.folder.path) ? draft.folder.path : "";
        folderSelect.disabled = alternatives.length === 0;
        folderSelect.addEventListener("change", () => {
          if (editable() && alternatives.includes(folderSelect.value) &&
            this.session.selectFolder(index, { kind: "existing-folder", path: folderSelect.value })) this.render();
        });
        folder.createEl("p", { text: draft.folder.kind === "unreviewed" ? "Choose a Folder intent for this note."
          : draft.folder.kind === "keep-current" ? "Selected: Keep current folder" : `Selected: ${draft.folder.path}` });

        const tags = this.contentEl.createEl("fieldset");
        tags.createEl("legend", { text: "Tags" });
        const current = this.session.getCurrentTags(index);
        tags.createEl("p", { text: current?.status === "available"
          ? `Current tags (advisory): ${current.names.join(", ") || "None"}` : "Current tags are unknown (metadata unavailable)." });
        const tagChoice = (name: string, text: string, available: boolean) => {
          const label = tags.createEl("div").createEl("label");
          const checkbox = label.createEl("input", { type: "checkbox" });
          checkbox.disabled = !available;
          checkbox.checked = available && this.session.isTagSelected(index, name);
          label.createEl("span", { text: `${text}${available ? "" : " — unavailable"}` });
          checkbox.addEventListener("change", () => {
            if (editable() && available && this.session.selectTag(index, name, checkbox.checked)) this.render();
          });
        };
        const suggestions = note.tags.status === "success" ? note.tags.value.suggestions : [];
        if (note.tags.status === "success") {
          if (suggestions.length === 0) tags.createEl("p", { text: "No Tag suggestions." });
          for (const suggestion of suggestions) tagChoice(suggestion.tagName,
            `${suggestion.tagName} — ${(suggestion.matchProbability * 100).toFixed(1)}%`, this.session.isTagAvailable(suggestion.tagName));
        } else tags.createEl("p", { text: phaseFeedback(note.tags, "Tag") });
        // 追加候補の既存表記も維持する。現在Tagは表示だけで選択を捏造しない。
        const selected = draft.tags.kind === "selected" ? draft.tags.names : [];
        for (const name of selected.filter(name => !suggestions.some(suggestion => suggestion.tagName === name))) {
          tagChoice(name, name, true);
        }
        const tagLabel = tags.createEl("label", { text: "Add existing tag" });
        const tagSelect = tagLabel.createEl("select");
        tagSelect.createEl("option", { text: "Choose an existing tag...", value: "" });
        for (const name of this.session.getExistingTags()) tagSelect.createEl("option", { text: name, value: name });
        tagSelect.value = "";
        tagSelect.disabled = this.session.getExistingTags().length === 0;
        tagSelect.addEventListener("change", () => {
          if (editable() && this.session.selectTag(index, tagSelect.value, true)) this.render();
        });
        tags.createEl("p", { text: `Selected tags: ${selected.join(", ") || "None"}` });
      }
    } else this.contentEl.createEl("p", { text: "No analysis notes are available for review." });
    const previous = this.contentEl.createEl("button", { text: "Previous" });
    previous.disabled = index === 0;
    previous.addEventListener("click", () => { if (editable() && index > 0) { this.index--; this.render(); } });
    const next = this.contentEl.createEl("button", { text: "Next" });
    next.disabled = index + 1 >= notes.length;
    next.addEventListener("click", () => { if (editable() && index + 1 < notes.length) { this.index++; this.render(); } });
    const remaining = this.session.getUnreviewedFolderIndices();
    this.contentEl.createEl("p", { text: remaining.length > 0
      ? `Choose a Folder intent for Notes: ${remaining.map(index => index + 1).join(", ")}.`
      : this.session.canFinish() ? "Ready to finish review. This changes no Vault data." : "No reviewable notes. Finish review is unavailable." });
    const finish = this.contentEl.createEl("button", { text: "Finish review", cls: "mod-cta" });
    finish.disabled = !this.session.canFinish();
    finish.addEventListener("click", () => { if (editable() && this.session.finish()) this.render(); });
    this.closeButton("Cancel");
  }

  private closeButton(text: string): void {
    this.contentEl.createEl("button", { text }).addEventListener("click", () => { if (this.active()) this.close(); });
  }
  private dispose(): void {
    this.opened = false;
    this.disposed = true;
    this.generation++;
    this.ownerSignal.removeEventListener("abort", this.closeFromOwner);
    this.session.dispose();
  }
  close(): void { this.dispose(); super.close(); }
  onClose(): void { this.dispose(); this.contentEl.empty(); }
}
