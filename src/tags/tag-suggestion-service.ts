import { throwIfCancelled } from "../classification/classification-cancellation";
import {
  MissingApiKeyError,
  NoActiveNoteError,
  NoCandidatesError,
  UnsupportedFileError,
} from "../classification/classification-errors";
import type { NoteService } from "../note-service";
import type { NoteSource } from "../note-source";
import type { SecretService } from "../secret-service";
import type { JevaultSettings } from "../settings";
import type { TagDiscoveryService } from "./tag-discovery-service";
import type { TagEvaluation } from "./tag-evaluation";
import type { TagEvaluator } from "./tag-evaluator";
import { captureEvaluationProvenance, type EvaluationProvenance } from "./evaluation-provenance";

export type TagEvaluatorFactory = (apiKey: string) => TagEvaluator;

export interface TagSuggestionServiceResult {
  readonly status: "success";
  readonly noteTitle: string;
  readonly source: NoteSource;
  readonly suggestions: readonly Readonly<TagEvaluation>[];
  readonly evaluationProvenance?: EvaluationProvenance;
}

type NoteStateProvider = Pick<NoteService, "getActiveNoteState">;
type TagCandidateProvider = Pick<TagDiscoveryService, "discover">;
type ApiKeyProvider = Pick<SecretService, "getApiKey">;

export class TagSuggestionService {
  constructor(
    private readonly noteService: NoteStateProvider,
    private readonly tagDiscovery: TagCandidateProvider,
    private readonly secretService: ApiKeyProvider,
    private readonly evaluatorFactory: TagEvaluatorFactory,
    private readonly getSettings: () => Pick<JevaultSettings, "apiKeySecretName">,
  ) {}

  async suggestForActiveNote(signal?: AbortSignal): Promise<TagSuggestionServiceResult> {
    throwIfCancelled(signal);
    const noteState = await this.noteService.getActiveNoteState(signal);
    throwIfCancelled(signal);
    if (noteState.status === "no-active-file") throw new NoActiveNoteError();
    if (noteState.status === "unsupported-file") throw new UnsupportedFileError();

    // fingerprint待機中も評価本文を差し替えられないよう、実際にproviderへ渡す入力を固定する。
    const evaluatedNote = Object.freeze({ ...noteState.note });
    const evaluationProvenance = await captureEvaluationProvenance(noteState.source, evaluatedNote.body);
    throwIfCancelled(signal);

    const candidates = this.tagDiscovery.discover();
    throwIfCancelled(signal);
    // 評価対象なしと評価後の提案なしを区別し、不要なSecretアクセスを避ける。
    if (candidates.length === 0) throw new NoCandidatesError();

    const settings = this.getSettings();
    throwIfCancelled(signal);
    const apiKey = this.secretService.getApiKey(settings.apiKeySecretName);
    throwIfCancelled(signal);
    if (apiKey === null || apiKey.trim().length === 0) throw new MissingApiKeyError();

    // await中の候補順変更に左右されず、発見時の決定的な順序を同率判定に使う。
    const candidateOrder = new Map(candidates.map(({ id }, index) => [id, index]));
    throwIfCancelled(signal);
    const evaluator = this.evaluatorFactory(apiKey);
    throwIfCancelled(signal);
    const result = await evaluator.evaluate(evaluatedNote, candidates, signal);
    throwIfCancelled(signal);

    const suggestions = result.evaluations
      .filter(({ choice }) => choice === "match")
      .sort((a, b) => b.matchProbability - a.matchProbability ||
        candidateOrder.get(a.tagId)! - candidateOrder.get(b.tagId)!);
    throwIfCancelled(signal);

    // 本文・Secret・providerの生応答を含めず、開始時のNoteSourceをそのまま返す。
    return {
      status: "success",
      noteTitle: noteState.note.title,
      source: noteState.source,
      suggestions,
      ...(evaluationProvenance === undefined ? {} : { evaluationProvenance }),
    };
  }
}
