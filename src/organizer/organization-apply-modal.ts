import { type App, Modal } from "obsidian";
import { OrganizationApplyFlow, type OrganizationApplyPresentation } from "./organization-apply-flow";
import { applyOutcomes, applyReasons, movePhases, plannedCounts, tagPhases } from "./organization-apply-presentation";

/** 確認intentとservice truthだけを描画し、Vault/設定/認可を再構成しない。 */
export class OrganizationApplyModal extends Modal {
  private opened = false;
  private disposed = false;
  private generation = 0;
  private buttons: HTMLButtonElement[] = [];

  constructor(app: App, private readonly flow: OrganizationApplyFlow) {
    super(app);
    this.scope.register([], "Enter", event => {
      const focused = this.contentEl.ownerDocument.activeElement;
      if (!this.opened || this.disposed || !this.buttons.some(button => button === focused)) return;
      if (!event.repeat && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        (focused as HTMLButtonElement).click();
      }
      return false;
    });
  }
  onOpen(): void {
    if (this.disposed || this.opened) return;
    this.opened = true;
    if (!this.flow.attach({ render: presentation => this.render(presentation), close: () => this.close() })) this.close();
  }
  private render(presentation: OrganizationApplyPresentation): void {
    if (!this.opened || this.disposed) return;
    const generation = ++this.generation;
    // 取り外されたConfirm/Stop/Closeを、次phaseの操作へ転用させない。
    const button = (text: string, action: () => void, disabled = false) => {
      const element = this.contentEl.createEl("button", { text });
      this.buttons.push(element);
      element.disabled = disabled;
      element.addEventListener("click", () => {
        if (!this.opened || this.disposed || this.generation !== generation || element.disabled) return;
        action();
      });
    };
    for (const old of this.buttons) old.disabled = true;
    this.buttons = [];
    this.contentEl.empty();
    const { review, phase, progress, result } = presentation;
    this.contentEl.createEl("h2", { text: phase === "confirming" ? "Confirm organization Apply" : "Organization Apply" });
    if (phase === "confirming" && review) {
      const planned = plannedCounts(review);
      this.contentEl.createEl("p", { text: `Reviewed: ${review.reviewed.length}. Unavailable: ${review.unavailable.length} (excluded from Apply).` });
      this.contentEl.createEl("p", { text: `Planned moves: ${planned.moves}. Tag selections: ${planned.tags}.` });
      this.contentEl.createEl("p", { text: "These are reviewed intentions. Source freshness, folder eligibility and collisions will be checked again at Apply time." });
      this.contentEl.createEl("p", { text: "Tag + Move is not atomic. Partial success cannot be rolled back automatically." });
      for (const note of review.reviewed) {
        const item = this.contentEl.createEl("section");
        item.createEl("h3", { text: note.source.path });
        item.createEl("p", { text: `Folder: ${note.folder.kind === "keep-current" ? "Keep current folder" : note.folder.path}` });
        item.createEl("p", { text: `Tags: ${note.selectedTags.join(", ") || "None"}` });
      }
      button("Confirm Apply", () => { void this.flow.confirm(); }, review.reviewed.length === 0);
      button("Cancel", () => this.close());
    } else {
      const status = phase === "running" ? presentation.stopRequested ? "Stop requested. Waiting for in-flight work to settle." : "Applying reviewed changes..."
        : result?.status === "completed" ? "Apply completed. Individual notes may have failed or been skipped."
          : result?.status === "cancelled" ? "Apply cancelled. Already-started changes may have completed."
            : "Apply stopped. Confirmation or safety checks prevented continuation.";
      this.contentEl.createEl("p", { text: status, attr: { role: "status" } });
      this.contentEl.createEl("p", { text: `${progress.processed} / ${progress.total} processed. Failed: ${progress.failed}. Stale: ${progress.stale}.` });
      const indicator = this.contentEl.createEl("progress", { attr: { "aria-label": "Notes processed" } });
      indicator.max = progress.total || 1; indicator.value = progress.processed;
      if (phase === "running") {
        if (progress.currentPath) this.contentEl.createEl("p", { text: `Current: ${progress.currentPath}` });
        button("Stop", () => this.flow.stop(), presentation.stopRequested);
      }
      if (presentation.unavailableConfirmation) this.contentEl.createEl("p", { text: "Confirmation or Apply is unavailable. No further changes will start; any already-started operation cannot be rolled back automatically." });
      if (result?.reason) this.contentEl.createEl("p", { text: applyReasons[result.reason] });
      if (result && review) {
        const changed = result.results.filter(note => note.tag === "applied" || note.move === "applied").length;
        const partial = result.results.filter(note => note.outcome === "partial" || note.outcome === "cancelled-after-partial").length;
        this.contentEl.createEl("p", { text: `Notes with applied changes: ${changed}. Partial success: ${partial}. No terminal result: ${review.reviewed.length - result.results.length}.` });
        for (const note of [...result.results].sort((a, b) => a.index - b.index)) {
          const original = review.reviewed[note.index];
          if (!original) continue;
          const item = this.contentEl.createEl("section");
          item.createEl("h3", { text: original.source.path });
          item.createEl("p", { text: applyOutcomes[note.outcome] });
          item.createEl("p", { text: `Tags: ${tagPhases[note.tag]}. Move: ${movePhases[note.move]}.` });
          if (note.reason) item.createEl("p", { text: applyReasons[note.reason] });
        }
      }
      button("Close", () => this.close());
    }
    if (review) for (const note of review.unavailable) {
      this.contentEl.createEl("p", { text: `${note.source.path}: Analysis unavailable; excluded from Apply.` });
    }
  }
  private detach(): void {
    this.opened = false; this.disposed = true; this.generation++;
    for (const button of this.buttons) button.disabled = true;
    this.buttons = [];
    this.flow.detach();
  }
  close(): void { this.detach(); super.close(); }
  onClose(): void { this.detach(); this.contentEl.empty(); }
}
