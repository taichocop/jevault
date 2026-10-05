import { type App, Modal } from "obsidian";

import type { JevaultSettings } from "../settings";
import type { OrganizationScope } from "./organization-scope";
import type { TargetCollectionResult, TargetFileCollector } from "./target-file-collector";

function feedback(result: TargetCollectionResult): string | undefined {
  if (result.status === "cancelled") return undefined;
  if (result.status === "collected") {
    const count = result.targets.length;
    return count === 0 ? "No Markdown notes found in this scope."
      : `${count} Markdown ${count === 1 ? "note" : "notes"} found.`;
  }
  switch (result.reason) {
    case "scope-changed": return "The selected folder is no longer available. Open Folder Organizer again.";
    case "scope-excluded": return "This folder is excluded from Folder Organizer.";
    case "invalid-target": return "Jevault couldn't safely inspect this folder.";
  }
}

/** scope選択と一回の表示だけを担当し、走査・除外判定は既存collectorへ委譲する。 */
export class FolderOrganizerScopeModal extends Modal {
  private static nextScopeId = 0;
  private readonly scopeName = `jevault-organizer-scope-${FolderOrganizerScopeModal.nextScopeId++}`;
  private opened = false;
  private phase: "selecting" | "pending" | "finished" = "selecting";
  private selected: OrganizationScope;
  private readonly operation = new AbortController();
  private readonly closeFromOwner = (): void => this.close();
  private previewButton?: HTMLButtonElement;

  constructor(
    app: App,
    private readonly direct: OrganizationScope,
    private readonly recursive: OrganizationScope,
    private readonly collector: Pick<TargetFileCollector, "collect">,
    private readonly getSettings: () => Pick<JevaultSettings, "ignoredFolders">,
    private readonly ownerSignal: AbortSignal,
  ) {
    super(app);
    this.selected = direct;
    this.scope.register([], "Enter", event => {
      if (!this.active() || this.contentEl.ownerDocument.activeElement !== this.previewButton) return;
      if (!event.repeat && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) this.preview();
      return false;
    });
  }

  private active(): boolean {
    return this.opened && !this.operation.signal.aborted && !this.ownerSignal.aborted;
  }

  onOpen(): void {
    if (this.operation.signal.aborted || this.ownerSignal.aborted) {
      this.close();
      return;
    }
    this.opened = true;
    this.ownerSignal.addEventListener("abort", this.closeFromOwner, { once: true });
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "Organize notes in folder" });
    this.contentEl.createEl("p", { text: "Selected folder:" });
    this.contentEl.createEl("p", { text: this.direct.rootFolderPath });
    const scopes = this.contentEl.createEl("fieldset");
    scopes.createEl("legend", { text: "Scope:" });
    for (const [scope, text] of [[this.direct, "This folder only"], [this.recursive, "Include subfolders"]] as const) {
      const label = scopes.createEl("div").createEl("label");
      const radio = label.createEl("input", { type: "radio", attr: { name: this.scopeName } });
      radio.checked = scope === this.selected;
      radio.addEventListener("change", () => {
        if (this.active() && this.phase === "selecting" && radio.checked) this.selected = scope;
      });
      label.createEl("span", { text });
    }
    this.previewButton = this.contentEl.createEl("button", { text: "Preview notes", cls: "mod-cta" });
    this.previewButton.addEventListener("click", () => this.preview());
    this.addCloseButton("Cancel");
  }

  private preview(): void {
    if (!this.active() || this.phase !== "selecting") return;
    // 同期collectorのre-entrant callbackでも二回目を開始できないよう、先に消費する。
    this.phase = "pending";
    this.previewButton!.disabled = true;
    let result: TargetCollectionResult;
    try {
      const settings = this.getSettings();
      if (!this.active()) return;
      result = this.collector.collect(this.selected, { ignoredFolders: settings.ignoredFolders }, this.operation.signal);
    } catch {
      result = { status: "failure", reason: "invalid-target" };
    }
    this.phase = "finished";
    // 同期処理途中でclose/unloadが観測された場合も、結果表示を復活させない。
    if (!this.active()) return;
    if (result.status === "cancelled") {
      this.close();
      return;
    }
    this.contentEl.empty();
    this.previewButton = undefined;
    this.contentEl.createEl("p", { text: feedback(result), attr: { role: "status" } });
    this.addCloseButton("Close");
  }

  private addCloseButton(text: string): void {
    this.contentEl.createEl("button", { text }).addEventListener("click", () => {
      if (this.active()) this.close();
    });
  }

  close(): void {
    // mobileのclose animationがonCloseを遅延しても、旧handlerは即時に失効させる。
    this.opened = false;
    this.operation.abort();
    super.close();
  }

  onClose(): void {
    this.opened = false;
    this.operation.abort();
    this.ownerSignal.removeEventListener("abort", this.closeFromOwner);
    this.previewButton = undefined;
    this.contentEl.empty();
  }
}
