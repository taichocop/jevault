import { getAllTags, parseFrontMatterTags, TFile, type MetadataCache, type Vault } from "obsidian";

import { NoteSource } from "../note-source";
import type { TagSuggestionServiceResult } from "./tag-suggestion-service";

export type TagApplyFailureReason =
  | "invalid-selection" | "source-changed" | "revision-changed"
  | "tag-state-changed" | "metadata-unavailable" | "busy" | "unexpected";

export interface TagApplyAuthorization {
  readonly source: NoteSource;
  readonly revision: Readonly<{ mtime: number; size: number }>;
  readonly allowedTags: readonly string[];
  readonly existingTags: readonly string[];
  readonly frontmatterTags: readonly string[];
}

export type TagApplyCaptureResult =
  | { status: "captured"; authorization: TagApplyAuthorization }
  | { status: "failure"; reason: TagApplyFailureReason };

export type TagApplyVault = Pick<Vault, "getFileByPath">;
export type TagApplyMetadata = Pick<MetadataCache, "getFileCache">;

// readonly型だけではJS callerの改変を防げないため、発行済みsnapshotとVaultを照合する。
const issued = new WeakMap<TagApplyAuthorization, TagApplyVault>();

export function isIssuedAuthorization(value: TagApplyAuthorization, vault: TagApplyVault): boolean {
  return issued.get(value) === vault;
}

export function resolveTagApplySource(vault: TagApplyVault, source: NoteSource): TFile | null {
  if (!(source instanceof NoteSource)) return null;
  const path = source.path;
  if (!path || /[\\:]/.test(path) ||
    Array.from(path).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    path.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const file = vault.getFileByPath(path);
  return file instanceof TFile && source.matches(file) &&
    file.extension.toLowerCase() === "md" &&
    file.name === path.slice(path.lastIndexOf("/") + 1) &&
    file.basename === file.name.slice(0, -(file.extension.length + 1))
    ? file : null;
}

export function sameTags(expected: readonly string[], current: readonly string[]): boolean {
  const names = new Set(current);
  return names.size === new Set(expected).size && expected.every((name) => names.has(name));
}

export function readTagApplyMetadata(metadata: TagApplyMetadata, file: TFile) {
  const cache = metadata.getFileCache(file);
  if (cache === null) return null;
  return {
    existingTags: [...new Set(getAllTags(cache) ?? [])],
    frontmatterTags: [...new Set(parseFrontMatterTags(cache.frontmatter ?? null) ?? [])],
  };
}

/** 成功した提案から、selectionを受け付ける前に呼ぶread-only境界。Applyからcaptureしない。 */
export class TagApplyAuthorizationService {
  constructor(private readonly vault: TagApplyVault, private readonly metadata: TagApplyMetadata) {}

  capture(outcome: Pick<TagSuggestionServiceResult, "source" | "suggestions">): TagApplyCaptureResult {
    try {
      const file = resolveTagApplySource(this.vault, outcome.source);
      if (file === null) return { status: "failure", reason: "source-changed" };
      const revision = Object.freeze({ mtime: file.stat.mtime, size: file.stat.size });
      if (!Number.isFinite(revision.mtime) || !Number.isFinite(revision.size) || revision.size < 0) {
        return { status: "failure", reason: "revision-changed" };
      }
      const tags = readTagApplyMetadata(this.metadata, file);
      if (tags === null) return { status: "failure", reason: "metadata-unavailable" };
      if (resolveTagApplySource(this.vault, outcome.source) !== file) {
        return { status: "failure", reason: "source-changed" };
      }
      if (revision.mtime !== file.stat.mtime || revision.size !== file.stat.size) {
        return { status: "failure", reason: "revision-changed" };
      }
      const allowedTags = [...new Set(outcome.suggestions.map(({ tagName }) => tagName))];
      if (allowedTags.some((name) => typeof name !== "string" || !/^#[^#\s]+$/u.test(name))) {
        return { status: "failure", reason: "invalid-selection" };
      }
      const authorization = Object.freeze({
        source: outcome.source, revision,
        allowedTags: Object.freeze(allowedTags),
        existingTags: Object.freeze(tags.existingTags),
        frontmatterTags: Object.freeze(tags.frontmatterTags),
      });
      issued.set(authorization, this.vault);
      return { status: "captured", authorization };
    } catch {
      return { status: "failure", reason: "unexpected" };
    }
  }
}
