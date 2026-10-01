import { getAllTags, parseFrontMatterTags, type MetadataCache, type TFile, type Vault } from "obsidian";

import { NoteSource } from "../note-source";
import { evaluationContext, fingerprintContent, sameContent, type ContentProvenance, type EvaluationProvenance } from "./evaluation-provenance";

export type VerifiedTagMetadata =
  | { status: "verified"; proof: object; existingTags: readonly string[]; frontmatterTags: readonly string[] }
  | { status: "failure"; reason: "metadata-unavailable" | "freshness-unverified" | "metadata-stale" };

export interface VerifiedTagMetadataProvider {
  snapshot(source: NoteSource, provenance: EvaluationProvenance | undefined): VerifiedTagMetadata;
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
  ) {
    this.event = metadata.on("changed", (file, data, cache) => {
      if (this.disposed) return;
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

  snapshot(source: NoteSource, provenance: EvaluationProvenance | undefined): VerifiedTagMetadata {
    const file = this.vault.getFileByPath(source.path);
    if (file === null || !source.matches(file)) return { status: "failure", reason: "metadata-unavailable" };
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
