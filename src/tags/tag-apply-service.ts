import type { FileManager } from "obsidian";

import { acquireVaultMutationLease, type VaultMutationLease } from "../vault-mutation-coordinator";

import { addSelectedFrontmatterTags } from "./additive-frontmatter-tags";

import {
  resolveTagApplySource, type TagApplyFailureReason, type TagApplyVault,
} from "./tag-apply-authorization";
import { isSameTagIdentity } from "./tag-identity";
import {
  consumeConfirmedTagApplyIntent, isActiveConfirmedTagApplyIntent, type ConfirmedTagApplyIntent,
} from "./tag-apply-preparation";

export interface TagApplyRequest {
  readonly confirmation: ConfirmedTagApplyIntent;
}

export type TagApplyResult =
  | { status: "applied"; addedTags: readonly string[] }
  | { status: "no-change" }
  | { status: "cancelled" }
  | { status: "failure"; reason: TagApplyFailureReason };

/** UI未接続のmutation境界。active sessionで明示確認された一回限りのintentだけを受理する。 */
export class TagApplyService {
  constructor(
    private readonly vault: TagApplyVault,
    private readonly fileManager: Pick<FileManager, "processFrontMatter">,
  ) {}

  async apply(request: TagApplyRequest, signal: AbortSignal): Promise<TagApplyResult> {
    if (signal.aborted) return { status: "cancelled" };
    let lease: VaultMutationLease | undefined;
    let callbackFailure: TagApplyFailureReason | undefined;
    try {
      const confirmation = request?.confirmation;
      // entry abortだけはconsumeしない。受理後のbusy・source失効・abort・API失敗も一試行として消費する。
      if (!consumeConfirmedTagApplyIntent(confirmation, this.vault)) {
        return { status: "failure", reason: "invalid-confirmation" };
      }
      const { grant, selectedTags } = confirmation;
      // issuerの完全一致認可済みselectionだけをsemantic dedupeする。case同値で認可を広げない。
      const unique: string[] = [];
      for (const name of selectedTags) {
        if (!unique.some((earlier) => isSameTagIdentity(earlier, name))) unique.push(name);
      }
      if (signal.aborted) return { status: "cancelled" };
      lease = acquireVaultMutationLease(this.vault, grant.source.path);
      if (!lease) return { status: "failure", reason: "busy" };

      const file = resolveTagApplySource(this.vault, grant.source);
      if (signal.aborted) return { status: "cancelled" };
      if (file === null) return { status: "failure", reason: "source-changed" };
      if (!lease.bindSourceFile(file)) return { status: "failure", reason: "busy" };

      // 最終検証とAPI開始の間にawaitを置かない。本文revisionやfreshnessはmutation条件にしない。
      if (resolveTagApplySource(this.vault, grant.source) !== file) {
        return { status: "failure", reason: "source-changed" };
      }
      if (!isActiveConfirmedTagApplyIntent(confirmation, this.vault)) return { status: "failure", reason: "invalid-confirmation" };
      if (signal.aborted) return { status: "cancelled" };
      let additions: string[] = [];
      await this.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        // API内部のread待ち中のtarget変更・session/Grant失効もassignment前に拒否する。
        if (resolveTagApplySource(this.vault, grant.source) !== file) callbackFailure = "source-changed";
        else if (!isActiveConfirmedTagApplyIntent(confirmation, this.vault)) callbackFailure = "invalid-confirmation";
        if (callbackFailure) throw new Error("Tag apply validation failed");
        additions = addSelectedFrontmatterTags(frontmatter, unique, () => {
          if (resolveTagApplySource(this.vault, grant.source) !== file) callbackFailure = "source-changed";
          else if (!isActiveConfirmedTagApplyIntent(confirmation, this.vault)) callbackFailure = "invalid-confirmation";
          if (callbackFailure) throw new Error("Tag apply validation failed");
        });
      });
      return additions.length === 0 ? { status: "no-change" } : { status: "applied", addedTags: additions };
    } catch {
      // raw例外には本文・絶対path等が入り得るため公開しない。開始後のrollback・自動retryはしない。
      return { status: "failure", reason: callbackFailure ?? "unexpected" };
    } finally {
      // Abortでは早期解放せず、開始済みObsidian APIの実際のsettlementまで保持する。
      lease?.release();
    }
  }
}
