import { normalizePath, TFile, TFolder, type FileManager, type Vault } from "obsidian";

import type { NoteSource } from "./note-source";
import { acquireVaultMutationLease } from "./vault-mutation-coordinator";

export interface MovePlan {
  readonly sourcePath: string;
  readonly destination: string;
  readonly targetPath: string;
}

export const MOVE_MESSAGES = {
  "invalid-destination": "This destination is no longer a valid suggestion.",
  "source-changed": "The classified note no longer exists at its original path. Classify it again.",
  "destination-missing": "The destination folder no longer exists.",
  collision: "A file or folder already exists at the destination path. Nothing was overwritten.",
  "already-in-folder": "This note is already in this folder.",
  busy: "A move involving this note or destination is already in progress.",
  unexpected: "Jevault couldn't complete the move. Check the note's location before trying again.",
} as const;

export type MoveResult =
  | { status: "moved"; destination: string }
  | { status: "cancelled" }
  | { status: "failure"; reason: keyof typeof MOVE_MESSAGES };

function isSafePath(path: string): boolean {
  return path.length > 0 && !/[\\:]/.test(path) &&
    !Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..") &&
    normalizePath(path) === path;
}

/** normalizationで危険な入力を別pathへ修正せず、正規のVault pathだけを受け付ける。 */
export function createMovePlan(sourcePath: string, destination: string): MovePlan | null {
  if (!isSafePath(sourcePath) || (destination !== "/" && !isSafePath(destination))) {
    return null;
  }
  const filename = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  const targetPath = normalizePath(destination === "/" ? filename : `${destination}/${filename}`);
  if (!isSafePath(targetPath)) {
    return null;
  }
  return Object.freeze({ sourcePath, destination, targetPath });
}

function pathKey(path: string): string {
  // 大文字小文字・Unicode表現だけが異なる既存名も保守的に衝突とする。
  return path.normalize("NFC").toLowerCase();
}

export type MoveValidation =
  | { readonly status: "validated"; readonly file: TFile; readonly plan: MovePlan; readonly unchanged: boolean }
  | Extract<MoveResult, { status: "failure" }>;

/** Tag前にも使える非変更検証。Manual Moveの認可やmutation APIを代用しない。 */
export function validateMoveSource(
  vault: Pick<Vault, "getAbstractFileByPath">,
  source: NoteSource,
  destination: string,
): MoveValidation {
  const plan = createMovePlan(source.path, destination);
  if (plan === null) return { status: "failure", reason: "invalid-destination" };
  const file = vault.getAbstractFileByPath(source.path);
  if (!(file instanceof TFile) || !source.matches(file) ||
    file.extension.toLowerCase() !== "md" ||
    file.name !== source.path.slice(source.path.lastIndexOf("/") + 1)) {
    return { status: "failure", reason: "source-changed" };
  }
  const folder = vault.getAbstractFileByPath(destination);
  if (!(folder instanceof TFolder) || folder.path !== destination) {
    return { status: "failure", reason: "destination-missing" };
  }
  const unchanged = source.path === plan.targetPath;
  if (!unchanged && (vault.getAbstractFileByPath(plan.targetPath) !== null ||
    folder.children.some((child) => pathKey(child.name) === pathKey(file.name)))) {
    return { status: "failure", reason: "collision" };
  }
  return { status: "validated", file, plan, unchanged };
}

/** 認可とlockの下で共有する境界。検証からrenameFile開始までawaitを置かない。 */
export async function moveValidatedSource(
  vault: Pick<Vault, "getAbstractFileByPath">,
  fileManager: Pick<FileManager, "renameFile">,
  source: NoteSource,
  destination: string,
  signal: AbortSignal,
  validateRevision: (file: TFile) => boolean = () => true,
  onValidationError?: () => void,
): Promise<MoveResult> {
  let mutationStarted = false;
  try {
    const validated = validateMoveSource(vault, source, destination);
    if (validated.status === "failure") return validated;
    const { file, plan } = validated;
    if (validated.unchanged) return { status: "failure", reason: "already-in-folder" };
    if (!validateRevision(file)) return { status: "failure", reason: "source-changed" };
    // 最終確認からAPI呼出しまでawaitを挟まない。開始後は取消や独自rollbackを行わない。
    if (signal.aborted) return { status: "cancelled" };
    mutationStarted = true;
    await fileManager.renameFile(file, plan.targetPath);
    return { status: "moved", destination };
  } catch {
    // Organizerは検証内部異常で全体停止し、API開始後のrename失敗とは区別する。
    if (!mutationStarted) onValidationError?.();
    return { status: "failure", reason: "unexpected" };
  }
}

/** 確認後の検証と唯一のVault mutationを担当し、active noteやclassifierには依存しない。 */
export class NoteMoveService {
  constructor(
    private readonly vault: Pick<Vault, "getAbstractFileByPath">,
    private readonly fileManager: Pick<FileManager, "renameFile">,
  ) {}

  async move(
    source: NoteSource,
    displayedPaths: readonly string[],
    destination: string,
    signal: AbortSignal,
  ): Promise<MoveResult> {
    if (signal.aborted) return { status: "cancelled" };
    const plan = createMovePlan(source.path, destination);
    if (plan === null || !displayedPaths.includes(destination)) {
      return { status: "failure", reason: "invalid-destination" };
    }
    const lease = acquireVaultMutationLease(this.vault, source.path, plan.targetPath);
    if (!lease) return { status: "failure", reason: "busy" };
    try {
      const file = this.vault.getAbstractFileByPath(source.path);
      if (file instanceof TFile && source.matches(file) && !lease.bindSourceFile(file)) {
        return { status: "failure", reason: "busy" };
      }
      let identityBusy = false;
      const result = await moveValidatedSource(this.vault, this.fileManager, source, destination, signal, validated => {
        // lookupの再入でsourceが現れた場合も、最後に解決したidentityをAPI開始前に予約する。
        identityBusy = !lease.bindSourceFile(validated);
        return !identityBusy;
      });
      return identityBusy ? { status: "failure", reason: "busy" } : result;
    } catch {
      // Obsidian例外には絶対path等が入り得るため、固定文言へ限定する。
      return { status: "failure", reason: "unexpected" };
    } finally {
      // 開始後の取消でもrenameFileの実際のsettlementまで保持する。
      lease.release();
    }
  }
}
