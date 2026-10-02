import type { NoteSource } from "../note-source";
import { evaluationContext, sameContent, type EvaluationProvenance } from "./evaluation-provenance";
import { isAcceptedTagMetadataObservation, type TagMetadataObservation } from "./indexed-tag-metadata";

/** matchingもchanged/unknownもadvisoryのみ。mutation許可・失敗理由へ変換しない。 */
export type TagSuggestionFreshness = "matching" | "changed" | "unknown";

/** 呼び出し時点の有効なobservationを比較する。event後からtransactionまでのgapは解消しない。 */
export function classifyTagSuggestionFreshness(
  source: NoteSource,
  provenance: EvaluationProvenance | undefined,
  observation: TagMetadataObservation | undefined,
): TagSuggestionFreshness {
  const context = evaluationContext(provenance, source);
  if (!context || !observation || !isAcceptedTagMetadataObservation(observation, source)) return "unknown";
  return sameContent(context.content, observation.content) ? "matching" : "changed";
}
