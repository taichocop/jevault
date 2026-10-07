import { TFile, type FileManager, type Vault } from "obsidian";

import { NoteSource } from "../../src/note-source";
import {
  acquireVaultMutationLease, vaultMutationPathKey, type VaultMutationLease,
} from "../../src/vault-mutation-coordinator";
import { createMovePlan, moveValidatedSource } from "../../src/note-move-service";
import { addSelectedFrontmatterTags } from "../../src/tags/additive-frontmatter-tags";
import type { NoteSnapshot } from "../../src/organizer/target-file-collector";
import {
  OrganizationReviewSession, type OrganizationReviewResult,
} from "../../src/organizer/organization-review-session";

// Issue #103専用。productionからimportせず、UIや自動処理へ接続しない。
export type SpikeVault = Pick<Vault, "getAbstractFileByPath">;
export interface ConfirmedOrganizationApplyIntent { readonly kind: "organizer-confirmation" }
interface ConfirmationRecord {
  vault: SpikeVault;
  review: OrganizationReviewResult;
  active: () => boolean;
  consumed: boolean;
}
const confirmations = new WeakMap<object, ConfirmationRecord>();

export class OrganizerConfirmationSession {
  private disposed = false;
  private readonly review: OrganizationReviewResult | undefined;
  constructor(private readonly vault: SpikeVault, private readonly owner: OrganizationReviewSession) {
    this.review = owner instanceof OrganizationReviewSession ? owner.getResult() : undefined;
  }
  /** 将来のfinal user confirmationのみが呼ぶ発行境界。Review完了では呼ばない。 */
  confirm(): ConfirmedOrganizationApplyIntent | undefined {
    if (!this.review || this.disposed || this.owner.getResult() !== this.review) return undefined;
    const intent = Object.freeze({ kind: "organizer-confirmation" as const });
    confirmations.set(intent, { vault: this.vault, review: this.review, consumed: false,
      active: () => !this.disposed && this.owner.getResult() === this.review });
    return intent;
  }
  dispose(): void { this.disposed = true; }
}

export function acceptedReview(intent: unknown, vault: SpikeVault, signal: AbortSignal): OrganizationReviewResult | undefined {
  if (signal.aborted || typeof intent !== "object" || intent === null) return undefined;
  const record = confirmations.get(intent);
  if (!record || record.vault !== vault || !record.active() || record.consumed) return undefined;
  record.consumed = true;
  return record.review;
}
function active(intent: object, vault: SpikeVault): boolean {
  const record = confirmations.get(intent);
  return !!record && record.vault === vault && record.active();
}

export function sourceAt(vault: SpikeVault, source: NoteSource): TFile | null {
  const file = vault.getAbstractFileByPath(source.path);
  return file instanceof TFile && source.matches(file) && file.extension.toLowerCase() === "md" &&
    createMovePlan(source.path, "/") !== null && file.name === source.path.split("/").at(-1) &&
    !!file.stat && Number.isFinite(file.stat.mtime) && Number.isFinite(file.stat.size) && file.stat.size >= 0 ? file : null;
}
export function strictSource(vault: SpikeVault, source: NoteSource, snapshot: NoteSnapshot, signal: AbortSignal): TFile | null {
  const file = sourceAt(vault, source);
  return !signal.aborted && file && snapshot.path === source.path &&
    snapshot.mtime === file.stat.mtime && snapshot.size === file.stat.size ? file : null;
}
export function captureBaseline(vault: SpikeVault, source: NoteSource): Readonly<NoteSnapshot> | undefined {
  const file = sourceAt(vault, source);
  return file ? Object.freeze({ path: source.path, mtime: file.stat.mtime, size: file.stat.size }) : undefined;
}

export const mutationKey = vaultMutationPathKey;
export type MutationLease = VaultMutationLease;
/** #103 runnerもproductionの排他を使い、別のlock domainを作らない。 */
export function acquireLease(vault: SpikeVault, source: NoteSource, targetPath?: string): MutationLease | undefined {
  const file = vault.getAbstractFileByPath(source.path);
  const identity = file instanceof TFile && source.matches(file) ? file : undefined;
  return acquireVaultMutationLease(vault, source.path, targetPath, identity);
}
export async function underLease<T>(vault: SpikeVault, source: NoteSource, target: string | undefined, action: () => Promise<T>): Promise<T | "busy"> {
  const lease = acquireLease(vault, source, target);
  if (!lease) return "busy";
  try { return await action(); } finally { lease.release(); }
}

export type TagTruth = "not-selected" | "unchanged" | "applied" | "failed" | "not-started-cancelled" | "not-started-stale" | "not-started-prior-failure";
export type MoveTruth = "keep-current" | "applied" | "failed" | "not-started-prior-failure" | "not-started-cancelled" | "not-started-stale";
export type FailureCode = "busy" | "destination" | "tag" | "move" | "stale" | "invariant";
export interface NoteTruth {
  readonly index: number;
  readonly tag: TagTruth;
  readonly move: MoveTruth;
  readonly outcome: "unchanged" | "updated-tags" | "moved" | "moved-and-tags" | "stale" | "partial" | "failed" | "cancelled" | "cancelled-after-partial";
  readonly reason?: FailureCode;
}
export interface OperationTruth {
  readonly status: "completed" | "cancelled" | "stopped";
  readonly results: readonly NoteTruth[];
  readonly reason?: "invalid-confirmation" | "invariant";
}
export function noteTruth(index: number, tag: TagTruth, move: MoveTruth, reason?: FailureCode): NoteTruth {
  const changed = tag === "applied" || move === "applied";
  const cancelled = tag === "not-started-cancelled" || move === "not-started-cancelled";
  const failed = reason === "invariant" || reason === "destination" || reason === "busy" ||
    tag === "failed" || move === "failed" || move === "not-started-prior-failure";
  const stale = reason === "stale" || tag === "not-started-stale" || move === "not-started-stale";
  const outcome = cancelled ? changed ? "cancelled-after-partial" : "cancelled"
    : failed || stale ? changed ? "partial" : stale ? "stale" : "failed"
      : tag === "applied" ? move === "applied" ? "moved-and-tags" : "updated-tags"
        : move === "applied" ? "moved" : "unchanged";
  return Object.freeze({ index, tag, move, outcome, ...(reason ? { reason } : {}) });
}

export interface SpikeHooks {
  beforeNote?(index: number): void;
  beforeTag?(): void;
  afterTag?(baseline: Readonly<NoteSnapshot> | undefined): void;
  beforeMove?(): void;
}
type MutationAPIs = Pick<FileManager, "processFrontMatter" | "renameFile">;

/** Synthetic試験だけのrunner。source+target leaseはTag→baseline→Move完了まで保持する。 */
export async function runConfirmedSpike(
  vault: SpikeVault, fileManager: MutationAPIs, confirmation: unknown,
  signal: AbortSignal, eligible: (path: string) => boolean, hooks: SpikeHooks = {},
): Promise<OperationTruth> {
  const results: NoteTruth[] = [];
  const finish = (status: OperationTruth["status"], reason?: OperationTruth["reason"]): OperationTruth =>
    Object.freeze({ status, results: Object.freeze([...results]), ...(reason ? { reason } : {}) });
  if (signal.aborted) return finish("cancelled");
  const review = acceptedReview(confirmation, vault, signal);
  if (!review) return finish("stopped", "invalid-confirmation");
  for (const [index, note] of review.reviewed.entries()) {
    let tag: TagTruth = note.selectedTags.length ? "not-started-prior-failure" : "not-selected";
    let move: MoveTruth = note.folder.kind === "keep-current" ? "keep-current" : "not-started-prior-failure";
    let lease: MutationLease | undefined;
    try {
      hooks.beforeNote?.(index);
      const stop = (): boolean => signal.aborted;
      const cancellation = (): NoteTruth => noteTruth(index,
        tag === "applied" || tag === "unchanged" || tag === "not-selected" ? tag : "not-started-cancelled",
        move === "keep-current" ? move : "not-started-cancelled");
      if (stop()) { results.push(cancellation()); return finish("cancelled"); }
      if (!active(confirmation as object, vault)) return finish("stopped", "invalid-confirmation");
      const destination = note.folder.kind === "existing-folder" ? note.folder.path : undefined;
      const plan = destination === undefined ? undefined : createMovePlan(note.source.path, destination);
      if (destination !== undefined && !plan) {
        results.push(noteTruth(index, tag, "failed", "destination")); continue;
      }
      lease = acquireLease(vault, note.source, plan?.targetPath);
      if (!lease) { results.push(noteTruth(index, note.selectedTags.length ? "failed" : tag,
        move === "keep-current" ? move : "not-started-prior-failure", "busy")); continue; }
      const file = strictSource(vault, note.source, note.snapshot, signal);
      if (stop()) { results.push(cancellation()); return finish("cancelled"); }
      if (!file) { results.push(noteTruth(index, note.selectedTags.length ? "not-started-stale" : tag,
        destination === undefined ? move : "not-started-stale", "stale")); continue; }
      // 同じvalidated Move境界をdry runし、Tag開始前のdestination/collisionを確認する。
      const destinationValid = async (): Promise<boolean> => {
        if (destination === undefined) return true;
        if (!eligible(destination)) return false;
        const check = await moveValidatedSource(vault, { renameFile: async () => {} }, note.source, destination, signal);
        return check.status === "moved";
      };
      const destinationReady = await destinationValid();
      if (stop()) { results.push(cancellation()); return finish("cancelled"); }
      // negative prevalidationのawait中に失効しても、local failureへ丸めて続行しない。
      if (!active(confirmation as object, vault)) {
        results.push(noteTruth(index, tag, move, "invariant"));
        return finish("stopped", "invalid-confirmation");
      }
      if (!destinationReady) {
        results.push(noteTruth(index, tag, "failed", "destination")); continue;
      }
      hooks.beforeTag?.();
      if (stop()) { results.push(cancellation()); return finish("cancelled"); }
      if (strictSource(vault, note.source, note.snapshot, signal) !== file) {
        results.push(noteTruth(index, note.selectedTags.length ? "not-started-stale" : tag,
          destination === undefined ? move : "not-started-stale", "stale")); continue;
      }
      if (!active(confirmation as object, vault)) {
        results.push(noteTruth(index, tag, move, "invariant"));
        return finish("stopped", "invalid-confirmation");
      }
      let baseline: Readonly<NoteSnapshot> | undefined = note.snapshot;
      if (note.selectedTags.length > 0) {
        let added: string[] = [];
        try {
          const validate = (): void => {
            if (!active(confirmation as object, vault) || sourceAt(vault, note.source) !== file ||
              file.stat.mtime !== note.snapshot.mtime || file.stat.size !== note.snapshot.size) {
              throw new Error("Spike validation failed");
            }
          };
          await fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
            validate();
            added = addSelectedFrontmatterTags(frontmatter, note.selectedTags, validate);
          });
          tag = added.length ? "applied" : "unchanged";
        } catch {
          tag = "failed";
          move = destination === undefined ? "keep-current" : "not-started-prior-failure";
          // lifetime失効はtarget-local API失敗と区別し、残りNoteへ続行しない。
          if (!active(confirmation as object, vault)) {
            results.push(noteTruth(index, tag, move, "invariant"));
            return finish("stopped", "invalid-confirmation");
          }
          results.push(noteTruth(index, tag, move, "tag"));
          if (stop()) return finish("cancelled");
          continue;
        }
        baseline = captureBaseline(vault, note.source);
      }
      hooks.afterTag?.(baseline);
      if (stop()) { results.push(cancellation()); return finish("cancelled"); }
      if (!active(confirmation as object, vault)) {
        results.push(noteTruth(index, tag, destination === undefined ? "keep-current" : "not-started-prior-failure", "invariant"));
        return finish("stopped", "invalid-confirmation");
      }
      if (destination !== undefined) {
        hooks.beforeMove?.();
        if (stop()) { results.push(cancellation()); return finish("cancelled"); }
        if (!active(confirmation as object, vault)) {
          results.push(noteTruth(index, tag, "not-started-prior-failure", "invariant"));
          return finish("stopped", "invalid-confirmation");
        }
        if (!baseline || !strictSource(vault, note.source, baseline, signal)) {
          results.push(noteTruth(index, tag, "not-started-stale", "stale")); continue;
        }
        if (!eligible(destination)) { results.push(noteTruth(index, tag, "failed", "destination")); continue; }
        let lifetimeInvalid = false;
        const result = await moveValidatedSource(vault, fileManager, note.source, destination, signal, target => {
          const valid = strictSource(vault, note.source, baseline!, signal) === target && eligible(destination);
          // 最終lookup/eligibility境界の再入失効も、API開始前にfail closedとする。
          lifetimeInvalid = !active(confirmation as object, vault);
          return valid && !lifetimeInvalid;
        });
        if (lifetimeInvalid) {
          results.push(noteTruth(index, tag, "not-started-prior-failure", "invariant"));
          return finish("stopped", "invalid-confirmation");
        }
        move = result.status === "moved" ? "applied" : result.status === "cancelled" ? "not-started-cancelled"
          : result.reason === "source-changed" ? "not-started-stale" : "failed";
      }
      results.push(noteTruth(index, tag, move, move === "failed" ? "move" : undefined));
      if (stop()) return finish("cancelled");
      if (!active(confirmation as object, vault)) return finish("stopped", "invalid-confirmation");
    } catch {
      // 想定外のcoordinator/内部異常は続行しない。成功済みmutation truthは保持する。
      results.push(noteTruth(index, tag, move === "keep-current" ? move : "not-started-prior-failure", "invariant"));
      return finish("stopped", "invariant");
    } finally { lease?.release(); }
  }
  return finish("completed");
}

/** Apply progressはterminal truthだけから導出し、analysisのfailed定義を流用しない。 */
export function applyProgress(total: number, result: OperationTruth): Readonly<{ total: number; processed: number; failed: number; stale: number }> {
  return Object.freeze({ total, processed: result.results.length,
    failed: result.results.filter(note => note.tag === "failed" || note.move === "failed" ||
      note.reason === "invariant" || note.reason === "busy").length,
    stale: result.results.filter(note => note.reason === "stale" || note.tag === "not-started-stale" || note.move === "not-started-stale").length });
}

export function syntheticReview(files: readonly TFile[], tags: readonly string[] = ["#reviewed"], destination: string | null = "Dest"): OrganizationReviewSession {
  const notes = files.map(file => {
    const source = new NoteSource(file);
    return Object.freeze({ source, snapshot: Object.freeze({ path: file.path, mtime: file.stat.mtime, size: file.stat.size }),
      status: "success" as const, folder: Object.freeze({ status: "not-run" as const, reason: "disabled" as const }),
      tags: Object.freeze({ status: "success" as const, value: Object.freeze({ status: "success" as const,
        source, noteTitle: "Synthetic", suggestions: Object.freeze([]) }) }) });
  });
  const session = new OrganizationReviewSession(Object.freeze({ status: "completed", results: Object.freeze(notes),
    progress: Object.freeze({ total: files.length, processed: files.length, failed: 0 }) }),
  destination === null ? [] : [destination], tags, files.map(() => ({ status: "unavailable" })));
  notes.forEach((_, index) => {
    session.selectFolder(index, destination === null ? { kind: "keep-current" } : { kind: "existing-folder", path: destination });
    tags.forEach(tag => session.selectTag(index, tag, true));
  });
  session.finish();
  return session;
}
