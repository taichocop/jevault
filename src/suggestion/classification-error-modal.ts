import { App, Modal } from "obsidian";

import { ClassificationCancelledError } from "../classification/classification-cancellation";
import { createErrorPresentation, type ErrorPresentation } from "./error-presentation";

export type RetryResult =
  | { status: "success" }
  | { status: "failure"; presentation: ErrorPresentation }
  | { status: "ignored" };

/** 安全なerror presentationと明示的Retryだけを扱う、Vault操作を持たないModal。 */
export class ClassificationErrorModal extends Modal {
  private retryInFlight = false;
  private lifetime: AbortController | undefined;
  private readonly closeFromOwner = (): void => this.close();

  constructor(
    app: App,
    private presentation: ErrorPresentation,
    private readonly retry:
      | ((signal?: AbortSignal) => Promise<RetryResult>)
      | undefined,
    private readonly ownerSignal?: AbortSignal,
    private readonly mapError: (error: unknown) => ErrorPresentation = createErrorPresentation,
  ) {
    super(app);
  }

  onOpen(): void {
    // 同じModalを開き直しても、前のRetry完了が新しい表示へ干渉しない。
    this.lifetime?.abort();
    this.lifetime = new AbortController();
    this.retryInFlight = false;
    if (this.ownerSignal?.aborted) {
      this.close();
      return;
    }
    this.ownerSignal?.addEventListener("abort", this.closeFromOwner, { once: true });
    this.render();
  }

  onClose(): void {
    this.lifetime?.abort();
    this.ownerSignal?.removeEventListener("abort", this.closeFromOwner);
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Jevault" });
    for (const line of this.presentation.message.split("\n")) {
      contentEl.createEl("p", { text: line });
    }

    if (this.presentation.retryable && this.retry !== undefined) {
      const retryButton = contentEl.createEl("button", { text: "Retry" });
      retryButton.disabled = this.retryInFlight;
      retryButton.addEventListener("click", () => {
        void this.retryClassification(retryButton);
      });
    }

    const closeButton = contentEl.createEl("button", { text: "Close" });
    closeButton.addEventListener("click", () => this.close());
  }

  private async retryClassification(retryButton: HTMLButtonElement): Promise<void> {
    const lifetime = this.lifetime;
    if (
      this.retryInFlight ||
      this.retry === undefined ||
      lifetime === undefined ||
      lifetime.signal.aborted
    ) {
      return;
    }

    this.retryInFlight = true;
    retryButton.disabled = true;
    try {
      const result = await this.retry(lifetime.signal);
      if (lifetime.signal.aborted) {
        return;
      }
      if (result.status === "success") {
        this.close();
        return;
      }
      if (result.status === "failure") {
        // 最新の失敗へ差し替え、入力側エラーへ変化した場合はRetryを表示しない。
        this.presentation = result.presentation;
      }
    } catch (error) {
      if (!lifetime.signal.aborted && !(error instanceof ClassificationCancelledError)) {
        this.presentation = this.mapError(error);
      }
    } finally {
      // Close・unload・開き直し後は、古い処理のfinallyでもDOMを書き換えない。
      if (!lifetime.signal.aborted) {
        this.retryInFlight = false;
        this.render();
      }
    }
  }
}
