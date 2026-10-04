import type { TFolder, Vault } from "obsidian";

import type { JevaultSettings } from "./settings";

type FolderExclusionSettings = Pick<
  JevaultSettings,
  "inboxPath" | "ignoredFolders"
>;

/** Vault相対pathを比較用に揃え、階層と日本語などの文字はそのまま保持する。 */
export function normalizeVaultPath(path: string): string {
  const normalizedPath = path.replace(/^\/+/, "").replace(/\/+$/, "");

  // 空白だけの設定値を除外条件にすると意図しない比較になるため、未設定として扱う。
  return normalizedPath.trim().length === 0 ? "" : normalizedPath;
}

export function isExcludedPath(
  candidatePath: string,
  excludedPaths: readonly string[],
): boolean {
  return excludedPaths.some(
    (excludedPath) =>
      candidatePath === excludedPath ||
      // 単純な startsWith では `InboxArchive` まで除外するため、`/` を挟む子孫だけを対象にする。
      candidatePath.startsWith(`${excludedPath}/`),
  );
}

/** Obsidianの読み取りAPIだけを使い、分類先として利用可能なFolder pathを取得する。 */
export class VaultService {
  constructor(private readonly vault: Pick<Vault, "configDir" | "getAllFolders">) {}

  getFolders(): TFolder[] {
    // rootは分類先ではないため、ObsidianのAPI段階で候補から外す。
    return this.vault.getAllFolders(false);
  }

  getAvailableFolderPaths(settings: FolderExclusionSettings): string[] {
    // configDirはユーザー設定とは独立した必須除外。候補生成より前に毎回Vaultから取得する。
    const excludedPaths = [
      this.vault.configDir,
      settings.inboxPath,
      ...settings.ignoredFolders,
    ]
      .map(normalizeVaultPath)
      // 空の除外pathは全Folderへ一致し得るため、比較対象へ含めない。
      .filter((path) => path.length > 0);

    return this.getFolders()
      // basenameではnested folderを区別できないため、Vault相対pathを保持する。
      .map((folder) => normalizeVaultPath(folder.path))
      .filter(
        (path) => path.length > 0 && !isExcludedPath(path, excludedPaths),
      );
  }
}
