import { getAllTags } from "obsidian";
import type { MetadataCache, Vault } from "obsidian";

import type { TagCandidate } from "./tag-candidate";

/** 本文読み取り・変更・外部評価を持たない、既存Tagのmetadata-only収集境界。 */
export class TagDiscoveryService {
  constructor(
    private readonly vault: Pick<Vault, "getMarkdownFiles">,
    private readonly metadataCache: Pick<MetadataCache, "getFileCache">,
  ) {}

  discover(): TagCandidate[] {
    const names = new Set<string>();

    for (const file of this.vault.getMarkdownFiles()) {
      const cache = this.metadataCache.getFileCache(file);
      // cache未準備時も本文読み取りへfallbackせず、そのfileだけをskipする。
      if (!cache) continue;

      // inline/frontmatterの統合と表記はObsidianに委ね、完全一致だけを重複扱いする。
      for (const name of getAllTags(cache) ?? []) {
        names.add(name);
      }
    }

    // UTF-16 code unit順でlocale依存を避け、file順と無関係なID mappingを作る。
    return [...names].sort().map((name, index) => ({
      id: `tag_${String(index + 1).padStart(3, "0")}`,
      name,
    }));
  }
}
