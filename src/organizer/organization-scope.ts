import type { TFolder } from "obsidian";

/** path再利用で別Folderへ切り替わらないよう、選択時のidentityを操作中だけ保持する。 */
export class OrganizationScope {
  readonly rootFolderPath: string;
  readonly includeSubfolders: boolean;
  readonly #folder: TFolder;

  constructor(folder: TFolder, includeSubfolders: boolean) {
    this.#folder = folder;
    this.rootFolderPath = folder.path;
    this.includeSubfolders = includeSubfolders;
    Object.freeze(this);
  }

  matches(folder: TFolder): boolean {
    return folder === this.#folder && folder.path === this.rootFolderPath;
  }
}
