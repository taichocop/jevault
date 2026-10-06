import { ClassificationCancelledError } from "../classification/classification-cancellation";
import {
  InvalidTypeSafeResponseError, MissingApiKeyError, NetworkError, NoCandidatesError, TypeSafeApiError,
} from "../classification/classification-errors";
import type { ClassificationService, ClassificationServiceResult } from "../classification/classification-service";
import type { TagSuggestionService, TagSuggestionServiceResult } from "../tags/tag-suggestion-service";
import type {
  AnalysisPhaseResult, FolderOrganizerAnalysisResult, FolderOrganizerProgress,
  OrganizationAnalysisStopReason, OrganizationFolderAnalysis, OrganizationNoteAnalysis, OrganizationTagAnalysis,
} from "./organization-analysis-result";
import type { OrganizationTargetReader } from "./organization-target-reader";
import type { OrganizationAnalysisOptions } from "./organization-analysis-options";
import type { OrganizationTarget } from "./target-file-collector";

type Termination = { status: "cancelled" } | { status: "stopped"; reason: OrganizationAnalysisStopReason };
interface TargetAnalysis { result: OrganizationNoteAnalysis; termination?: Termination }

function failureReason(error: unknown): OrganizationAnalysisStopReason {
  if (error instanceof MissingApiKeyError) return "missing-api-key";
  if (error instanceof NoCandidatesError) return "no-candidates";
  if (error instanceof NetworkError) return "network";
  if (error instanceof TypeSafeApiError) return "typesafe-api";
  if (error instanceof InvalidTypeSafeResponseError) return "invalid-response";
  // 未知の例外も継続しない。message/stack/abort reasonは保存しない。
  return "unexpected-error";
}

function notRun(reason: "prior-failure" | "cancelled" | "disabled") {
  return Object.freeze({ status: "not-run" as const, reason });
}

function copyFolder(value: ClassificationServiceResult, target: OrganizationTarget): OrganizationFolderAnalysis {
  // spreadで本文や生応答を混入させず、provider由来の配列・要素も所有する。
  return Object.freeze({
    status: "success", noteTitle: value.noteTitle, source: target.source,
    result: Object.freeze({
      candidates: Object.freeze(value.result.candidates.map(({ path, probability }) => Object.freeze({ path, probability }))),
      ...(value.result.providerConfidence === undefined ? {} : { providerConfidence: value.result.providerConfidence }),
    }),
  });
}

function copyTags(value: TagSuggestionServiceResult, target: OrganizationTarget): OrganizationTagAnalysis {
  return Object.freeze({
    status: "success", noteTitle: value.noteTitle, source: target.source,
    suggestions: Object.freeze(value.suggestions.map(({ tagId, tagName, choice, matchProbability, providerConfidence }) =>
      Object.freeze({ tagId, tagName, choice, matchProbability,
        ...(providerConfidence === undefined ? {} : { providerConfidence }) }))),
  });
}

/** 収集済みexact targetを一つずつ分析し、UI・選択・mutationを所有しない。 */
export class FolderOrganizerService {
  constructor(
    private readonly reader: Pick<OrganizationTargetReader, "read">,
    private readonly folders: Pick<ClassificationService, "classifyNote">,
    private readonly tags: Pick<TagSuggestionService, "suggestForNote">,
  ) {}

  async analyze(
    targets: readonly OrganizationTarget[],
    options: OrganizationAnalysisOptions,
    signal?: AbortSignal,
    onProgress?: (progress: FolderOrganizerProgress) => void,
  ): Promise<FolderOrganizerAnalysisResult> {
    // callerの可変設定はcallback/awaitより前に切り離し、run全体で固定する。
    const ownedOptions = Object.freeze({ evaluateFolder: options.evaluateFolder, evaluateTags: options.evaluateTags });
    const owned = Object.freeze(targets.map(({ source, snapshot }) => Object.freeze({
      source, snapshot: Object.freeze({ path: snapshot.path, mtime: snapshot.mtime, size: snapshot.size }),
    })));
    const results: OrganizationNoteAnalysis[] = [];
    let failed = 0;
    let progress: FolderOrganizerProgress;
    const publish = (currentPath?: string): boolean => {
      progress = Object.freeze({ total: owned.length, processed: results.length, failed,
        ...(currentPath === undefined ? {} : { currentPath }) });
      try {
        onProgress?.(progress);
        return true;
      } catch {
        // observer例外で結果を失わず、新たな分析は止める。例外詳細は露出しない。
        return false;
      }
    };
    const finish = (termination?: Termination): FolderOrganizerAnalysisResult => {
      const published = publish();
      const status = termination ?? (owned.length > 0 && signal?.aborted ? { status: "cancelled" as const }
        : !published ? { status: "stopped" as const, reason: "unexpected-error" as const }
          : { status: "completed" as const });
      return Object.freeze({ ...status, results: Object.freeze([...results]), progress });
    };
    if (!ownedOptions.evaluateFolder && !ownedOptions.evaluateTags) return finish({ status: "stopped", reason: "invalid-options" });
    if (owned.length === 0) return finish();
    if (signal?.aborted) return finish({ status: "cancelled" });
    if (!publish()) return finish({ status: "stopped", reason: "unexpected-error" });
    for (const target of owned) {
      if (signal?.aborted) return finish({ status: "cancelled" });
      if (!publish(target.snapshot.path)) return finish({ status: "stopped", reason: "unexpected-error" });
      if (signal?.aborted) return finish({ status: "cancelled" });
      // 本文はこのhelper内だけに留め、次targetへ進む前に参照を手放す。
      const analysis = await this.analyzeTarget(target, ownedOptions, signal);
      results.push(analysis.result);
      if (analysis.result.status === "failed" || analysis.result.status === "partial") failed++;
      const published = publish();
      if (analysis.termination) return finish(analysis.termination);
      if (signal?.aborted) return finish({ status: "cancelled" });
      if (!published) return finish({ status: "stopped", reason: "unexpected-error" });
    }
    return finish();
  }

  private async analyzeTarget(target: OrganizationTarget, options: OrganizationAnalysisOptions, signal?: AbortSignal): Promise<TargetAnalysis> {
    let folder: AnalysisPhaseResult<OrganizationFolderAnalysis> = notRun(options.evaluateFolder ? "cancelled" : "disabled");
    let tags: AnalysisPhaseResult<OrganizationTagAnalysis> = notRun(options.evaluateTags ? "cancelled" : "disabled");
    const readFailed = (): void => {
      if (options.evaluateFolder) folder = notRun("prior-failure");
      if (options.evaluateTags) tags = notRun("prior-failure");
    };
    const terminal = (status: OrganizationNoteAnalysis["status"], termination?: Termination,
      readFailure?: OrganizationNoteAnalysis["readFailure"]): TargetAnalysis => ({
      result: Object.freeze({ source: target.source, snapshot: target.snapshot, folder, tags, status,
        ...(readFailure === undefined ? {} : { readFailure }) }),
      ...(termination === undefined ? {} : { termination }),
    });
    const cancelled = () => terminal("cancelled", { status: "cancelled" });
    let phase: "read" | "folder" | "tags" = "read";
    try {
      if (signal?.aborted) return cancelled();
      const read = await this.reader.read(target, signal);
      if (read.status === "cancelled" || signal?.aborted) return cancelled();
      if (read.status === "failure") {
        readFailed();
        return terminal("failed", undefined, read.reason);
      }
      if (options.evaluateFolder) {
        phase = "folder";
        const classified = await this.folders.classifyNote(read.note, target.source, signal);
        folder = Object.freeze({ status: "success", value: copyFolder(classified, target) });
      }
      if (options.evaluateTags) {
        if (signal?.aborted) return cancelled();
        phase = "tags";
        const suggested = await this.tags.suggestForNote(read.note, target.source, signal);
        tags = Object.freeze({ status: "success", value: copyTags(suggested, target) });
      }
      // 有効phaseが完了したNoteは成功として保持し、operation側で次のworkを止める。
      return terminal("success");
    } catch (error: unknown) {
      if (signal?.aborted || error instanceof ClassificationCancelledError) return cancelled();
      const reason = failureReason(error);
      if (phase === "read") {
        readFailed();
        return terminal("failed", { status: "stopped", reason }, "unexpected-error");
      }
      const failure = Object.freeze({ status: "failure" as const, reason });
      if (phase === "folder") {
        folder = failure;
        if (options.evaluateTags) tags = notRun("prior-failure");
      }
      else tags = failure;
      return terminal(phase === "tags" && folder.status === "success" ? "partial" : "failed",
        { status: "stopped", reason });
    }
  }
}
