import type { ClassificationServiceResult } from "../classification/classification-service";
import type { ClassificationCandidate } from "../classification/classification-result";
import type { NoteSource } from "../note-source";
import type { TagSuggestionServiceResult } from "../tags/tag-suggestion-service";
import type { NoteSnapshot } from "./target-file-collector";

export type OrganizationAnalysisStopReason =
  | "missing-api-key" | "no-candidates" | "network" | "typesafe-api"
  | "invalid-response" | "unexpected-error";
export type OrganizationReadFailure = "source-changed" | "read-failed";

export type AnalysisPhaseResult<T> =
  | { readonly status: "success"; readonly value: T }
  | { readonly status: "failure"; readonly reason: OrganizationAnalysisStopReason }
  | { readonly status: "not-run"; readonly reason: "prior-failure" | "cancelled" };

export type OrganizationFolderAnalysis = Readonly<Omit<ClassificationServiceResult, "result">> & {
  readonly result: {
    readonly candidates: readonly Readonly<ClassificationCandidate>[];
    readonly providerConfidence?: number;
  };
};
// Organizerは分析だけを返す。手動Tag Apply用のprovenanceは引き継がない。
export type OrganizationTagAnalysis = Readonly<Omit<TagSuggestionServiceResult, "evaluationProvenance">>;

export interface OrganizationNoteAnalysis {
  readonly source: NoteSource;
  readonly snapshot: NoteSnapshot;
  readonly folder: AnalysisPhaseResult<OrganizationFolderAnalysis>;
  readonly tags: AnalysisPhaseResult<OrganizationTagAnalysis>;
  readonly status: "success" | "failed" | "partial" | "cancelled";
  readonly readFailure?: OrganizationReadFailure | "unexpected-error";
}

export interface FolderOrganizerProgress {
  readonly total: number;
  readonly processed: number;
  readonly failed: number;
  readonly currentPath?: string;
}

interface AnalysisHistory {
  readonly results: readonly OrganizationNoteAnalysis[];
  readonly progress: FolderOrganizerProgress;
}

export type FolderOrganizerAnalysisResult = AnalysisHistory & (
  | { readonly status: "completed" | "cancelled" }
  | { readonly status: "stopped"; readonly reason: OrganizationAnalysisStopReason }
);
