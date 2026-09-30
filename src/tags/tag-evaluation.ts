export interface TagEvaluation {
  tagId: string;
  tagName: string;
  choice: "match" | "other";
  matchProbability: number;
  providerConfidence?: number;
}

export interface TagEvaluationResult {
  evaluations: TagEvaluation[];
}
