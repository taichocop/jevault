import { App, Modal } from "obsidian";

import { formatProbability } from "../suggestion/suggestion-view-model";
import type { ExistingTagSnapshot } from "./existing-tag-snapshot";
import type { TagSuggestionServiceResult } from "./tag-suggestion-service";
import type { TagApplyPreparedPresentation } from "./tag-apply-preparation";

/** 表示順とcanonical表記を維持する、mutation操作を持たないModal。 */
export class TagSuggestionModal extends Modal {
  private closed = false;
  private readonly closeFromOwner = (): void => this.close();

  constructor(
    app: App,
    private readonly outcome: TagSuggestionServiceResult,
    private readonly snapshot: ExistingTagSnapshot,
    private readonly ownerSignal: AbortSignal,
    private readonly preparation?: TagApplyPreparedPresentation,
  ) {
    super(app);
  }

  onOpen(): void {
    if (this.closed || this.ownerSignal.aborted) {
      this.close();
      return;
    }
    this.ownerSignal.addEventListener("abort", this.closeFromOwner, { once: true });
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: `Suggested tags for “${this.outcome.noteTitle}”` });
    if (this.snapshot.status === "unavailable") {
      this.contentEl.createEl("p", { text: "Existing tags on this note are unknown because metadata is unavailable." });
    }
    if (this.outcome.suggestions.length === 0) {
      this.contentEl.createEl("p", { text: "No matching tags were suggested for this note." });
    } else {
      const names = new Set(this.snapshot.status === "available" ? this.snapshot.names : []);
      const list = this.contentEl.createEl("ol");
      for (const suggestion of this.outcome.suggestions) {
        const annotation = names.has(suggestion.tagName) ? " — Already on note" : "";
        list.createEl("li", { text: `${suggestion.tagName} — ${formatProbability(suggestion.matchProbability)}${annotation}` });
      }
    }
    const close = this.contentEl.createEl("button", { text: "Close" });
    close.addEventListener("click", () => this.close());
  }

  onClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.ownerSignal.removeEventListener("abort", this.closeFromOwner);
    this.contentEl.empty();
    this.preparation?.dispose();
  }
}
