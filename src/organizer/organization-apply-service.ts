import { TFile, type FileManager, type Vault } from "obsidian";
import { NoteSource } from "../note-source";
import { createMovePlan, moveValidatedSource, validateMoveSource } from "../note-move-service";
import type { JevaultSettings } from "../settings";
import { addSelectedFrontmatterTags } from "../tags/additive-frontmatter-tags";
import { acquireVaultMutationLease, type VaultMutationLease } from "../vault-mutation-coordinator";
import { VaultService } from "../vault-service";
import {
  consumeOrganizationApplyIntent, isActiveOrganizationApplyIntent, pendingOrganizationApplyReview, type ConfirmedOrganizationApplyIntent,
} from "./organization-apply-confirmation";
import {
  organizationApplyProgress, organizationNoteResult, type OrganizationApplyProgress, type OrganizationApplyReason,
  type OrganizationApplyResult, type OrganizationMoveStatus, type OrganizationNoteApplyResult, type OrganizationTagStatus,
} from "./organization-apply-result";
import type { ReviewedOrganizationNote } from "./organization-review-session";
import type { NoteSnapshot } from "./target-file-collector";

type ApplyVault = Pick<Vault, "getAbstractFileByPath" | "configDir" | "getAllFolders">;
type ApplySettings = Pick<JevaultSettings, "inboxPath" | "ignoredFolders">;
type StopReason = "invalid-confirmation" | "invariant";
class GuardFailure extends Error {
  constructor(readonly reason: "stale" | "cancelled" | StopReason) { super("Apply validation failed"); }
}

/** 本文を読まず、元identity/path/Markdownと非負statだけを解決する。 */
function sourceAt(vault: ApplyVault, source: NoteSource): TFile | null {
  const file = vault.getAbstractFileByPath(source.path);
  return file instanceof TFile && source.matches(file) && file.extension.toLowerCase() === "md" &&
    createMovePlan(source.path, "/") !== null && file.name === source.path.split("/").at(-1) &&
    !!file.stat && Number.isFinite(file.stat.mtime) && file.stat.mtime >= 0 &&
    Number.isFinite(file.stat.size) && file.stat.size >= 0 ? file : null;
}
function strictSource(vault: ApplyVault, source: NoteSource, snapshot: NoteSnapshot): TFile | null {
  const file = sourceAt(vault, source);
  return file && snapshot.path === source.path && file.stat.mtime === snapshot.mtime &&
    file.stat.size === snapshot.size ? file : null;
}

/** dormant core。Review結果は認可ではなく、専用確認と共有leaseの下でだけ変更する。 */
export class OrganizationApplyService {
  private readonly folders: VaultService;
  constructor(
    private readonly vault: ApplyVault,
    private readonly manager: Pick<FileManager, "processFrontMatter" | "renameFile">,
    private readonly getSettings: () => ApplySettings,
  ) { this.folders = new VaultService(vault); }

  async apply(
    intent: ConfirmedOrganizationApplyIntent,
    signal: AbortSignal,
    onProgress?: (progress: OrganizationApplyProgress) => void,
  ): Promise<OrganizationApplyResult> {
    const results: OrganizationNoteApplyResult[] = [];
    let total = 0;
    const finish = (status: OrganizationApplyResult["status"], reason?: OrganizationApplyResult["reason"]): OrganizationApplyResult =>
      Object.freeze({ status, ...(reason ? { reason } : {}), results: Object.freeze([...results]),
        progress: organizationApplyProgress(total, results) });
    try {
      if (signal.aborted) {
        total = pendingOrganizationApplyReview(intent, this.vault)?.reviewed.length ?? 0;
        return finish("cancelled");
      }
      const review = consumeOrganizationApplyIntent(intent, this.vault, signal);
      if (!review) return finish("stopped", "invalid-confirmation");
      total = review.reviewed.length;
      if (total === 0) return finish("stopped", "invalid-input");
      onProgress?.(organizationApplyProgress(total, results));
      for (const [index, note] of review.reviewed.entries()) {
        // 次Noteの処理開始前取消は、そのuntouched Noteの架空結果を作らない。
        if (!isActiveOrganizationApplyIntent(intent, this.vault)) return finish("stopped", "invalid-confirmation");
        if (signal.aborted) return finish("cancelled");
        if (!(note.source instanceof NoteSource) || note.reviewStatus !== "reviewed" ||
          !Array.isArray(note.selectedTags) || note.selectedTags.some(name => typeof name !== "string" || !/^#[^#\s]+$/u.test(name))) {
          return finish("stopped", "invalid-input");
        }
        // 不正pathをprogressへ露出しない。source安全性はlease内でも検証する。
        const path = createMovePlan(note.source.path, "/") === null ? undefined : note.source.path;
        onProgress?.(organizationApplyProgress(total, results, path));
        if (!isActiveOrganizationApplyIntent(intent, this.vault)) return finish("stopped", "invalid-confirmation");
        if (signal.aborted) return finish("cancelled");
        const terminal = await this.applyNote(index, note, intent, signal);
        results.push(terminal.result);
        onProgress?.(organizationApplyProgress(total, results));
        if (terminal.stop) return finish("stopped", terminal.stop);
        if (!isActiveOrganizationApplyIntent(intent, this.vault)) return finish("stopped", "invalid-confirmation");
        if (signal.aborted) return finish("cancelled");
      }
      return finish("completed");
    } catch {
      // observer/内部異常は続行しない。完了済みtruthは消さず、raw例外も返さない。
      return finish("stopped", "invariant");
    }
  }

  private eligible(destination: string): boolean {
    return this.folders.getAvailableFolderPaths(this.getSettings()).includes(destination);
  }

  private async applyNote(
    index: number, note: ReviewedOrganizationNote, intent: ConfirmedOrganizationApplyIntent, signal: AbortSignal,
  ): Promise<{ result: OrganizationNoteApplyResult; stop?: StopReason }> {
    let tag: OrganizationTagStatus = note.selectedTags.length ? "not-started-prior-failure" : "not-selected";
    let move: OrganizationMoveStatus = note.folder.kind === "keep-current" ? "keep-current" : "not-started-prior-failure";
    let lease: VaultMutationLease | undefined;
    let tagStarted = false;
    const done = (reason?: OrganizationApplyReason, stop?: StopReason) =>
      ({ result: organizationNoteResult(index, tag, move, reason), ...(stop ? { stop } : {}) });
    const guard = (): void => {
      if (!isActiveOrganizationApplyIntent(intent, this.vault)) throw new GuardFailure("invalid-confirmation");
      if (signal.aborted) throw new GuardFailure("cancelled");
    };
    try {
      guard();
      const destination = note.folder.kind === "existing-folder" ? note.folder.path : undefined;
      const plan = destination === undefined ? undefined : createMovePlan(note.source.path, destination);
      if (destination !== undefined && !plan) { move = "failed"; return done("invalid-destination"); }
      lease = acquireVaultMutationLease(this.vault, note.source.path, plan?.targetPath);
      if (!lease) return done("busy");
      const file = strictSource(this.vault, note.source, note.snapshot);
      guard();
      if (!file) throw new GuardFailure("stale");
      if (!lease.bindSourceFile(file)) return done("busy");
      if (destination !== undefined) {
        const eligible = this.eligible(destination);
        const validation = validateMoveSource(this.vault, note.source, destination);
        guard();
        if (!eligible) { move = "failed"; return done("ineligible-destination"); }
        if (validation.status === "failure") {
          if (validation.reason === "source-changed") throw new GuardFailure("stale");
          move = "failed";
          return done(validation.reason === "collision" ? "collision" : "destination-missing");
        }
        if (validation.unchanged) move = "unchanged";
      }
      // eligibility/lookup中の再入を含め、Tag APIの直前にもoriginal guardを確認する。
      if (strictSource(this.vault, note.source, note.snapshot) !== file) throw new GuardFailure("stale");
      guard();
      let baseline: NoteSnapshot | undefined = note.snapshot;
      if (note.selectedTags.length > 0) {
        let additions: string[] = [];
        let callbackCount = 0;
        let callbackFailure: GuardFailure | undefined;
        const validateTag = (): void => {
          try {
            const current = strictSource(this.vault, note.source, note.snapshot);
            guard();
            if (current !== file) throw new GuardFailure("stale");
          } catch (error) {
            callbackFailure = error instanceof GuardFailure ? error : new GuardFailure("invariant");
            throw callbackFailure;
          }
        };
        try {
          tagStarted = true;
          await this.manager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
            callbackCount++;
            if (callbackCount !== 1) {
              callbackFailure = new GuardFailure("invariant"); throw callbackFailure;
            }
            validateTag();
            additions = addSelectedFrontmatterTags(frontmatter, note.selectedTags, validateTag);
          });
          if (callbackFailure) throw callbackFailure;
          if (callbackCount !== 1) throw new GuardFailure("invariant");
          tag = additions.length ? "applied" : "unchanged";
        } catch (error) {
          if (callbackFailure) throw callbackFailure;
          if (error instanceof GuardFailure) throw error;
          tag = "failed";
          move = "not-started-prior-failure";
          return done("tag-failed");
        }
        // unchangedでもAPIはstatを変更し得る。settlement後のexact sourceだけをbaselineにする。
        const post = sourceAt(this.vault, note.source);
        baseline = post ? Object.freeze({ path: note.source.path, mtime: post.stat.mtime, size: post.stat.size }) : undefined;
      }
      guard();
      if (!baseline || strictSource(this.vault, note.source, baseline) !== file) throw new GuardFailure("stale");
      guard();
      if (destination !== undefined) {
        if (!this.eligible(destination)) { guard(); move = "failed"; return done("ineligible-destination"); }
        const validation = validateMoveSource(this.vault, note.source, destination);
        guard();
        if (validation.status === "failure") {
          if (validation.reason === "source-changed") throw new GuardFailure("stale");
          move = "failed"; return done(validation.reason === "collision" ? "collision" : "destination-missing");
        }
        if (validation.unchanged) {
          if (strictSource(this.vault, note.source, baseline) !== file) throw new GuardFailure("stale");
          guard(); move = "unchanged";
        } else {
          let finalFailure: GuardFailure | undefined;
          let finalDestination: OrganizationApplyReason | undefined;
          const result = await moveValidatedSource(this.vault, this.manager, note.source, destination, signal, target => {
            try {
              const eligible = this.eligible(destination);
              const destinationCheck = validateMoveSource(this.vault, note.source, destination);
              const current = strictSource(this.vault, note.source, baseline!);
              guard();
              if (current !== file || target !== file) throw new GuardFailure("stale");
              if (!lease!.bindSourceFile(target)) throw new GuardFailure("invariant");
              if (!eligible) finalDestination = "ineligible-destination";
              else if (destinationCheck.status === "failure") {
                if (destinationCheck.reason === "source-changed") throw new GuardFailure("stale");
                finalDestination = destinationCheck.reason === "collision" ? "collision" : "destination-missing";
              }
              return finalDestination === undefined;
            } catch (error) {
              finalFailure = error instanceof GuardFailure ? error : new GuardFailure("invariant");
              return false;
            }
          }, () => { finalFailure = new GuardFailure("invariant"); });
          if (finalFailure) throw finalFailure;
          if (finalDestination) { move = "failed"; return done(finalDestination); }
          move = result.status === "moved" ? "applied" : result.status === "cancelled" ? "not-started-cancelled"
            : result.reason === "source-changed" ? "not-started-stale" : "failed";
          if (move === "not-started-stale") return done("stale");
          if (move === "failed") return done("move-failed");
        }
      }
      return done();
    } catch (error) {
      const reason = error instanceof GuardFailure ? error.reason : "invariant";
      // API開始後callbackで拒否した場合も、未開始と報告しない。
      if (tagStarted && tag === "not-started-prior-failure") {
        tag = reason === "cancelled" ? "interrupted-cancelled"
          : reason === "stale" ? "interrupted-stale"
            : reason === "invalid-confirmation" ? "interrupted-revoked" : "failed";
      }
      if (reason === "cancelled") {
        if (tag === "not-started-prior-failure") tag = "not-started-cancelled";
        if (move !== "applied") move = "not-started-cancelled";
        return done();
      }
      if (reason === "stale") {
        if (tag === "not-started-prior-failure") tag = "not-started-stale";
        if (move !== "applied") move = "not-started-stale";
        return done("stale");
      }
      if (move !== "applied") move = "not-started-prior-failure";
      return done(reason, reason);
    } finally {
      // 開始済みObsidian mutationをraceで打切らず、実settlementまで同一leaseを保持する。
      lease?.release();
    }
  }
}
