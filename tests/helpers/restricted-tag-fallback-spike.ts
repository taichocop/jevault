import type { FrontMatterInfo, TFile, Vault } from "obsidian";

import { NoteSource } from "../../src/note-source";
import { resolveTagApplySource } from "../../src/tags/tag-apply-authorization";
import { evaluationContext, fingerprintContent, sameContent, type EvaluationProvenance } from "../../src/tags/evaluation-provenance";
import { isSameTagIdentity } from "../../src/tags/tag-identity";

// 調査専用。productionの認可・mutation境界には接続しない。
export interface RestrictedHelpers {
  info(content: string): FrontMatterInfo;
  stringify(value: { tags: string[] }): string;
  parse(yaml: string): unknown;
}
type SpikeVault = Pick<Vault, "getFileByPath" | "read" | "process">;
export type RestrictedResult =
  | { status: "written"; addedTags: readonly string[] }
  | { status: "no-change" | "cancelled" }
  | { status: "failure"; reason: "busy" | "source-changed" | "freshness-unverified" | "content-not-eligible" | "invalid-selection" | "unexpected" };

const locks = new WeakMap<SpikeVault, { paths: Set<string>; files: Set<TFile> }>();

export function restrictedAbsence(current: string, helpers: Pick<RestrictedHelpers, "info">): boolean {
  // BOM・先頭delimiterらしき文字列・bare CRはhelper契約が曖昧なため対象外にする。
  if (current.includes("#") || current.startsWith("\uFEFF") || current.trimStart().startsWith("---") || /\r(?!\n)/.test(current)) return false;
  try {
    const info = helpers.info(current);
    return info.exists === false && info.frontmatter === "" &&
      info.from === 0 && info.to === 0 && info.contentStart === 0;
  } catch { return false; }
}

export function prependRestrictedTags(current: string, additions: readonly string[], helpers: RestrictedHelpers): string {
  const firstLf = current.indexOf("\n");
  const eol = firstLf > 0 && current[firstLf - 1] === "\r" ? "\r\n" : "\n";
  const tags = additions.map((name) => name.slice(1));
  // 新しいheaderだけ改行を揃え、元本文のstringには一切変換をかけない。
  let yaml = helpers.stringify({ tags }).replace(/\r?\n/g, eol);
  if (!yaml.endsWith(eol)) yaml += eol;
  const header = `---${eol}${yaml}---${eol}`;
  const candidate = header + current;
  const info = helpers.info(candidate);
  const parsed = helpers.parse(info.frontmatter);
  if (info.exists !== true || info.contentStart !== header.length || candidate.slice(info.contentStart) !== current ||
    typeof parsed !== "object" || parsed === null || Object.keys(parsed).length !== 1 || !("tags" in parsed) ||
    !Array.isArray(parsed.tags) || parsed.tags.length !== tags.length || parsed.tags.some((value, index) => value !== tags[index])) {
    throw new Error("Synthetic serialization validation failed");
  }
  return candidate;
}

/** 明示Apply中の一時readを評価provenanceへ照合し、callbackで完全一致を確認する候補。 */
export class RestrictedFallbackSpike {
  #retained?: string;
  #disposed = false;
  #started = false;
  readonly #allowed: readonly string[];
  constructor(
    private readonly vault: SpikeVault,
    private readonly source: NoteSource,
    private readonly provenance: EvaluationProvenance | undefined,
    allowedExistingSuggestions: readonly string[],
    private readonly helpers: RestrictedHelpers,
  ) { this.#allowed = Object.freeze([...allowedExistingSuggestions]); }

  dispose(): void { this.#disposed = true; this.#retained = undefined; }

  async apply(selectedTags: readonly string[], signal: AbortSignal): Promise<RestrictedResult> {
    const cancelled = () => this.#disposed || signal.aborted;
    if (cancelled()) return { status: "cancelled" };
    if (this.#started) return { status: "failure", reason: "busy" };
    this.#started = true;
    let held: { paths: Set<string>; files: Set<TFile> } | undefined;
    let file: TFile | null = null;
    let callbackFailure: RestrictedResult | undefined;
    try {
      if (!Array.isArray(selectedTags) || selectedTags.some((name) =>
        !this.#allowed.includes(name) || typeof name !== "string" || !/^#[^#\s]+$/u.test(name))) {
        return { status: "failure", reason: "invalid-selection" };
      }
      const additions: string[] = [];
      for (const name of selectedTags) {
        if (!additions.some((other) => isSameTagIdentity(other, name))) additions.push(name);
      }
      if (additions.length === 0) return { status: "no-change" };
      file = resolveTagApplySource(this.vault, this.source);
      if (file === null) return { status: "failure", reason: "source-changed" };
      const existing = locks.get(this.vault) ?? { paths: new Set<string>(), files: new Set<TFile>() };
      if (existing.paths.has(this.source.path) || existing.files.has(file)) return { status: "failure", reason: "busy" };
      locks.set(this.vault, existing);
      held = existing; held.paths.add(this.source.path); held.files.add(file);
      const context = evaluationContext(this.provenance, this.source);
      if (!context) return { status: "failure", reason: "freshness-unverified" };
      const snapshot = await this.vault.read(file);
      if (cancelled()) return { status: "cancelled" };
      if (resolveTagApplySource(this.vault, this.source) !== file) return { status: "failure", reason: "source-changed" };
      const fingerprint = await fingerprintContent(snapshot);
      if (cancelled()) return { status: "cancelled" };
      if (!fingerprint || !sameContent(context.content, fingerprint)) return { status: "failure", reason: "freshness-unverified" };
      this.#retained = snapshot;
      if (resolveTagApplySource(this.vault, this.source) !== file) return { status: "failure", reason: "source-changed" };
      if (cancelled()) return { status: "cancelled" };
      let candidate: string | undefined;
      const written = await this.vault.process(file, (current) => {
        if (cancelled()) callbackFailure = { status: "cancelled" };
        else if (resolveTagApplySource(this.vault, this.source) !== file) callbackFailure = { status: "failure", reason: "source-changed" };
        else if (this.#retained === undefined || current !== this.#retained) callbackFailure = { status: "failure", reason: "freshness-unverified" };
        else if (!restrictedAbsence(current, this.helpers)) callbackFailure = { status: "failure", reason: "content-not-eligible" };
        // unchangedを返しても保存されない保証はない。拒否時は候補を返さずthrowする。
        if (callbackFailure) throw new Error("Synthetic restricted validation failed");
        candidate = prependRestrictedTags(current, additions, this.helpers);
        if (cancelled()) { callbackFailure = { status: "cancelled" }; throw new Error("Synthetic cancellation"); }
        if (resolveTagApplySource(this.vault, this.source) !== file) {
          callbackFailure = { status: "failure", reason: "source-changed" }; throw new Error("Synthetic source changed");
        }
        return candidate;
      });
      // 開始後のcancelで書き込みを巻き戻さない。Promise失敗も成功とは報告しない。
      return candidate !== undefined && written === candidate
        ? { status: "written", addedTags: additions }
        : { status: "failure", reason: "unexpected" };
    } catch { return callbackFailure ?? { status: "failure", reason: "unexpected" }; }
    finally {
      this.#retained = undefined;
      held?.paths.delete(this.source.path);
      if (file !== null) held?.files.delete(file);
    }
  }
}
