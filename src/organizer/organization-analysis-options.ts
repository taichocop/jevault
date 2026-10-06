/** 一回のAnalyzeでexact Preview target全体へ適用する分析設定。Review選択ではない。 */
export interface OrganizationAnalysisOptions {
  readonly evaluateFolder: boolean;
  readonly evaluateTags: boolean;
}
