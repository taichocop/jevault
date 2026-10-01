import { parseFrontMatterTags, type FileManager, type TFile } from "obsidian";

import {
  isIssuedAuthorization, resolveTagApplySource, sameTags,
  type TagApplyAuthorization, type TagApplyFailureReason, type TagApplyMetadata, type TagApplyVault,
} from "./tag-apply-authorization";
import { isSameTagIdentity } from "./tag-identity";

export interface TagApplyRequest {
  readonly authorization: TagApplyAuthorization;
  readonly selectedTags: readonly string[];
}

export type TagApplyResult =
  | { status: "applied"; addedTags: readonly string[] }
  | { status: "no-change" }
  | { status: "cancelled" }
  | { status: "failure"; reason: TagApplyFailureReason };

// 同じVaultの別service instanceからも同一sourceを並行mutationさせない。
interface SourceLocks { paths: Set<string>; files: Set<TFile> }
const locks = new WeakMap<TagApplyVault, SourceLocks>();

/** UI・providerから独立した、選択済み既存Tagだけを追加する唯一のmutation境界。 */
export class TagApplyService {
  constructor(
    private readonly vault: TagApplyVault,
    private readonly metadata: TagApplyMetadata,
    private readonly fileManager: Pick<FileManager, "processFrontMatter">,
  ) {}

  async apply(request: TagApplyRequest, signal: AbortSignal): Promise<TagApplyResult> {
    if (signal.aborted) return { status: "cancelled" };
    let inFlight: SourceLocks | undefined;
    let lockedPath: string | undefined;
    let lockedFile: TFile | undefined;
    let callbackFailure: TagApplyFailureReason | undefined;
    try {
      const { authorization, selectedTags } = request;
      if (!isIssuedAuthorization(authorization, this.vault) || !Array.isArray(selectedTags)) {
        return { status: "failure", reason: "invalid-selection" };
      }
      const selected = [...new Set(selectedTags)];
      if (selected.some((name) => !authorization.allowedTags.includes(name))) {
        return { status: "failure", reason: "invalid-selection" };
      }
      if (signal.aborted) return { status: "cancelled" };
      if (selected.length === 0) return { status: "no-change" };
      inFlight = locks.get(this.vault) ?? { paths: new Set<string>(), files: new Set<TFile>() };
      locks.set(this.vault, inFlight);
      const path = authorization.source.path;
      if (inFlight.paths.has(path)) return { status: "failure", reason: "busy" };
      inFlight.paths.add(path);
      lockedPath = path;

      const file = resolveTagApplySource(this.vault, authorization.source);
      if (signal.aborted) return { status: "cancelled" };
      if (file === null) return { status: "failure", reason: "source-changed" };
      if (inFlight.files.has(file)) return { status: "failure", reason: "busy" };
      inFlight.files.add(file);
      lockedFile = file;
      const revisionMatches = () => authorization.revision.mtime === file.stat.mtime &&
        authorization.revision.size === file.stat.size;
      const revisionValid = revisionMatches();
      if (signal.aborted) return { status: "cancelled" };
      if (!revisionValid) return { status: "failure", reason: "revision-changed" };
      const tags = this.metadata.snapshot(authorization.source, authorization.evaluationProvenance);
      if (signal.aborted) return { status: "cancelled" };
      if (tags.status === "failure") return tags;
      if (!sameTags(authorization.existingTags, tags.existingTags) ||
        !sameTags(authorization.frontmatterTags, tags.frontmatterTags)) {
        return { status: "failure", reason: "tag-state-changed" };
      }
      if (tags.proof !== authorization.metadataProof) return { status: "failure", reason: "metadata-stale" };
      const additions: string[] = [];
      for (const name of selected) {
        // 認可は先に完全一致で検証済み。同一Applyでも最初に採用した表記だけを保持する。
        if (!tags.existingTags.some((existing) => isSameTagIdentity(existing, name)) &&
          !additions.some((addition) => isSameTagIdentity(addition, name))) {
          additions.push(name);
        }
      }
      if (signal.aborted) return { status: "cancelled" };
      if (additions.length === 0) return { status: "no-change" };

      // metadata境界でも状態が変わり得る。最終検証とAPI開始の間にawaitを置かない。
      if (resolveTagApplySource(this.vault, authorization.source) !== file) {
        return { status: "failure", reason: "source-changed" };
      }
      if (!revisionMatches()) return { status: "failure", reason: "revision-changed" };
      if (signal.aborted) return { status: "cancelled" };
      await this.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        // API内部のread待ち中の変更も、書き換える前に拒否する。開始後のcancelはrollbackしない。
        if (resolveTagApplySource(this.vault, authorization.source) !== file) callbackFailure = "source-changed";
        else if (!revisionMatches()) callbackFailure = "revision-changed";
        else if (!sameTags(authorization.frontmatterTags, parseFrontMatterTags(frontmatter) ?? [])) {
          callbackFailure = "tag-state-changed";
        }
        if (!callbackFailure) {
          const latest = this.metadata.snapshot(authorization.source, authorization.evaluationProvenance);
          if (latest.status === "failure") callbackFailure = latest.reason;
          else if (!sameTags(authorization.existingTags, latest.existingTags) ||
            !sameTags(authorization.frontmatterTags, latest.frontmatterTags)) callbackFailure = "tag-state-changed";
          else if (latest.proof !== authorization.metadataProof) callbackFailure = "metadata-stale";
        }
        if (callbackFailure) throw new Error("Tag apply validation failed");
        const existing = frontmatter.tags;
        let preserved: unknown[];
        if (existing === undefined) preserved = [];
        else if (Array.isArray(existing)) preserved = [...existing];
        else if (typeof existing === "string") {
          // scalarの解釈は公式helperに委譲し、既存Tagを失う不明な値は書き換えない。
          const parsed = parseFrontMatterTags(frontmatter);
          if (!parsed?.length) throw new Error("Unsupported tags property");
          preserved = parsed.map((name) => name.startsWith("#") ? name.slice(1) : name);
        } else throw new Error("Unsupported tags property");
        // 新規追加分だけ、公式YAML list表記へ変換する。case・階層・Unicodeは保持する。
        frontmatter.tags = [...preserved, ...additions.map((name) => name.slice(1))];
      });
      return { status: "applied", addedTags: additions };
    } catch {
      // raw例外には本文・絶対path等が入り得るため公開しない。
      return { status: "failure", reason: callbackFailure ?? "unexpected" };
    } finally {
      if (lockedPath !== undefined) inFlight?.paths.delete(lockedPath);
      if (lockedFile !== undefined) inFlight?.files.delete(lockedFile);
    }
  }
}
