import { TFile, type Vault } from "obsidian";

import { ClassificationCancelledError, throwIfCancelled } from "../classification/classification-cancellation";
import type { NoteState } from "../note-service";
import type { NoteSource } from "../note-source";
import type { NoteSnapshot, OrganizationTarget } from "./target-file-collector";

export type OrganizationNoteReadResult =
  | { readonly status: "ready"; readonly source: NoteSource; readonly snapshot: NoteSnapshot; readonly note: Readonly<NoteState> }
  | { readonly status: "cancelled" }
  | { readonly status: "failure"; readonly reason: "source-changed" | "read-failed" };

/** 明示的に要求されたexact targetだけを読み、本文を保存しない境界。 */
export class OrganizationTargetReader {
  constructor(private readonly vault: Pick<Vault, "getAbstractFileByPath" | "read">) {}

  async read(target: OrganizationTarget, signal?: AbortSignal): Promise<OrganizationNoteReadResult> {
    try {
      throwIfCancelled(signal);
      const { source } = target;
      const snapshot = Object.freeze({ ...target.snapshot });
      const file = this.resolve(source, snapshot);
      throwIfCancelled(signal);
      if (file === null) return { status: "failure", reason: "source-changed" };
      const title = file.basename;
      throwIfCancelled(signal);
      const body = await this.vault.read(file);
      // Vault.read自体は中断できない。完了後に古い本文をSecret/providerへ渡すことを防ぐ。
      throwIfCancelled(signal);
      const current = this.resolve(source, snapshot);
      throwIfCancelled(signal);
      if (current !== file) return { status: "failure", reason: "source-changed" };
      return Object.freeze({
        status: "ready", source, snapshot,
        note: Object.freeze({ title, path: snapshot.path, body }),
      });
    } catch (error: unknown) {
      if (signal?.aborted || error instanceof ClassificationCancelledError) return { status: "cancelled" };
      // read例外に含まれ得る本文・絶対path・内部情報を結果やlogへ渡さない。
      return { status: "failure", reason: "read-failed" };
    }
  }

  private resolve(source: NoteSource, snapshot: NoteSnapshot): TFile | null {
    try {
      const file = this.vault.getAbstractFileByPath(source.path);
      if (!(file instanceof TFile) || !source.matches(file) ||
        source.path !== snapshot.path || file.path !== snapshot.path ||
        file.extension.toLowerCase() !== "md" || !file.stat ||
        !Number.isFinite(file.stat.mtime) || !Number.isFinite(file.stat.size) || file.stat.size < 0 ||
        file.stat.mtime !== snapshot.mtime || file.stat.size !== snapshot.size) return null;
      return file;
    } catch {
      return null;
    }
  }
}
