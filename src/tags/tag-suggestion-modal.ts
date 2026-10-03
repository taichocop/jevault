import { App, Modal } from "obsidian";

import { formatProbability } from "../suggestion/suggestion-view-model";
import type { ExistingTagSnapshot } from "./existing-tag-snapshot";
import type { TagSuggestionServiceResult } from "./tag-suggestion-service";
import type { TagApplyPreparedPresentation, TagApplyReadiness } from "./tag-apply-preparation";
import type { TagApplyResult, TagApplyService } from "./tag-apply-service";
import type { TagSuggestionFreshness } from "./tag-suggestion-freshness";

function readinessMessage(readiness: TagApplyReadiness): string | undefined {
  if (readiness.status === "confirmable") return undefined;
  switch (readiness.reason) {
    case "empty-selection": return undefined;
    case "session-closed": return "This Tag Suggest result is no longer active.";
    case "grant-unavailable": return "These suggestions are no longer available to apply.";
    case "source-changed": return "The original note is no longer available in the expected location.";
    case "invalid-selection": return "The selected tags are no longer valid.";
  }
}

function freshnessMessage(freshness: TagSuggestionFreshness): string | undefined {
  if (freshness === "changed") return "This note changed after these suggestions were generated. Review the selected tags before applying.";
  if (freshness === "unknown") return "Jevault couldn't determine whether this note changed after these suggestions were generated. Review the selected tags before applying.";
  return undefined;
}

function applyMessage(result: TagApplyResult): string | undefined {
  switch (result.status) {
    case "applied": return `Added ${result.addedTags.length} ${result.addedTags.length === 1 ? "tag" : "tags"}.`;
    case "no-change": return "No tags needed to be added.";
    case "cancelled": return undefined;
    case "failure":
      switch (result.reason) {
        case "busy": return "Tag changes are already being applied.";
        case "source-changed": return "The original note is no longer available in the expected location.";
        case "invalid-confirmation": return "This confirmation is no longer valid. Review the tags again.";
        case "invalid-selection": return "The selected tags are no longer valid.";
        default: return "Jevault could not add the selected tags.";
      }
  }
}

/** 選択・明示確認・表示だけを担当し、認可とmutation判定は既存coreへ委譲する。 */
export class TagSuggestionModal extends Modal {
  private closed = false;
  private pending = false;
  private confirming = false;
  private renderGeneration = 0;
  private readonly selected = new Set<number>();
  private operation?: AbortController;
  private addButton?: HTMLButtonElement;
  private readiness?: TagApplyReadiness;
  private feedback?: string;
  private completionMessage?: string;
  private readonly closeFromOwner = (): void => this.close();

  constructor(
    app: App,
    private readonly outcome: TagSuggestionServiceResult,
    private readonly snapshot: ExistingTagSnapshot,
    private readonly ownerSignal: AbortSignal,
    private readonly preparation?: TagApplyPreparedPresentation,
    private readonly applyService?: Pick<TagApplyService, "apply">,
    private readonly notify: (message: string) => void = () => undefined,
  ) {
    super(app);
    this.scope.register([], "Enter", (event) => {
      if (!this.isActive() || !this.confirming) return;
      // 長押し・IME・修飾入力を新しい確認とせず、Cancelのnative操作も維持する。
      if (this.pending || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      if (this.contentEl.ownerDocument.activeElement !== this.addButton) return;
      void this.applySelected();
      return false;
    });
  }

  onOpen(): void {
    if (!this.isActive()) {
      this.close();
      return;
    }
    this.ownerSignal.addEventListener("abort", this.closeFromOwner, { once: true });
    this.render();
  }

  private isActive(): boolean { return !this.closed && !this.completionMessage && !this.ownerSignal.aborted; }

  private selectedTags(): string[] {
    return this.outcome.suggestions.filter((_suggestion, index) => this.selected.has(index)).map(({ tagName }) => tagName);
  }

  private render(focusIndex?: number): void {
    if (!this.isActive()) return;
    const generation = ++this.renderGeneration;
    const current = (): boolean => this.isActive() && !this.pending && generation === this.renderGeneration;
    const selectedTags = this.selectedTags();
    // pending中のreadiness再評価で、開始済みintentのselection世代を変更しない。
    if (!this.pending) this.readiness = this.preparation?.getReadiness(selectedTags);
    if (!this.isActive()) return;
    if (!this.pending && this.readiness?.status !== "confirmable") this.confirming = false;
    this.contentEl.empty();
    this.addButton = undefined;
    if (this.confirming) {
      this.contentEl.createEl("h2", { text: "Add tags to:" });
      this.contentEl.createEl("p", { text: this.preparation?.suggestionGrant?.source.path ?? "" });
      this.contentEl.createEl("p", { text: "Tags:" });
      const list = this.contentEl.createEl("ul");
      for (const tag of selectedTags) list.createEl("li", { text: tag });
    } else {
      this.contentEl.createEl("h2", { text: `Suggested tags for “${this.outcome.noteTitle}”` });
      if (this.snapshot.status === "unavailable") {
        this.contentEl.createEl("p", { text: "Existing tags on this note are unknown because metadata is unavailable." });
      }
      if (this.outcome.suggestions.length === 0) {
        this.contentEl.createEl("p", { text: "No matching tags were suggested for this note." });
      } else {
        const names = new Set(this.snapshot.status === "available" ? this.snapshot.names : []);
        const list = this.contentEl.createEl("ol");
        this.outcome.suggestions.forEach((suggestion, index) => {
          const annotation = names.has(suggestion.tagName) ? " — Already on note" : "";
          const row = list.createEl("li");
          const label = row.createEl("label");
          if (this.preparation && this.applyService) {
            const checkbox = label.createEl("input", { type: "checkbox" });
            checkbox.checked = this.selected.has(index);
            checkbox.addEventListener("change", () => {
              if (!current()) return;
              if (checkbox.checked) this.selected.add(index);
              else this.selected.delete(index);
              this.feedback = undefined;
              this.render(index);
            });
            if (focusIndex === index) checkbox.focus();
          }
          label.createEl("span", { text: `${suggestion.tagName} — ${formatProbability(suggestion.matchProbability)}${annotation}` });
        });
      }
    }
    if (this.readiness && this.outcome.suggestions.length > 0) {
      const warning = freshnessMessage(this.readiness.freshness);
      if (warning) this.contentEl.createEl("p", { text: warning, attr: { role: "status" } });
      const blocked = readinessMessage(this.readiness);
      if (blocked) this.contentEl.createEl("p", { text: blocked, attr: { role: "status" } });
    }
    if (this.feedback) this.contentEl.createEl("p", { text: this.feedback, attr: { role: "status" } });
    if (this.preparation && this.applyService && this.outcome.suggestions.length > 0) {
      const action = this.contentEl.createEl("button", { text: this.confirming ? "Add tags" : "Apply selected tags", cls: "mod-cta" });
      action.disabled = this.pending || this.readiness?.status !== "confirmable";
      if (this.confirming) this.addButton = action;
      action.addEventListener("click", (event) => {
        // 前画面のdouble-clickを、再描画された最終確認への同意にしない。
        if (!current() || event.detail > 1 || action.disabled) return;
        if (this.confirming) void this.applySelected();
        else this.openConfirmation();
      });
    }
    const cancel = this.contentEl.createEl("button", { text: this.confirming ? "Cancel" : "Close" });
    cancel.addEventListener("click", () => {
      if (!this.isActive() || generation !== this.renderGeneration) return;
      this.close();
    });
  }

  private openConfirmation(): void {
    if (!this.isActive() || this.pending || !this.preparation) return;
    this.readiness = this.preparation.getReadiness(this.selectedTags());
    if (!this.isActive()) return;
    this.confirming = this.readiness.status === "confirmable";
    this.render();
    // 確認画面へのEnter連打を同意にしない。TabでAdd tagsへ移動してから確認できる。
  }

  private async applySelected(): Promise<void> {
    if (!this.isActive() || this.pending || !this.confirming || !this.preparation || !this.applyService) return;
    this.pending = true;
    const operation = new AbortController();
    this.operation = operation;
    let result: TagApplyResult | undefined;
    try {
      this.readiness = this.preparation.getReadiness(this.selectedTags());
      if (!this.isActive() || this.readiness.status !== "confirmable") return;
      this.render();
      // 最終user操作後だけcoreから取得し、copy・保存・retryせず一試行へそのまま渡す。
      const confirmation = this.preparation.confirm(this.selectedTags());
      if (!this.isActive() || operation.signal.aborted) return;
      if (!confirmation) {
        this.feedback = "This confirmation is no longer valid. Review the tags again.";
        return;
      }
      result = await this.applyService.apply({ confirmation }, operation.signal);
    } catch {
      result = { status: "failure", reason: "unexpected" };
    } finally {
      this.pending = false;
      this.operation = undefined;
      if (this.isActive()) {
        const message = result && applyMessage(result);
        if (result?.status === "applied" || result?.status === "no-change") {
          // mobileのclose animation中も旧操作を拒否し、通知はonCloseの解放後に限定する。
          this.completionMessage = message;
          this.close();
        } else {
          this.confirming = false;
          this.feedback = message ?? this.feedback;
          this.render();
          if (message && this.isActive()) this.notify(message);
        }
      } else this.preparation.dispose();
    }
  }

  onClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.ownerSignal.removeEventListener("abort", this.closeFromOwner);
    this.operation?.abort();
    this.contentEl.empty();
    // API内部のcallback待ちで確認権限を失効させず、実際の結果を完了させてから解放する。
    if (!this.pending) this.preparation?.dispose();
    const message = this.completionMessage;
    this.completionMessage = undefined;
    if (message && !this.ownerSignal.aborted) this.notify(message);
  }
}
