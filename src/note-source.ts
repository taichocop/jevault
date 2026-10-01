import type { TFile } from "obsidian";

/** pathの再利用で別ノートを動かさないよう、分類開始時の同一オブジェクトも保持する。 */
export class NoteSource {
  readonly path: string;
  readonly revision?: Readonly<{ mtime: number; size: number }>;
  readonly #file: TFile;

  constructor(file: TFile) {
    this.path = file.path;
    this.#file = file;
    // 本文read前のrevisionを保持し、read後の新statと古い評価本文を混ぜない。
    if (file.stat && Number.isFinite(file.stat.mtime) && Number.isFinite(file.stat.size) && file.stat.size >= 0) {
      this.revision = Object.freeze({ mtime: file.stat.mtime, size: file.stat.size });
    }
    Object.freeze(this);
  }

  matches(file: TFile): boolean {
    return file === this.#file && file.path === this.path;
  }
}
