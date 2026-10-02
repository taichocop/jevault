import type { Vault } from "obsidian";

import type { NoteSource } from "../../src/note-source";
import { resolveTagApplySource } from "../../src/tags/tag-apply-authorization";

type Helpers = Pick<typeof import("obsidian"), "getFrontMatterInfo">;
type ProbeVault = Pick<Vault, "getFileByPath" | "process">;
export type TransactionProbeResult = "accepted-subset" | "rejected" | "cancelled" | "failure";

/** parserではなくsupplied stringの限定absence条件。transaction/saveの安全性は証明しない。 */
export function restrictedTagAbsence(content: string, helpers: Helpers): boolean {
  try {
    // BOMや不明なdelimiterは未検証なので拒否。heading/code/URLの#も一律拒否する。
    if (content.includes("#") || content.startsWith("\uFEFF") || content.startsWith("---")) return false;
    return helpers.getFrontMatterInfo(content)?.exists === false;
  } catch {
    return false;
  }
}

/** fake Vault専用。identity/check/transformを同一同期callbackへ置く実験で、production認可ではない。 */
export async function probeRestrictedTransaction(
  vault: ProbeVault,
  source: NoteSource,
  helpers: Helpers,
  signal: AbortSignal,
  transform: (content: string) => string,
): Promise<TransactionProbeResult> {
  if (signal.aborted) return "cancelled";
  try {
    const file = resolveTagApplySource(vault, source);
    if (signal.aborted) return "cancelled";
    if (!file) return "rejected";
    // API開始前の最後の検証からawaitを挟まない。開始後abortは独自rollbackにしない。
    if (resolveTagApplySource(vault, source) !== file) return "rejected";
    if (signal.aborted) return "cancelled";
    await vault.process(file, content => {
      if (resolveTagApplySource(vault, source) !== file || !restrictedTagAbsence(content, helpers)) {
        throw new Error("Spike transaction rejected");
      }
      return transform(content);
    });
    return "accepted-subset";
  } catch {
    // callback/API例外の本文・pathを返さず、retry/fallbackもしない。
    return "failure";
  }
}
