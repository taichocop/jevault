import { ClassificationCancelledError } from "../classification/classification-cancellation";
import type { TagSuggestionService, TagSuggestionServiceResult } from "./tag-suggestion-service";
import type { ExistingTagSnapshot, ExistingTagSnapshotProvider } from "./existing-tag-snapshot";
import type { RetryResult } from "../suggestion/classification-error-modal";
import {
  type ErrorPresentation,
} from "../suggestion/error-presentation";

import { createTagErrorPresentation } from "./tag-error-presentation";
import type { TagApplyPreparation, TagApplyPreparedPresentation } from "./tag-apply-preparation";

type TagSuggestionRunner = Pick<TagSuggestionService, "suggestForActiveNote">;

export interface LoadingHandle {
  hide(): void;
}

interface TagSuggestionCommandDependencies {
  tagSuggestionService: TagSuggestionRunner;
  existingTags: ExistingTagSnapshotProvider;
  getActiveNotePath: () => string | null;
  startPreparation: () => TagApplyPreparation;
  showLoading: () => LoadingHandle;
  showSuggestions: (outcome: TagSuggestionServiceResult, snapshot: ExistingTagSnapshot, ownerSignal: AbortSignal, preparation: TagApplyPreparedPresentation) => void;
  showError: (
    presentation: ErrorPresentation,
    retry: ((signal?: AbortSignal) => Promise<RetryResult>) | undefined,
    ownerSignal: AbortSignal,
  ) => void;
}

const NO_ACTIVE_NOTE_KEY = Symbol("no-active-note");

/** CommandとTagSuggestionServiceの間で、UI状態と多重実行だけを調停する。 */
export class TagSuggestionCommand {
  private readonly inFlight = new Map<string | symbol, AbortController>();
  private readonly operations = new Set<AbortController>();
  private readonly lifetime = new AbortController();
  private readonly preparations = new Set<TagApplyPreparedPresentation>();

  constructor(private readonly dependencies: TagSuggestionCommandDependencies) {}

  async execute(): Promise<void> {
    const result = await this.run();
    if (result.status !== "failure" || this.lifetime.signal.aborted) {
      return;
    }

    this.dependencies.showError(
      result.presentation,
      result.presentation.retryable ? (signal) => this.run(signal) : undefined,
      this.lifetime.signal,
    );
  }

  private async run(ownerSignal?: AbortSignal): Promise<RetryResult> {
    if (this.lifetime.signal.aborted || ownerSignal?.aborted) {
      return { status: "ignored" };
    }

    const requestKey =
      this.dependencies.getActiveNotePath() ?? NO_ACTIVE_NOTE_KEY;

    // 同じノートへの連打で外部requestを増やさず、別ノートの明示実行は妨げない。
    if (this.inFlight.has(requestKey)) {
      return { status: "ignored" };
    }

    const operation = new AbortController();
    this.inFlight.set(requestKey, operation);
    this.operations.add(operation);
    const loading = this.dependencies.showLoading();
    let preparation: TagApplyPreparedPresentation | undefined;
    let transferred = false;
    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      // cancel後の新しい実行を、古いpromiseのfinallyで解除しない。
      if (this.inFlight.get(requestKey) === operation) {
        this.inFlight.delete(requestKey);
      }
      this.operations.delete(operation);
      loading.hide();
    };
    const cancel = (): void => {
      preparation?.dispose();
      cleanup();
    };
    const abort = (): void => operation.abort();
    operation.signal.addEventListener("abort", cancel, { once: true });
    ownerSignal?.addEventListener("abort", abort, { once: true });

    try {
      // 評価中のchanged eventを取り逃さないよう、service開始前にtargetを固定する。
      const session = this.dependencies.startPreparation();
      let released = false;
      const presentation: TagApplyPreparedPresentation = {
        get applyPreparation() { return session.state; },
        dispose: () => {
          if (released) return;
          released = true;
          session.dispose();
          this.preparations.delete(presentation);
        },
      };
      preparation = presentation;
      this.preparations.add(presentation);
      if (operation.signal.aborted || this.lifetime.signal.aborted) {
        return { status: "ignored" };
      }
      // Vault走査やSecret解決をUIへ複製せず、Tag提案の唯一の入口を利用する。
      const outcome = await this.dependencies.tagSuggestionService.suggestForActiveNote(
        operation.signal,
      );
      if (operation.signal.aborted) {
        return { status: "ignored" };
      }
      session.prepare(outcome);
      transferred = this.showSuccessfulOutcome(outcome, preparation, operation.signal);
      return { status: "success" };
    } catch (error) {
      return operation.signal.aborted || error instanceof ClassificationCancelledError
        ? { status: "ignored" }
        : { status: "failure", presentation: createTagErrorPresentation(error) };
    } finally {
      ownerSignal?.removeEventListener("abort", abort);
      operation.signal.removeEventListener("abort", cancel);
      if (!transferred) preparation?.dispose();
      cleanup();
    }
  }

  dispose(): void {
    if (this.lifetime.signal.aborted) {
      return;
    }

    // unloadでModalと実処理を同時に止め、pending中のNoticeも直ちに閉じる。
    this.lifetime.abort();
    for (const operation of this.operations) {
      operation.abort();
    }
    for (const preparation of this.preparations) preparation.dispose();
  }

  private showSuccessfulOutcome(outcome: TagSuggestionServiceResult, preparation: TagApplyPreparedPresentation, signal: AbortSignal): boolean {
    if (outcome.status !== "success") {
      return false;
    }

    const snapshot = this.dependencies.existingTags.snapshot(outcome.source);
    // metadata取得境界でunloadされても、完了UIを復活させない。
    if (!this.lifetime.signal.aborted && !signal.aborted) {
      this.dependencies.showSuggestions(outcome, snapshot, this.lifetime.signal, preparation);
      return true;
    }
    return false;
  }
}
