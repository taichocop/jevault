import { OrganizationApplyConfirmationSession } from "./organization-apply-confirmation";
import type { OrganizationApplyService } from "./organization-apply-service";
import { organizationApplyProgress, type OrganizationApplyProgress, type OrganizationApplyResult } from "./organization-apply-result";
import type { OrganizationReviewResult, OrganizationReviewSession } from "./organization-review-session";

export interface OrganizationApplyPresentation {
  readonly review?: OrganizationReviewResult;
  readonly phase: "confirming" | "running" | "settled";
  readonly stopRequested: boolean;
  readonly progress: OrganizationApplyProgress;
  readonly result?: OrganizationApplyResult;
  readonly unavailableConfirmation: boolean;
}
interface ApplyView {
  render(presentation: OrganizationApplyPresentation): void;
  close(): void;
}

/** Reviewから移譲された唯一のowner。UI切断と認可破棄をAPI settlementで分離する。 */
export class OrganizationApplyFlow {
  private readonly confirmation: OrganizationApplyConfirmationSession;
  private readonly review?: OrganizationReviewResult;
  private readonly operation = new AbortController();
  private phase: OrganizationApplyPresentation["phase"] = "confirming";
  private progress: OrganizationApplyProgress;
  private result?: OrganizationApplyResult;
  private unavailableConfirmation = false;
  private view?: ApplyView;
  private attached = false;
  private detached = false;
  private disposed = false;
  private readonly closeFromOwner = (): void => {
    const view = this.view;
    this.detach();
    view?.close();
  };

  constructor(vault: object, private readonly owner: OrganizationReviewSession,
    private readonly service: Pick<OrganizationApplyService, "apply">, private readonly ownerSignal: AbortSignal) {
    this.review = owner.getResult();
    this.confirmation = new OrganizationApplyConfirmationSession(vault, owner);
    this.progress = organizationApplyProgress(this.review?.reviewed.length ?? 0, []);
  }

  attach(view: ApplyView): boolean {
    if (this.attached || this.detached || this.ownerSignal.aborted) { this.detach(); return false; }
    this.attached = true;
    this.view = view;
    this.ownerSignal.addEventListener("abort", this.closeFromOwner, { once: true });
    this.publish();
    return true;
  }

  private publish(): void {
    if (this.detached || this.ownerSignal.aborted) return;
    const view = this.view;
    try {
      view?.render(Object.freeze({ review: this.review, phase: this.phase,
        stopRequested: this.operation.signal.aborted, progress: this.progress, result: this.result,
        unavailableConfirmation: this.unavailableConfirmation }));
    } catch {
      // UI例外でもabortし、開始済みAPIのownerはsettlementまで破棄しない。
      this.detach();
      try { view?.close(); } catch { /* 切断済みUIの例外は認可や結果へ変換しない。 */ }
    }
  }

  async confirm(): Promise<void> {
    if (!this.view || this.detached || this.ownerSignal.aborted || this.phase !== "confirming") return;
    // awaitや描画の再入より先に一回だけ消費し、Enter/旧DOMの二重確認を拒否する。
    this.phase = "running";
    this.publish();
    try {
      const intent = this.confirmation.confirm();
      if (!intent) {
        this.unavailableConfirmation = true;
        return;
      }
      this.result = await this.service.apply(intent, this.operation.signal, progress => {
        this.progress = progress;
        this.publish();
      });
      this.progress = this.result.progress;
    } catch {
      // 契約外例外で変更なしとは断言しない。既知のprogress以外の結果も捏造しない。
      this.unavailableConfirmation = true;
    } finally {
      this.phase = "settled";
      this.cleanup();
      this.publish();
    }
  }

  stop(): void {
    if (!this.view || this.detached || this.phase !== "running" || this.operation.signal.aborted) return;
    this.operation.abort();
    this.publish();
  }

  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.view = undefined;
    this.ownerSignal.removeEventListener("abort", this.closeFromOwner);
    if (!this.operation.signal.aborted) this.operation.abort();
    if (this.phase !== "running") this.cleanup();
  }

  private cleanup(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.confirmation.dispose();
    this.owner.dispose();
  }
}
