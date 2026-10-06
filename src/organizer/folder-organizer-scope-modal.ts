import { type App, Modal } from "obsidian";

import type { JevaultSettings } from "../settings";
import type { OrganizationScope } from "./organization-scope";
import type { OrganizationTarget, TargetCollectionResult, TargetFileCollector } from "./target-file-collector";

import type { FolderOrganizerService } from "./folder-organizer-service";
import type { FolderOrganizerAnalysisResult, FolderOrganizerProgress, OrganizationAnalysisStopReason } from "./organization-analysis-result";

const stopFeedback: Record<OrganizationAnalysisStopReason, string> = {
  "missing-api-key": "A TypeSafe API key is required to analyze these notes.",
  "no-candidates": "Jevault couldn't continue because no eligible analysis candidates were available.",
  network: "A network error stopped the analysis.",
  "typesafe-api": "TypeSafe couldn't complete an analysis request.",
  "invalid-response": "TypeSafe returned an invalid response, so the analysis stopped.",
  "unexpected-error": "Jevault couldn't continue the analysis safely.",
};

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

/** UIと操作の寿命だけを所有し、収集・分析の意味論は既存serviceへ委譲する。 */
export class FolderOrganizerScopeModal extends Modal {
  private static nextScopeId = 0;
  private readonly scopeName = `jevault-organizer-scope-${FolderOrganizerScopeModal.nextScopeId++}`;
  private opened = false;
  private phase: "selecting" | "pending" | "previewed" | "analyzing" | "stopping" | "terminal" = "selecting";
  private selected: OrganizationScope;
  private readonly operation = new AbortController();
  private readonly closeFromOwner = (): void => this.close();
  private previewButton?: HTMLButtonElement;
  private analyzeButton?: HTMLButtonElement;
  private stopButton?: HTMLButtonElement;
  private previewTargets?: readonly OrganizationTarget[];
  private analysisController?: AbortController;
  private analysisResult?: FolderOrganizerAnalysisResult;
  private progress?: FolderOrganizerProgress;
  private progressStatus?: HTMLElement;
  private progressCounts?: HTMLElement;
  private progressPath?: HTMLElement;
  private progressFailed?: HTMLElement;
  private progressIndicator?: HTMLProgressElement;

  /** 将来のReviewへ渡すexact result。操作中のmemoryだけに保持し、選択権限は付与しない。 */
  getAnalysisResult(): FolderOrganizerAnalysisResult | undefined {
    return this.analysisResult;
  }

  constructor(
    app: App,
    private readonly direct: OrganizationScope,
    private readonly recursive: OrganizationScope,
    private readonly collector: Pick<TargetFileCollector, "collect">,
    private readonly getSettings: () => Pick<JevaultSettings, "ignoredFolders">,
    private readonly ownerSignal: AbortSignal,
    private readonly analysis: Pick<FolderOrganizerService, "analyze">,
  ) {
    super(app);
    this.selected = direct;
    this.scope.register([], "Enter", event => {
      const focused = this.contentEl.ownerDocument.activeElement;
      if (!this.active() || !focused || (focused !== this.previewButton && focused !== this.analyzeButton && focused !== this.stopButton)) return;
      if (!event.repeat && !event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (focused === this.previewButton) this.preview();
        else if (focused === this.analyzeButton) void this.analyze();
        else this.stop();
      }
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
    this.phase = "terminal";
    // 同期処理途中でclose/unloadが観測された場合も、結果表示を復活させない。
    if (!this.active()) return;
    if (result.status === "cancelled") {
      this.close();
      return;
    }
    this.contentEl.empty();
    this.previewButton = undefined;
    this.contentEl.createEl("p", { text: feedback(result), attr: { role: "status" } });
    if (result.status === "collected" && result.targets.length > 0) {
      // 再収集しない。Previewのexact配列・順序・identityを同じ操作のAnalyzeへ渡す。
      this.previewTargets = result.targets;
      this.phase = "previewed";
      this.contentEl.createEl("p", { text: `Selected folder: ${this.selected.rootFolderPath}` });
      this.contentEl.createEl("p", { text: `Scope: ${this.selected.includeSubfolders ? "Include subfolders" : "This folder only"}` });
      this.contentEl.createEl("p", { text: "Analysis: Folder suggestions + Tag suggestions" });
      this.contentEl.createEl("p", { text: "Analyzing these notes sends note titles, Vault-relative note paths, Markdown bodies, candidate folder paths, and existing Vault Tag candidates to TypeSafe and may use TypeSafe-managed credits." });
      this.contentEl.createEl("p", { text: "Folder then Tag analysis can make up to 2 TypeSafe requests per fully analyzed note. Failures or cancellation may produce fewer requests." });
      this.contentEl.createEl("p", { text: "No changes will be made to your Vault." });
      this.analyzeButton = this.contentEl.createEl("button", { text: "Analyze notes", cls: "mod-cta" });
      this.analyzeButton.addEventListener("click", () => { void this.analyze(); });
      this.addCloseButton("Cancel");
    } else this.addCloseButton("Close");
  }

  private async analyze(): Promise<void> {
    if (!this.active() || this.phase !== "previewed" || !this.previewTargets) return;
    // await前に消費し、double click・Enter・旧handlerからの重複実行を防ぐ。
    this.phase = "analyzing";
    this.analyzeButton!.disabled = true;
    this.analyzeButton = undefined;
    const controller = new AbortController();
    this.analysisController = controller;
    this.contentEl.empty();
    this.progressStatus = this.contentEl.createEl("p", { text: "Analyzing notes...", attr: { role: "status" } });
    this.progressCounts = this.contentEl.createEl("p");
    this.progressPath = this.contentEl.createEl("p");
    this.progressFailed = this.contentEl.createEl("p");
    this.progressIndicator = this.contentEl.createEl("progress", { attr: { "aria-label": "Notes processed" } });
    this.stopButton = this.contentEl.createEl("button", { text: "Stop" });
    this.stopButton.addEventListener("click", () => this.stop());
    this.addCloseButton("Close");
    try {
      const result = await this.analysis.analyze(this.previewTargets, controller.signal, progress => {
        if (!this.active() || this.analysisController !== controller || (this.phase !== "analyzing" && this.phase !== "stopping")) return;
        this.progress = progress;
        this.progressCounts!.setText(`${progress.processed} / ${progress.total} processed`);
        this.progressPath!.setText(`Current: ${progress.currentPath ?? "—"}`);
        this.progressFailed!.setText(`Failed: ${progress.failed}`);
        this.progressIndicator!.max = progress.total || 1;
        this.progressIndicator!.value = progress.processed;
      });
      if (!this.active() || this.analysisController !== controller) return;
      this.analysisResult = result;
      this.phase = "terminal";
      this.clearProgressUI();
      this.contentEl.empty();
      this.contentEl.createEl("p", { text: result.status === "completed" ? "Analysis complete." : "Analysis stopped.", attr: { role: "status" } });
      this.renderCounts(result.progress);
      if (result.status === "stopped") this.contentEl.createEl("p", { text: stopFeedback[result.reason] });
      if (result.status === "cancelled") this.contentEl.createEl("p", { text: "No further notes were analyzed." });
      this.contentEl.createEl("p", { text: "No changes were made to your Vault." });
      this.addCloseButton("Close");
    } catch {
      if (!this.active() || this.analysisController !== controller) return;
      // service契約外の例外もraw情報を表示せず、既存snapshot以上の結果を捏造しない。
      this.phase = "terminal";
      this.clearProgressUI();
      this.contentEl.empty();
      this.contentEl.createEl("p", { text: "Analysis stopped.", attr: { role: "status" } });
      if (this.progress) this.renderCounts(this.progress);
      this.contentEl.createEl("p", { text: stopFeedback["unexpected-error"] });
      this.contentEl.createEl("p", { text: "No changes were made to your Vault." });
      this.addCloseButton("Close");
    }
  }

  private renderCounts(progress: FolderOrganizerProgress): void {
    this.contentEl.createEl("p", { text: `${progress.processed} / ${progress.total} notes processed.` });
    this.contentEl.createEl("p", { text: `${progress.failed} failed.` });
  }

  private stop(): void {
    if (!this.active() || this.phase !== "analyzing") return;
    this.phase = "stopping";
    this.stopButton!.disabled = true;
    this.progressStatus!.setText("Stopping... No new note analysis will start.");
    // StopはModalの寿命を終えず、serviceが返すcancelled resultを待つ。
    this.analysisController!.abort();
  }

  private clearProgressUI(): void {
    this.stopButton = undefined;
    this.progressStatus = undefined;
    this.progressCounts = undefined;
    this.progressPath = undefined;
    this.progressFailed = undefined;
    this.progressIndicator = undefined;
  }

  private disposeOperation(): void {
    this.opened = false;
    this.operation.abort();
    this.analysisController?.abort();
    this.analysisController = undefined;
    this.previewTargets = undefined;
    this.analysisResult = undefined;
    this.progress = undefined;
    this.previewButton = undefined;
    this.analyzeButton = undefined;
    this.clearProgressUI();
    this.ownerSignal.removeEventListener("abort", this.closeFromOwner);
  }

  private addCloseButton(text: string): void {
    this.contentEl.createEl("button", { text }).addEventListener("click", () => {
      if (this.active()) this.close();
    });
  }

  close(): void {
    // mobileのclose animationがonCloseを遅延しても、旧handlerは即時に失効させる。
    this.disposeOperation();
    super.close();
  }

  onClose(): void {
    this.disposeOperation();
    this.contentEl.empty();
  }
}
