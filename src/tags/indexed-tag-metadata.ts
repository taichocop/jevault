import { getAllTags, parseFrontMatterTags, type MetadataCache, type TFile, type Vault } from "obsidian";

import { NoteSource } from "../note-source";
import { resolveTagApplySource } from "./tag-apply-authorization";
import { evaluationContext, fingerprintContent, sameContent, type ContentProvenance, type EvaluationProvenance } from "./evaluation-provenance";

export type VerifiedTagMetadata =
  | { status: "verified"; proof: object; existingTags: readonly string[]; frontmatterTags: readonly string[] }
  | { status: "failure"; reason: "metadata-unavailable" | "freshness-unverified" | "metadata-stale" };

export interface VerifiedTagMetadataProvider {
  snapshot(source: NoteSource, provenance: EvaluationProvenance | undefined): VerifiedTagMetadata;
}

/** 同一changedイベントの観測値であり、現在のtransactionやmutation安全性を証明しない。 */
export interface TagMetadataObservation {
  readonly source: NoteSource;
  readonly revision: Readonly<{ mtime: number; size: number }>;
  readonly content: ContentProvenance;
  readonly existingTags: readonly string[];
  readonly frontmatterTags: readonly string[];
}

interface IndexedRecord {
  proof: object;
  source: NoteSource;
  revision: Readonly<{ mtime: number; size: number }>;
  content?: ContentProvenance;
  existingTags: readonly string[];
  frontmatterTags: readonly string[];
}

/** 公開changedイベントのdata/cache pairだけを使う。getFileCache・本文再read・pollingをしない。 */
export class IndexedTagMetadataTracker implements VerifiedTagMetadataProvider {
  private records = new WeakMap<TFile, IndexedRecord>();
  private disposed = false;
  private readonly event;

  constructor(
    private readonly vault: Pick<Vault, "getFileByPath">,
    private readonly metadata: Pick<MetadataCache, "on" | "offref">,
    private readonly target: NoteSource,
  ) {
    this.event = metadata.on("changed", (file, data, cache) => {
      // exact target以外の本文は、helper呼び出しやfingerprintより前に除外する。
      if (this.disposed || !this.target.matches(file)) return;
      try {
        if (this.vault.getFileByPath(file.path) !== file) return;
        // 新eventのdigest待機中に前のproofを使わせず、event順の逆転も防ぐ。
        this.records.delete(file);
        const source = new NoteSource(file);
        if (source.revision === undefined) return;
        const record: IndexedRecord = {
          proof: Object.freeze({}),
          source, revision: source.revision,
          existingTags: Object.freeze([...new Set(getAllTags(cache) ?? [])]),
          frontmatterTags: Object.freeze([...new Set(parseFrontMatterTags(cache.frontmatter ?? null) ?? [])]),
        };
        this.records.set(file, record);
        void fingerprintContent(data).then((content) => {
          if (!this.disposed && this.records.get(file) === record && source.matches(file) &&
            record.revision.mtime === file.stat.mtime && record.revision.size === file.stat.size) {
            record.content = content;
          }
        });
      } catch {
        this.records.delete(file);
      }
    });
  }

  observation(source: NoteSource): TagMetadataObservation | undefined {
    if (this.disposed) return undefined;
    try {
      const file = resolveTagApplySource(this.vault, source);
      if (file === null || !this.target.matches(file)) return undefined;
      const record = this.records.get(file);
      if (!record?.content || !record.source.matches(file) ||
        record.revision.mtime !== file.stat.mtime || record.revision.size !== file.stat.size) return undefined;
      return Object.freeze({
        source, revision: record.revision, content: record.content,
        existingTags: record.existingTags, frontmatterTags: record.frontmatterTags,
      });
    } catch {
      // 読み取り境界の例外は公開せず、弱いstat/cache fallbackも作らない。
      return undefined;
    }
  }

  snapshot(source: NoteSource, provenance: EvaluationProvenance | undefined): VerifiedTagMetadata {
    const file = this.vault.getFileByPath(source.path);
    if (file === null || !source.matches(file) || !this.target.matches(file)) return { status: "failure", reason: "metadata-unavailable" };
    const context = evaluationContext(provenance, source);
    const record = this.records.get(file);
    if (this.disposed || !context || !record?.content) return { status: "failure", reason: "freshness-unverified" };
    if (!record.source.matches(file) || !sameContent(context.content, record.content) ||
      record.revision.mtime !== file.stat.mtime || record.revision.size !== file.stat.size ||
      context.revision.mtime !== file.stat.mtime || context.revision.size !== file.stat.size) {
      return { status: "failure", reason: "metadata-stale" };
    }
    return { status: "verified", proof: record.proof, existingTags: record.existingTags, frontmatterTags: record.frontmatterTags };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.metadata.offref(this.event);
    this.records = new WeakMap();
  }
}
