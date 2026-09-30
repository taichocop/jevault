import { getAllTags } from "obsidian";
import type { MetadataCache, Vault } from "obsidian";

import type { NoteSource } from "../note-source";

export type ExistingTagSnapshot =
  | { status: "available"; names: readonly string[] }
  | { status: "unavailable" };

export interface ExistingTagSnapshotProvider {
  snapshot(source: NoteSource): ExistingTagSnapshot;
}

/** 評価元のidentityだけを信頼し、本文readへfallbackしないmetadata境界。 */
export class ExistingTagSnapshotService implements ExistingTagSnapshotProvider {
  constructor(
    private readonly vault: Pick<Vault, "getFileByPath">,
    private readonly metadataCache: Pick<MetadataCache, "getFileCache">,
  ) {}

  snapshot(source: NoteSource): ExistingTagSnapshot {
    const file = this.vault.getFileByPath(source.path);
    // 同一pathの別TFileやrename後を、元ノートのmetadataとして信用しない。
    if (file === null || !source.matches(file)) return { status: "unavailable" };
    const cache = this.metadataCache.getFileCache(file);
    if (cache === null) return { status: "unavailable" };
    return { status: "available", names: [...new Set(getAllTags(cache) ?? [])] };
  }
}
