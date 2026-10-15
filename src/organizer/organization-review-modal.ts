import { type App, type KeymapEventHandler, Modal } from "obsidian";

import type { AnalysisPhaseResult } from "./organization-analysis-result";
import { OrganizationReviewSession, type OrganizationReviewResult, type ReviewedFolderIntent } from "./organization-review-session";

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
  private handedOff = false;
  private session?: OrganizationReviewSession;
  private completedResult?: OrganizationReviewResult;
  private index = 0;
  private generation = 0;
  private shortcuts: KeymapEventHandler[] = [];
  private readonly closeFromOwner = (): void => this.close();

  constructor(app: App, session: OrganizationReviewSession, private readonly ownerSignal: AbortSignal,
    private readonly openApply?: (session: OrganizationReviewSession) => void) {
    super(app);
    this.session = session;
  }

  private active(): boolean { return this.opened && !this.disposed && !this.ownerSignal.aborted && !!this.session; }
  onOpen(): void {
    if (this.disposed || this.ownerSignal.aborted) { this.close(); return; }
    this.opened = true;
    this.ownerSignal.addEventListener("abort", this.closeFromOwner, { once: true });
    this.render();
  }

  private clearShortcuts(): void {
    for (const handler of this.shortcuts) this.scope.unregister(handler);
    this.shortcuts = [];
  }

  private render(focusSection?: "folder" | "tags"): void {
    if (!this.active()) return;
    this.clearShortcuts();
    let shortcutFocus: HTMLElement | undefined;
    const generation = ++this.generation;
    const index = this.index;
    // detached DOMや前Noteの遅延イベントを新しいdraft操作へ変換しない。
    const editable = () => this.active() && this.generation === generation && !this.session!.getResult();
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Organization Review" });
    this.contentEl.createEl("p", { text: "Review selections only. Finish review makes no changes to your Vault." });
    this.completedResult = this.session!.getResult();
    if (this.completedResult) {
      this.contentEl.createEl("p", { text: "Review complete.", attr: { role: "status" } });
      this.contentEl.createEl("p", { text: "No changes were made to your Vault." });
      if (this.openApply && this.completedResult.reviewed.length > 0) {
        const apply = this.contentEl.createEl("button", { text: "Apply selected changes", cls: "mod-cta" });
        apply.addEventListener("click", () => {
          if (!this.active() || this.generation !== generation || !this.completedResult || this.session!.getResult() !== this.completedResult) return;
          apply.disabled = true;
          // close前に所有権を移譲し、元session/resultを確認からAPI settlementまで維持する。
          const owner = this.session!;
          this.handedOff = true;
          this.close();
          try { this.openApply!(owner); }
          catch { owner.dispose(); }
        });
      }
      this.closeButton("Close");
      return;
    }
    const notes = this.session!.getAnalysisResult()?.results ?? [];
    const noteCount = notes.length;
    const note = notes[index];
    if (note) {
      this.contentEl.createEl("p", { text: `Note ${index + 1} / ${notes.length}` });
      this.contentEl.createEl("p", { text: note.snapshot.path });
      const draft = this.session!.getDraft(index);
      if (!draft) this.contentEl.createEl("p", { text: "Analysis unavailable for this note." });
      else {
        // 修飾キーを要求せず、section自身のfocusでFolder/Tagの番号衝突を避ける。
        const folder = this.contentEl.createEl("fieldset", { cls: "jevault-review-shortcuts",
          attr: { tabindex: "0", "aria-describedby": `${this.folderGroup}-folder-help` } });
        folder.createEl("legend", { text: "Folder" });
        folder.createEl("p", { text: "Tab to this Folder section, then press 1–9 to select a numbered folder.",
          attr: { id: `${this.folderGroup}-folder-help` } });
        folder.createEl("p", { text: `Current folder: ${this.session!.getCurrentFolder(index) || "Vault root"}` });
        const folderShortcuts: Array<() => boolean> = [];
        let folderNumber = 0;
        const folderChoice = (text: string, intent: ReviewedFolderIntent, available = true) => {
          const number = ++folderNumber;
          const select = () => editable() && available && this.session!.selectFolder(index, intent);
          if (number <= 9) folderShortcuts.push(select);
          const label = folder.createEl("div").createEl("label");
          const radio = label.createEl("input", { type: "radio", attr: { name: this.folderGroup } });
          radio.disabled = !available;
          radio.checked = available && (intent.kind === "keep-current" ? draft.folder.kind === "keep-current"
            : draft.folder.kind === "existing-folder" && draft.folder.path === intent.path);
          if (number <= 9) label.createEl("span", { text: `[${number}] ` });
          label.createEl("span", { text: `${text}${available ? "" : " — unavailable"}` });
          radio.addEventListener("change", () => {
            if (radio.checked && select()) this.render();
          });
        };
        folderChoice("Keep current folder", { kind: "keep-current" });
        if (note.folder.status === "success") {
          if (note.folder.value.result.candidates.length === 0) folder.createEl("p", { text: "No Folder suggestions." });
          for (const candidate of note.folder.value.result.candidates) {
            folderChoice(`${candidate.path} — ${(candidate.probability * 100).toFixed(1)}%`,
              { kind: "existing-folder", path: candidate.path }, this.session!.isFolderAvailable(candidate.path));
          }
        } else folder.createEl("p", { text: phaseFeedback(note.folder, "Folder") });
        const folderLabel = folder.createEl("label", { text: "Choose another existing folder" });
        const folderSelect = folderLabel.createEl("select");
        folderSelect.createEl("option", { text: "Choose a folder...", value: "" });
        const alternatives = this.session!.getAlternateFolders(index);
        for (const path of alternatives) folderSelect.createEl("option", { text: path, value: path });
        folderSelect.value = draft.folder.kind === "existing-folder" && alternatives.includes(draft.folder.path) ? draft.folder.path : "";
        folderSelect.disabled = alternatives.length === 0;
        folderSelect.addEventListener("change", () => {
          if (editable() && alternatives.includes(folderSelect.value) &&
            this.session!.selectFolder(index, { kind: "existing-folder", path: folderSelect.value })) this.render();
        });
        folder.createEl("p", { text: draft.folder.kind === "unreviewed" ? "Choose a Folder intent for this note."
          : draft.folder.kind === "keep-current" ? "Selected: Keep current folder" : `Selected: ${draft.folder.path}` });

        const tags = this.contentEl.createEl("fieldset", { cls: "jevault-review-shortcuts",
          attr: { tabindex: "0", "aria-describedby": `${this.folderGroup}-tags-help` } });
        tags.createEl("legend", { text: "Tags" });
        tags.createEl("p", { text: "Tab to this Tags section, then press 1–9 to toggle numbered tags. Multiple tags can be selected.",
          attr: { id: `${this.folderGroup}-tags-help` } });
        const current = this.session!.getCurrentTags(index);
        tags.createEl("p", { text: current?.status === "available"
          ? `Current tags (advisory): ${current.names.join(", ") || "None"}` : "Current tags are unknown (metadata unavailable)." });
        const tagShortcuts: Array<() => boolean> = [];
        const tagChoice = (name: string, text: string, available: boolean, number?: number) => {
          const select = (checked: boolean) => editable() && available && this.session!.selectTag(index, name, checked);
          if (number !== undefined && number <= 9) {
            tagShortcuts.push(() => select(!this.session!.isTagSelected(index, name)));
          }
          const label = tags.createEl("div").createEl("label");
          const checkbox = label.createEl("input", { type: "checkbox" });
          checkbox.disabled = !available;
          checkbox.checked = available && this.session!.isTagSelected(index, name);
          if (number !== undefined && number <= 9) label.createEl("span", { text: `[${number}] ` });
          label.createEl("span", { text: `${text}${available ? "" : " — unavailable"}` });
          checkbox.addEventListener("change", () => {
            if (select(checkbox.checked)) this.render();
          });
        };
        const suggestions = note.tags.status === "success" ? note.tags.value.suggestions : [];
        if (note.tags.status === "success") {
          if (suggestions.length === 0) tags.createEl("p", { text: "No Tag suggestions." });
          suggestions.forEach((suggestion, i) => tagChoice(suggestion.tagName,
            `${suggestion.tagName} — ${(suggestion.matchProbability * 100).toFixed(1)}%`, this.session!.isTagAvailable(suggestion.tagName), i + 1));
        } else tags.createEl("p", { text: phaseFeedback(note.tags, "Tag") });
        // 追加候補の既存表記も維持する。現在Tagは表示だけで選択を捏造しない。
        const selected = draft.tags.kind === "selected" ? draft.tags.names : [];
        for (const name of selected.filter(name => !suggestions.some(suggestion => suggestion.tagName === name))) {
          tagChoice(name, name, true);
        }
        const tagLabel = tags.createEl("label", { text: "Add existing tag" });
        const tagSelect = tagLabel.createEl("select");
        tagSelect.createEl("option", { text: "Choose an existing tag...", value: "" });
        for (const name of this.session!.getExistingTags()) tagSelect.createEl("option", { text: name, value: name });
        tagSelect.value = "";
        tagSelect.disabled = this.session!.getExistingTags().length === 0;
        tagSelect.addEventListener("change", () => {
          if (editable() && this.session!.selectTag(index, tagSelect.value, true)) this.render();
        });
        tags.createEl("p", { text: `Selected tags: ${selected.join(", ") || "None"}` });
        // Scopeは最前面Modalだけで有効。対象は描画世代と実際のsection focusで固定する。
        for (let number = 1; number <= Math.max(folderShortcuts.length, tagShortcuts.length); number++) {
          this.shortcuts.push(this.scope.register([], String(number), event => {
            if (!editable() || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing) return;
            const active = this.contentEl.ownerDocument.activeElement;
            if (active?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
            const section = active === folder ? "folder" : active === tags ? "tags" : undefined;
            const select = section === "folder" ? folderShortcuts[number - 1] : section === "tags" ? tagShortcuts[number - 1] : undefined;
            if (!select?.()) return;
            this.render(section);
            return false;
          }));
        }
        shortcutFocus = focusSection === "folder" ? folder : focusSection === "tags" ? tags : undefined;
      }
    } else this.contentEl.createEl("p", { text: "No analysis notes are available for review." });
    const previous = this.contentEl.createEl("button", { text: "Previous" });
    previous.disabled = index === 0;
    previous.addEventListener("click", () => { if (editable() && index > 0) { this.index--; this.render(); } });
    const next = this.contentEl.createEl("button", { text: "Next" });
    next.disabled = index + 1 >= noteCount;
    next.addEventListener("click", () => { if (editable() && index + 1 < noteCount) { this.index++; this.render(); } });
    const remaining = this.session!.getUnreviewedFolderIndices();
    this.contentEl.createEl("p", { text: remaining.length > 0
      ? `Choose a Folder intent for Notes: ${remaining.map(index => index + 1).join(", ")}.`
      : this.session!.canFinish() ? "Ready to finish review. This changes no Vault data." : "No reviewable notes. Finish review is unavailable." });
    const finish = this.contentEl.createEl("button", { text: "Finish review", cls: "mod-cta" });
    finish.disabled = !this.session!.canFinish();
    finish.addEventListener("click", () => { if (editable() && this.session!.finish()) this.render(); });
    this.closeButton("Cancel");
    shortcutFocus?.focus();
  }

  private closeButton(text: string): void {
    this.contentEl.createEl("button", { text }).addEventListener("click", () => { if (this.active()) this.close(); });
  }
  private dispose(): void {
    if (this.disposed) return;
    this.opened = false;
    this.disposed = true;
    this.generation++;
    this.clearShortcuts();
    this.ownerSignal.removeEventListener("abort", this.closeFromOwner);
    // stale DOMはthisだけを保持し、handoff後の元session/resultを保持しない。
    const session = this.session;
    this.session = undefined;
    this.completedResult = undefined;
    if (!this.handedOff) session?.dispose();
  }
  close(): void { this.dispose(); super.close(); }
  onClose(): void { this.dispose(); this.contentEl.empty(); }
}
