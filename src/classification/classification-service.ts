import type { NoteService, NoteState } from "../note-service";
import type { NoteSource } from "../note-source";
import type { SecretService } from "../secret-service";
import type { JevaultSettings } from "../settings";
import type { VaultService } from "../vault-service";
import type { CandidateBuilder } from "./candidate-builder";
import { throwIfCancelled } from "./classification-cancellation";
import {
  MissingApiKeyError,
  NoActiveNoteError,
  NoCandidatesError,
  UnsupportedFileError,
} from "./classification-errors";
import type { ClassificationResult } from "./classification-result";
import type { Classifier } from "./classifier";
import { classifyAndSort } from "./classify-and-sort";

export type ClassifierFactory = (apiKey: string) => Classifier;

export interface ClassificationServiceResult {
  status: "success";
  noteTitle: string;
  source: NoteSource;
  result: ClassificationResult;
}

type NoteStateProvider = Pick<NoteService, "getActiveNoteState">;
type FolderPathProvider = Pick<VaultService, "getAvailableFolderPaths">;
type ApiKeyProvider = Pick<SecretService, "getApiKey">;

/** Active noteから上位候補を返すまでを調停する、provider非依存のapplication boundary。 */
export class ClassificationService {
  constructor(
    private readonly noteService: NoteStateProvider,
    private readonly vaultService: FolderPathProvider,
    private readonly candidateBuilder: CandidateBuilder,
    private readonly secretService: ApiKeyProvider,
    private readonly classifierFactory: ClassifierFactory,
    private readonly getSettings: () => JevaultSettings,
  ) {}

  async classifyActiveNote(
    signal?: AbortSignal,
  ): Promise<ClassificationServiceResult> {
    throwIfCancelled(signal);
    const noteState = await this.noteService.getActiveNoteState(signal);
    // Vault.read自体は中断できないため、完了後にSecret解決へ進む前にも確認する。
    throwIfCancelled(signal);
    if (noteState.status === "no-active-file") {
      throw new NoActiveNoteError();
    }
    if (noteState.status === "unsupported-file") {
      throw new UnsupportedFileError();
    }

    return this.classifyNote(noteState.note, noteState.source, signal);
  }

  /** 読取済みのexact Noteを分析し、active Noteの取得は行わない。 */
  async classifyNote(
    note: Readonly<NoteState>,
    source: NoteSource,
    signal?: AbortSignal,
  ): Promise<ClassificationServiceResult> {
    throwIfCancelled(signal);
    const settings = this.getSettings();
    const folderPaths = this.vaultService.getAvailableFolderPaths(settings);
    const candidates = this.candidateBuilder.build(folderPaths);
    if (candidates.length === 0) {
      // Choiceを構築できないため、Secret解決やClassifier生成より前に終了する。
      throw new NoCandidatesError();
    }

    throwIfCancelled(signal);
    const apiKey = this.secretService.getApiKey(settings.apiKeySecretName);
    throwIfCancelled(signal);
    if (apiKey === null || apiKey.trim().length === 0) {
      // blank値でも認証不能な通信へ進まないよう、credential自体は加工せず利用可否だけを判定する。
      throw new MissingApiKeyError();
    }

    // factory境界によりapplication層はTypeSafe SDKを知らず、解決済みSecretもadapterへだけ渡す。
    const classifier = this.classifierFactory(apiKey);
    const result = await classifyAndSort(
      classifier,
      note,
      candidates,
      signal,
    );
    throwIfCancelled(signal);

    return {
      status: "success",
      // 本文やSecretを結果へ含めず、移動対象のidentityだけをapplication層へ渡す。
      noteTitle: note.title,
      source,
      result: {
        ...result,
        // providerConfidenceは順位に使わず保持し、probability sort後に表示件数だけを制限する。
        candidates: result.candidates.slice(0, settings.suggestionCount),
      },
    };
  }
}
