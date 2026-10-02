import type { MetadataCache, TFile } from "obsidian";

import { NoteSource } from "../note-source";
import { IndexedTagMetadataTracker, type TagMetadataObservation } from "./indexed-tag-metadata";
import type { EvaluationProvenance } from "./evaluation-provenance";
import { classifyTagSuggestionFreshness, type TagSuggestionFreshness } from "./tag-suggestion-freshness";
import { resolveTagApplySource, type TagApplyVault } from "./tag-apply-authorization";
import type { TagSuggestionServiceResult } from "./tag-suggestion-service";
import {
  isIssuedSuggestionGrant, type TagSuggestionGrant, type TagSuggestionGrantLifetime,
} from "./tag-suggestion-grant";

/** 確認へ進めるかだけを表し、current frontmatterやmutation成功を保証しない。 */
export type TagApplyReadiness =
  | { readonly status: "confirmable"; readonly freshness: TagSuggestionFreshness }
  | {
    readonly status: "blocked";
    readonly reason: "session-closed" | "grant-unavailable" | "source-changed" | "invalid-selection" | "empty-selection";
    readonly freshness: TagSuggestionFreshness;
  };

export interface ConfirmedTagApplyIntent {
  readonly grant: TagSuggestionGrant;
  readonly selectedTags: readonly string[];
}

interface ConfirmationRecord {
  readonly vault: TagApplyVault;
  readonly active: () => boolean;
  consumed: boolean;
}

// objectのcopyを認可せず、session/selection世代と使用状態はmemory-onlyで保持する。
const confirmations = new WeakMap<ConfirmedTagApplyIntent, ConfirmationRecord>();

/** consume後も開始済みattemptのsession失効を検出する。再利用可否はconsumeで判定する。 */
export function isActiveConfirmedTagApplyIntent(intent: unknown, vault: TagApplyVault): boolean {
  try {
    if (typeof intent !== "object" || intent === null) return false;
    const confirmation = intent as ConfirmedTagApplyIntent;
    const record = confirmations.get(confirmation);
    return record !== undefined && record.vault === vault && record.active() &&
      isIssuedSuggestionGrant(confirmation.grant, vault);
  } catch {
    return false;
  }
}

/** initial abort後、Apply attempt受理時に一度だけ呼ぶ。失敗・busyも同じintentで再試行しない。 */
export function consumeConfirmedTagApplyIntent(intent: unknown, vault: TagApplyVault): boolean {
  if (!isActiveConfirmedTagApplyIntent(intent, vault)) return false;
  const record = confirmations.get(intent as ConfirmedTagApplyIntent)!;
  if (record.consumed) return false;
  record.consumed = true;
  return true;
}

export interface TagApplyPreparedPresentation {
  readonly suggestionGrant?: TagSuggestionGrant;
  readonly suggestionFreshness: TagSuggestionFreshness;
  getReadiness(selectedTags: readonly string[]): TagApplyReadiness;
  /** downstream UIは実際のuser confirm action後だけ呼ぶ。選択だけでは発行しない。 */
  confirm(selectedTags: readonly string[]): ConfirmedTagApplyIntent | undefined;
  dispose(): void;
}

export interface TagApplyPreparation extends TagApplyPreparedPresentation {
  prepare(outcome: TagSuggestionServiceResult, lifetime?: TagSuggestionGrantLifetime): void;
}

/** 明示operationごとに生成し、成功時だけModalへ所有権を渡す。 */
export class TagApplyPreparationSession implements TagApplyPreparation {
  readonly #target?: NoteSource;
  #tracker?: IndexedTagMetadataTracker;
  #disposed = false;
  #prepared = false;
  #preparedSource?: NoteSource;
  #evaluationProvenance?: EvaluationProvenance;
  #grantLifetime?: TagSuggestionGrantLifetime;
  #grant?: TagSuggestionGrant;
  #selection?: readonly string[];
  #selectionGeneration = 0;

  readonly #vault: TagApplyVault;

  constructor(
    vault: TagApplyVault,
    metadata: Pick<MetadataCache, "on" | "offref">,
    file: TFile | null,
  ) {
    this.#vault = vault;
    if (file === null || file.extension.toLowerCase() !== "md") return;
    this.#target = new NoteSource(file);
    try {
      this.#tracker = new IndexedTagMetadataTracker(vault, metadata, this.#target);
    } catch {
      // advisory観測の失敗で、提案や独立したreadinessを妨げない。
    }
  }

  get suggestionGrant(): TagSuggestionGrant | undefined { return this.#grant; }

  get tagMetadataObservation(): TagMetadataObservation | undefined {
    return this.#preparedSource === undefined ? undefined : this.#tracker?.observation(this.#preparedSource);
  }

  get suggestionFreshness(): TagSuggestionFreshness {
    return this.#preparedSource === undefined ? "unknown" : classifyTagSuggestionFreshness(
      this.#preparedSource, this.#evaluationProvenance, this.tagMetadataObservation,
    );
  }

  prepare(outcome: TagSuggestionServiceResult, lifetime?: TagSuggestionGrantLifetime): void {
    if (this.#disposed || this.#prepared) {
      // 別Grantへのreplacementは新sessionを必要とし、旧operationを再利用しない。
      if (lifetime !== undefined && lifetime !== this.#grantLifetime) {
        this.#dispose();
        lifetime.dispose();
      }
      return;
    }
    this.#prepared = true;
    const grant = lifetime?.grant;
    const source = outcome.source;
    const provenance = outcome.evaluationProvenance;
    if (this.#disposed || outcome.status !== "success" || grant?.source !== source) {
      lifetime?.dispose();
      return;
    }
    this.#grantLifetime = lifetime;
    this.#grant = grant;
    this.#preparedSource = source;
    this.#evaluationProvenance = provenance;
  }

  getReadiness(selectedTags: readonly string[]): TagApplyReadiness {
    return this.#evaluateReadiness(selectedTags);
  }

  #evaluateReadiness(selectedTags: readonly string[]): TagApplyReadiness {
    let selected: string[] | undefined;
    try {
      if (Array.isArray(selectedTags)) selected = [...selectedTags];
    } catch {
      // malformed runtime callerを既存selection/confirmationへのfallbackにしない。
    }
    if (!selected || !this.#selection || selected.length !== this.#selection.length ||
      selected.some((name, index) => name !== this.#selection![index])) {
      this.#selectionGeneration++;
      this.#selection = selected === undefined ? undefined : Object.freeze(selected);
    }
    const generation = this.#selectionGeneration;
    const selection = this.#selection;
    const freshness = this.suggestionFreshness;
    const blocked = (reason: Extract<TagApplyReadiness, { status: "blocked" }>["reason"]): TagApplyReadiness =>
      ({ status: "blocked", reason, freshness });
    if (this.#disposed) return blocked("session-closed");
    const grant = this.#grant;
    if (!grant || !isIssuedSuggestionGrant(grant, this.#vault)) return blocked("grant-unavailable");
    try {
      const file = resolveTagApplySource(this.#vault, grant.source);
      if (!this.#target || !file || !this.#target.matches(file) || grant.source !== this.#preparedSource) {
        return blocked("source-changed");
      }
    } catch {
      return blocked("source-changed");
    }
    // source解決境界でClose/revocationが起きても確認権限を発行しない。
    if (this.#disposed) return blocked("session-closed");
    if (!isIssuedSuggestionGrant(grant, this.#vault)) return blocked("grant-unavailable");
    if (!selected || selected.some((name) => typeof name !== "string" || !grant.allowedTags.includes(name))) {
      return blocked("invalid-selection");
    }
    // getter内の再入でselectionが替わっても、外側の検証結果と別selectionを混ぜない。
    if (this.#selectionGeneration !== generation || this.#selection !== selection) return blocked("invalid-selection");
    if (selected.length === 0) return blocked("empty-selection");
    return { status: "confirmable", freshness };
  }

  confirm(selectedTags: readonly string[]): ConfirmedTagApplyIntent | undefined {
    if (this.#evaluateReadiness(selectedTags).status !== "confirmable") return undefined;
    const grant = this.#grant!;
    const generation = this.#selectionGeneration;
    const confirmation: ConfirmedTagApplyIntent = Object.freeze({
      grant, selectedTags: Object.freeze([...this.#selection!]),
    });
    confirmations.set(confirmation, {
      vault: this.#vault,
      consumed: false,
      active: () => !this.#disposed && this.#selectionGeneration === generation &&
        this.#grant === grant && this.#preparedSource === grant.source,
    });
    return confirmation;
  }

  dispose(): void { this.#dispose(); }

  #dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#grantLifetime?.dispose();
    this.#grantLifetime = undefined;
    this.#grant = undefined;
    this.#preparedSource = undefined;
    this.#evaluationProvenance = undefined;
    this.#selection = undefined;
    this.#tracker?.dispose();
    this.#tracker = undefined;
  }
}
