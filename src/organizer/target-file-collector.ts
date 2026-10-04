import { TFile, TFolder, type Vault } from "obsidian";

import { NoteSource } from "../note-source";
import type { JevaultSettings } from "../settings";
import { isExcludedPath, normalizeVaultPath } from "../vault-service";
import type { OrganizationScope } from "./organization-scope";

export interface NoteSnapshot {
  readonly path: string;
  readonly mtime: number;
  readonly size: number;
}

export interface OrganizationTarget {
  readonly source: NoteSource;
  readonly snapshot: NoteSnapshot;
}

export type TargetCollectionResult =
  | { status: "collected"; targets: readonly OrganizationTarget[] }
  | { status: "cancelled" }
  | { status: "failure"; reason: "scope-changed" | "scope-excluded" | "invalid-target" };

/** 本文・provider・Secret・mutationへの参照を持たない同期収集境界。 */
export class TargetFileCollector {
  constructor(private readonly vault: Pick<Vault, "configDir" | "getAbstractFileByPath">) {}

  collect(
    scope: OrganizationScope,
    settings: Pick<JevaultSettings, "ignoredFolders">,
    signal?: AbortSignal,
  ): TargetCollectionResult {
    if (signal?.aborted) return { status: "cancelled" };
    const root = this.resolveRoot(scope);
    if (root === null) return { status: "failure", reason: "scope-changed" };

    try {
      // Inboxは分類先の除外であり、整理元の除外には含めない。
      const excludedPaths = [this.vault.configDir, ...settings.ignoredFolders]
        .map(normalizeVaultPath).filter(path => path.length > 0);
      const excluded = (path: string) => isExcludedPath(normalizeVaultPath(path), excludedPaths);
      if (excluded(root.path)) return { status: "failure", reason: "scope-excluded" };

      const pending = [root];
      const folders = new Set<TFolder>();
      const targets = new Map<string, OrganizationTarget>();
      while (pending.length > 0) {
        if (signal?.aborted) return { status: "cancelled" };
        const folder = pending.pop()!;
        if (folders.has(folder) || this.vault.getAbstractFileByPath(folder.path) !== folder) {
          return { status: "failure", reason: "invalid-target" };
        }
        folders.add(folder);
        for (const child of folder.children) {
          if (signal?.aborted) return { status: "cancelled" };
          if (excluded(child.path)) continue;
          if (child instanceof TFolder && !scope.includeSubfolders) continue;
          // childrenの異常でscope外のNoteや循環treeを有効な対象として返さない。
          const prefix = folder.path === "/" ? "" : `${folder.path}/`;
          const name = child.path.slice(prefix.length);
          if (!child.path.startsWith(prefix) || name.length === 0 || name.includes("/") ||
            name === "." || name === ".." || /[\\:]/.test(name) ||
            this.vault.getAbstractFileByPath(child.path) !== child) {
            return { status: "failure", reason: "invalid-target" };
          }
          if (child instanceof TFolder) {
            pending.push(child);
          } else if (child instanceof TFile) {
            if (child.extension.toLowerCase() !== "md") continue;
            const source = new NoteSource(child);
            const revision = source.revision;
            if (revision === undefined || targets.has(source.path)) {
              return { status: "failure", reason: "invalid-target" };
            }
            const snapshot = Object.freeze({ path: source.path, ...revision });
            targets.set(source.path, Object.freeze({ source, snapshot }));
          } else {
            return { status: "failure", reason: "invalid-target" };
          }
        }
      }
      if (signal?.aborted) return { status: "cancelled" };
      if (this.resolveRoot(scope) === null) return { status: "failure", reason: "scope-changed" };
      for (const { source } of targets.values()) {
        const file = this.vault.getAbstractFileByPath(source.path);
        if (!(file instanceof TFile) || !source.matches(file)) {
          return { status: "failure", reason: "invalid-target" };
        }
      }
      // localeやchildren挿入順へ依存しない、Vault相対pathの明示的な昇順。
      const sorted = [...targets.values()].sort((a, b) =>
        a.snapshot.path < b.snapshot.path ? -1 : a.snapshot.path > b.snapshot.path ? 1 : 0);
      return { status: "collected", targets: Object.freeze(sorted) };
    } catch {
      // Obsidian例外の絶対pathや内部情報を呼び出し元へ露出しない。
      return { status: "failure", reason: "invalid-target" };
    }
  }

  private resolveRoot(scope: OrganizationScope): TFolder | null {
    try {
      const folder = this.vault.getAbstractFileByPath(scope.rootFolderPath);
      return folder instanceof TFolder && scope.matches(folder) ? folder : null;
    } catch {
      return null;
    }
  }
}
