import type { Vault } from "obsidian";

import { NoteSource } from "../note-source";
import { evaluationContext, type EvaluationProvenance } from "./evaluation-provenance";
import type { TagSuggestionServiceResult } from "./tag-suggestion-service";

/** 提示したintent setの記録だけであり、Vault mutationの許可ではない。 */
export interface TagSuggestionGrant {
  readonly source: NoteSource;
  readonly allowedTags: readonly string[];
  readonly evaluationProvenance?: EvaluationProvenance;
}

export interface TagSuggestionGrantLifetime {
  readonly grant: TagSuggestionGrant;
  dispose(): void;
}

interface IssuanceRecord {
  readonly vault: Pick<Vault, "getFileByPath">;
  active: boolean;
}

// copied objectや別Vaultを認可せず、失効状態は公開objectの外でmemory-onlyに保持する。
const issued = new WeakMap<TagSuggestionGrant, IssuanceRecord>();

export function isIssuedSuggestionGrant(grant: TagSuggestionGrant, vault: Pick<Vault, "getFileByPath">): boolean {
  const record = issued.get(grant);
  return record !== undefined && record.vault === vault && record.active;
}

/** final successだけから発行し、metadata/current contentの検証は要求しない。 */
export class TagSuggestionGrantIssuer {
  constructor(private readonly vault: Pick<Vault, "getFileByPath">) {}

  issue(outcome: TagSuggestionServiceResult): TagSuggestionGrantLifetime | undefined {
    if (outcome.status !== "success" || !(outcome.source instanceof NoteSource) ||
      !Array.isArray(outcome.suggestions) || outcome.suggestions.some((suggestion) =>
        !suggestion || suggestion.choice !== "match" || typeof suggestion.tagName !== "string" ||
        !/^#[^#\s]+$/u.test(suggestion.tagName))) return undefined;
    // provenance欠如は許容するが、別sourceのtokenをadvisory evidenceとして引き継がない。
    if (outcome.evaluationProvenance !== undefined &&
      !evaluationContext(outcome.evaluationProvenance, outcome.source)) return undefined;

    const grant: TagSuggestionGrant = Object.freeze({
      source: outcome.source,
      allowedTags: Object.freeze(outcome.suggestions.map(({ tagName }) => tagName)),
      ...(outcome.evaluationProvenance === undefined ? {} : { evaluationProvenance: outcome.evaluationProvenance }),
    });
    const record: IssuanceRecord = { vault: this.vault, active: true };
    issued.set(grant, record);
    return { grant, dispose: () => { record.active = false; } };
  }
}
