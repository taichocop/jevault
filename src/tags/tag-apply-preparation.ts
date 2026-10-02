import type { MetadataCache, TFile } from "obsidian";

import { NoteSource } from "../note-source";
import { IndexedTagMetadataTracker, type TagMetadataObservation } from "./indexed-tag-metadata";
import type { EvaluationProvenance } from "./evaluation-provenance";
import { classifyTagSuggestionFreshness, type TagSuggestionFreshness } from "./tag-suggestion-freshness";
import {
  resolveTagApplySource, TagApplyAuthorizationService,
  type TagApplyAuthorization, type TagApplyFailureReason, type TagApplyVault,
} from "./tag-apply-authorization";
import type { TagSuggestionServiceResult } from "./tag-suggestion-service";
import type { TagSuggestionGrant } from "./tag-suggestion-grant";

export type TagApplyPreparationState =
  | { readonly status: "available"; readonly authorization: TagApplyAuthorization }
  | { readonly status: "unavailable"; readonly reason: TagApplyFailureReason };

export interface TagApplyPreparation {
  readonly state: TagApplyPreparationState;
  prepare(outcome: TagSuggestionServiceResult): void;
  dispose(): void;
}

/** UIはstateとdisposeだけを受け取り、metadataや認可アルゴリズムを扱わない。 */
export interface TagApplyPreparedPresentation {
  readonly applyPreparation: TagApplyPreparationState;
  readonly suggestionGrant?: TagSuggestionGrant;
  dispose(): void;
}

/** 明示operationごとに生成し、成功時だけModalへ所有権を渡す。 */
export class TagApplyPreparationSession implements TagApplyPreparation {
  private readonly target?: NoteSource;
  private tracker?: IndexedTagMetadataTracker;
  private disposed = false;
  private prepared = false;
  private preparedSource?: NoteSource;
  private evaluationProvenance?: EvaluationProvenance;
  private current: TagApplyPreparationState = { status: "unavailable", reason: "freshness-unverified" };

  constructor(
    private readonly vault: TagApplyVault,
    metadata: Pick<MetadataCache, "on" | "offref">,
    file: TFile | null,
  ) {
    if (file === null || file.extension.toLowerCase() !== "md") return;
    this.target = new NoteSource(file);
    try {
      this.tracker = new IndexedTagMetadataTracker(vault, metadata, this.target);
    } catch {
      // proof準備の失敗でread-onlyのTag Suggestまで失敗させない。
      this.current = { status: "unavailable", reason: "metadata-unavailable" };
    }
  }

  get state(): TagApplyPreparationState { return this.current; }

  get tagMetadataObservation(): TagMetadataObservation | undefined {
    return this.preparedSource === undefined ? undefined : this.tracker?.observation(this.preparedSource);
  }

  get suggestionFreshness(): TagSuggestionFreshness {
    return this.preparedSource === undefined ? "unknown" : classifyTagSuggestionFreshness(
      this.preparedSource, this.evaluationProvenance, this.tagMetadataObservation,
    );
  }

  prepare(outcome: TagSuggestionServiceResult): void {
    if (this.disposed || this.prepared) return;
    this.prepared = true;
    try {
      const file = resolveTagApplySource(this.vault, outcome.source);
      if (!this.target || file === null || !this.target.matches(file)) {
        this.current = { status: "unavailable", reason: "source-changed" };
        return;
      }
      if (!this.tracker) return;
      // legacy認可の成否と独立に保持し、Modalにはraw observationを渡さない。
      if (outcome.status === "success") {
        this.preparedSource = outcome.source;
        this.evaluationProvenance = outcome.evaluationProvenance;
      }
      const result = new TagApplyAuthorizationService(this.vault, this.tracker).capture(outcome);
      if (this.disposed) return;
      this.current = result.status === "captured"
        ? { status: "available", authorization: result.authorization }
        : { status: "unavailable", reason: result.reason };
    } catch {
      this.current = { status: "unavailable", reason: "unexpected" };
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preparedSource = undefined;
    this.evaluationProvenance = undefined;
    this.current = { status: "unavailable", reason: "freshness-unverified" };
    this.tracker?.dispose();
    this.tracker = undefined;
  }
}
