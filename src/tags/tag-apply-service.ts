import { parseFrontMatterTags, type FileManager, type TFile } from "obsidian";

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

// 同じVaultの別service instanceからも同一sourceを並行mutationさせない。
interface SourceLocks { paths: Set<string>; files: Set<TFile> }
const locks = new WeakMap<TagApplyVault, SourceLocks>();

/** UI未接続のmutation境界。active sessionで明示確認された一回限りのintentだけを受理する。 */
export class TagApplyService {
  constructor(
    private readonly vault: TagApplyVault,
    private readonly fileManager: Pick<FileManager, "processFrontMatter">,
  ) {}

  async apply(request: TagApplyRequest, signal: AbortSignal): Promise<TagApplyResult> {
    if (signal.aborted) return { status: "cancelled" };
    let inFlight: SourceLocks | undefined;
    let lockedPath: string | undefined;
    let lockedFile: TFile | undefined;
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
      inFlight = locks.get(this.vault) ?? { paths: new Set<string>(), files: new Set<TFile>() };
      locks.set(this.vault, inFlight);
      const path = grant.source.path;
      if (inFlight.paths.has(path)) return { status: "failure", reason: "busy" };
      inFlight.paths.add(path);
      lockedPath = path;

      const file = resolveTagApplySource(this.vault, grant.source);
      if (signal.aborted) return { status: "cancelled" };
      if (file === null) return { status: "failure", reason: "source-changed" };
      if (inFlight.files.has(file)) return { status: "failure", reason: "busy" };
      inFlight.files.add(file);
      lockedFile = file;

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
        const existing = frontmatter.tags;
        let preserved: string[];
        if (existing === undefined) preserved = [];
        else if (Array.isArray(existing)) {
          // 不明な要素をTag無しと扱わない。対応するlistは既存表記・重複・順序をそのまま保持する。
          preserved = [...existing];
          if (preserved.some((name) => typeof name !== "string" || !/^#?[^#\s]+$/u.test(name))) {
            throw new Error("Unsupported tags property");
          }
        } else if (typeof existing === "string") {
          // scalarの解釈は公式helperに委譲し、既存Tagを失う不明な値は書き換えない。
          const parsed = parseFrontMatterTags(frontmatter);
          if (!parsed?.length || parsed.some((name) => typeof name !== "string" || !/^#[^#\s]+$/u.test(name))) {
            throw new Error("Unsupported tags property");
          }
          preserved = parsed.map((name) => name.slice(1));
        } else throw new Error("Unsupported tags property");
        const currentTags = preserved.map((name) => name.startsWith("#") ? name : `#${name}`);
        // callbackのcurrent frontmatterだけがstrict duplicate authority。inline観測はadvisory。
        additions = unique.filter((name) => !currentTags.some((current) => isSameTagIdentity(current, name)));
        if (additions.length === 0) return;
        if (resolveTagApplySource(this.vault, grant.source) !== file) callbackFailure = "source-changed";
        else if (!isActiveConfirmedTagApplyIntent(confirmation, this.vault)) callbackFailure = "invalid-confirmation";
        if (callbackFailure) throw new Error("Tag apply validation failed");
        // 新規追加分だけ、公式YAML list表記へ変換する。case・階層・Unicodeは保持する。
        frontmatter.tags = [...preserved, ...additions.map((name) => name.slice(1))];
      });
      return additions.length === 0 ? { status: "no-change" } : { status: "applied", addedTags: additions };
    } catch {
      // raw例外には本文・絶対path等が入り得るため公開しない。開始後のrollback・自動retryはしない。
      return { status: "failure", reason: callbackFailure ?? "unexpected" };
    } finally {
      if (lockedPath !== undefined) inFlight?.paths.delete(lockedPath);
      if (lockedFile !== undefined) inFlight?.files.delete(lockedFile);
    }
  }
}
