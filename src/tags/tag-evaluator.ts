import type { NoteState } from "../note-service";
import type { TagCandidate } from "./tag-candidate";
import type { TagEvaluationResult } from "./tag-evaluation";

/** Folderの単一Choiceと分け、既存Tagを独立して評価するprovider非依存の境界。 */
export interface TagEvaluator {
  evaluate(
    note: NoteState,
    candidates: TagCandidate[],
    signal?: AbortSignal,
  ): Promise<TagEvaluationResult>;
}
