import type { OrganizationApplyReason, OrganizationApplyOutcome, OrganizationTagStatus, OrganizationMoveStatus } from "./organization-apply-result";
import type { OrganizationReviewResult } from "./organization-review-session";

export const applyReasons: Record<OrganizationApplyReason | "invalid-input", string> = {
  busy: "Another Jevault mutation is using this source or target.",
  "destination-missing": "The selected destination is no longer available.",
  "ineligible-destination": "The selected destination is no longer eligible.",
  "invalid-destination": "The selected destination is invalid.",
  collision: "The target already exists or conflicts with an existing name.",
  "tag-failed": "The Tag operation failed; Move was not started.",
  "move-failed": "The Move operation failed.",
  stale: "The original source changed or was replaced; skipped safely.",
  "invalid-confirmation": "The original confirmation is no longer valid.",
  "invalid-input": "The reviewed intent is unavailable or invalid.",
  invariant: "Apply stopped because a safety invariant could not be maintained.",
};
export const applyOutcomes: Record<OrganizationApplyOutcome, string> = {
  unchanged: "Unchanged", "updated-tags": "Updated tags", moved: "Moved", "moved-and-tags": "Moved and tags updated",
  stale: "Stale / skipped", failed: "Failed", partial: "Partial success", cancelled: "Cancelled",
  "cancelled-after-partial": "Cancelled after partial success",
};
export const tagPhases: Record<OrganizationTagStatus, string> = {
  "not-selected": "No tags selected", unchanged: "Unchanged", applied: "Applied", failed: "Failed",
  "not-started-cancelled": "Not started (cancelled)", "not-started-stale": "Not started (stale)",
  "not-started-prior-failure": "Not started (prior failure)",
  "interrupted-cancelled": "Interrupted (cancelled)", "interrupted-stale": "Interrupted (stale)",
  "interrupted-revoked": "Interrupted (confirmation revoked)",
};
export const movePhases: Record<OrganizationMoveStatus, string> = {
  "keep-current": "Keep current folder", unchanged: "Unchanged (same folder)", applied: "Applied", failed: "Failed",
  "not-started-cancelled": "Not started (cancelled)", "not-started-stale": "Not started (stale)",
  "not-started-prior-failure": "Not started (prior failure)",
};
export function plannedCounts(review: OrganizationReviewResult): { moves: number; tags: number } {
  return { moves: review.reviewed.filter(note => note.folder.kind === "existing-folder" &&
    note.folder.path !== (note.source.path.includes("/") ? note.source.path.slice(0, note.source.path.lastIndexOf("/")) : "/")).length,
  tags: review.reviewed.reduce((count, note) => count + note.selectedTags.length, 0) };
}
