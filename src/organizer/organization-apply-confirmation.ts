import { OrganizationReviewSession, type OrganizationReviewResult } from "./organization-review-session";

export interface ConfirmedOrganizationApplyIntent { readonly kind: "organization-apply-confirmation" }
interface ConfirmationRecord {
  readonly vault: object;
  readonly review: OrganizationReviewResult;
  readonly active: () => boolean;
  consumed: boolean;
}
// tokenのcopy/JSON再生成は認可しない。Reviewとselectionは外部入力から再構成しない。
const confirmations = new WeakMap<object, ConfirmationRecord>();

export class OrganizationApplyConfirmationSession {
  readonly #review?: OrganizationReviewResult;
  #disposed = false;
  constructor(private readonly vault: object, private readonly owner: OrganizationReviewSession) {
    this.#review = owner instanceof OrganizationReviewSession ? owner.getResult() : undefined;
  }
  /** 将来の明示的final user confirmation専用。本番Review/UIからは呼ばない。 */
  confirm(): ConfirmedOrganizationApplyIntent | undefined {
    const review = this.#review;
    if (!review || review.reviewed.length === 0 || this.#disposed || this.owner.getResult() !== review) return undefined;
    const intent = Object.freeze({ kind: "organization-apply-confirmation" as const });
    confirmations.set(intent, { vault: this.vault, review, consumed: false,
      active: () => !this.#disposed && this.owner.getResult() === review });
    return intent;
  }
  dispose(): void { this.#disposed = true; }
}

/** consume後も開始済みattemptの寿命を確認できるが、同tokenの再試行は許可しない。 */
export function isActiveOrganizationApplyIntent(intent: unknown, vault: object): boolean {
  if (typeof intent !== "object" || intent === null) return false;
  const record = confirmations.get(intent);
  return !!record && record.vault === vault && record.active();
}

/** 初期取消でもreviewed totalを正確に返すための非消費inspect。認可はconsumeだけが行う。 */
export function pendingOrganizationApplyReview(intent: unknown, vault: object): OrganizationReviewResult | undefined {
  if (!isActiveOrganizationApplyIntent(intent, vault)) return undefined;
  const record = confirmations.get(intent as object)!;
  return record.consumed ? undefined : record.review;
}

/** 受理前abortでは消費しない。受理後はbusy/失敗も含めone-shot。 */
export function consumeOrganizationApplyIntent(
  intent: unknown, vault: object, signal: AbortSignal,
): OrganizationReviewResult | undefined {
  if (signal.aborted || !isActiveOrganizationApplyIntent(intent, vault)) return undefined;
  const record = confirmations.get(intent as object)!;
  if (record.consumed) return undefined;
  record.consumed = true;
  return record.review;
}
