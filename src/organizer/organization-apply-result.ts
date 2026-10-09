export type OrganizationTagStatus = "not-selected" | "unchanged" | "applied" | "failed" |
  "not-started-cancelled" | "not-started-stale" | "not-started-prior-failure" |
  "interrupted-cancelled" | "interrupted-stale" | "interrupted-revoked";
export type OrganizationMoveStatus = "keep-current" | "unchanged" | "applied" | "failed" |
  "not-started-cancelled" | "not-started-stale" | "not-started-prior-failure";
export type OrganizationApplyReason = "busy" | "destination-missing" | "ineligible-destination" |
  "invalid-destination" | "collision" | "tag-failed" | "move-failed" | "stale" | "invalid-confirmation" | "invariant";
export type OrganizationApplyOutcome = "unchanged" | "updated-tags" | "moved" | "moved-and-tags" |
  "stale" | "partial" | "failed" | "cancelled" | "cancelled-after-partial";
export interface OrganizationNoteApplyResult {
  readonly index: number;
  readonly tag: OrganizationTagStatus;
  readonly move: OrganizationMoveStatus;
  readonly outcome: OrganizationApplyOutcome;
  readonly reason?: OrganizationApplyReason;
}
export interface OrganizationApplyProgress {
  readonly total: number;
  readonly processed: number;
  readonly failed: number;
  readonly stale: number;
  readonly currentPath?: string;
}
export interface OrganizationApplyResult {
  readonly status: "completed" | "cancelled" | "stopped";
  readonly reason?: "invalid-confirmation" | "invalid-input" | "invariant";
  readonly results: readonly OrganizationNoteApplyResult[];
  readonly progress: OrganizationApplyProgress;
}
export function organizationNoteResult(
  index: number, tag: OrganizationTagStatus, move: OrganizationMoveStatus, reason?: OrganizationApplyReason,
): OrganizationNoteApplyResult {
  const changed = tag === "applied" || move === "applied";
  const cancelled = tag === "interrupted-cancelled" || tag === "not-started-cancelled" || move === "not-started-cancelled";
  const stale = reason === "stale" || tag === "interrupted-stale" || tag === "not-started-stale" || move === "not-started-stale";
  const failed = reason !== undefined && reason !== "stale" || tag === "failed" || move === "failed";
  const outcome: OrganizationApplyOutcome = cancelled ? changed ? "cancelled-after-partial" : "cancelled"
    : failed || stale ? changed ? "partial" : stale ? "stale" : "failed"
      : tag === "applied" ? move === "applied" ? "moved-and-tags" : "updated-tags"
        : move === "applied" ? "moved" : "unchanged";
  return Object.freeze({ index, tag, move, outcome, ...(reason ? { reason } : {}) });
}
export function organizationApplyProgress(
  total: number, results: readonly OrganizationNoteApplyResult[], currentPath?: string,
): OrganizationApplyProgress {
  return Object.freeze({ total, processed: results.length,
    failed: results.filter(note => note.tag === "failed" || note.move === "failed" ||
      (note.reason !== undefined && note.reason !== "stale" && note.reason !== "invalid-confirmation")).length,
    stale: results.filter(note => note.reason === "stale" || note.tag === "interrupted-stale" || note.tag === "not-started-stale" || note.move === "not-started-stale").length,
    ...(currentPath === undefined ? {} : { currentPath }) });
}
