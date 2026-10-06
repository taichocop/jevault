import type { NoteSource } from "../note-source";
import type { ExistingTagSnapshot } from "../tags/existing-tag-snapshot";
import { isSameTagIdentity } from "../tags/tag-identity";
import type { FolderOrganizerAnalysisResult, OrganizationNoteAnalysis } from "./organization-analysis-result";
import type { NoteSnapshot } from "./target-file-collector";

export type ReviewedFolderIntent =
  | { readonly kind: "keep-current" }
  | { readonly kind: "existing-folder"; readonly path: string };
export type FolderReviewSelection = { readonly kind: "unreviewed" } | ReviewedFolderIntent;
export type TagReviewSelection =
  | { readonly kind: "unreviewed" }
  | { readonly kind: "selected"; readonly names: readonly string[] };
export interface OrganizationReviewDraft {
  readonly folder: FolderReviewSelection;
  readonly tags: TagReviewSelection;
}
export interface ReviewedOrganizationNote {
  readonly source: NoteSource;
  readonly snapshot: NoteSnapshot;
  readonly analysis: OrganizationNoteAnalysis;
  readonly folder: ReviewedFolderIntent;
  readonly selectedTags: readonly string[];
  readonly reviewStatus: "reviewed";
}
export interface OrganizationReviewResult {
  readonly reviewed: readonly ReviewedOrganizationNote[];
  readonly unavailable: readonly Readonly<{
    source: NoteSource;
    snapshot: NoteSnapshot;
    reason: "analysis-unavailable";
  }>[];
}

export function isReviewable(note: OrganizationNoteAnalysis): boolean {
  return note.status === "success" || note.status === "partial";
}

/** exact分析とmetadata snapshotを所有し、選択は分析objectへ書き戻さない。 */
export class OrganizationReviewSession {
  private analysis?: FolderOrganizerAnalysisResult;
  private folders: readonly string[];
  private tags: readonly string[];
  private currentTags: readonly ExistingTagSnapshot[];
  private drafts: Array<OrganizationReviewDraft | undefined>;
  private result?: OrganizationReviewResult;
  private disposed = false;

  constructor(analysis: FolderOrganizerAnalysisResult, folders: readonly string[], tags: readonly string[], currentTags: readonly ExistingTagSnapshot[]) {
    if (analysis.status !== "completed" || currentTags.length !== analysis.results.length) {
      throw new Error("Review unavailable.");
    }
    this.analysis = analysis;
    this.folders = Object.freeze([...folders]);
    this.tags = Object.freeze([...tags]);
    this.currentTags = Object.freeze(currentTags.map(snapshot => snapshot.status === "available"
      ? Object.freeze({ status: "available" as const, names: Object.freeze([...snapshot.names]) })
      : Object.freeze({ status: "unavailable" as const })));
    // 空checkboxは表示だけ。未操作の0個選択をreview済みintentへ昇格させない。
    this.drafts = analysis.results.map(note => isReviewable(note) ? Object.freeze({
      folder: Object.freeze({ kind: "unreviewed" as const }), tags: Object.freeze({ kind: "unreviewed" as const }),
    }) : undefined);
  }

  getAnalysisResult(): FolderOrganizerAnalysisResult | undefined { return this.analysis; }
  getResult(): OrganizationReviewResult | undefined { return this.result; }
  getDraft(index: number): OrganizationReviewDraft | undefined { return this.drafts[index]; }
  getCurrentTags(index: number): ExistingTagSnapshot | undefined { return this.currentTags[index]; }
  getExistingTags(): readonly string[] { return this.tags; }
  getCurrentFolder(index: number): string | undefined {
    const path = this.analysis?.results[index]?.snapshot.path;
    return path === undefined ? undefined : path.slice(0, Math.max(0, path.lastIndexOf("/")));
  }
  getAlternateFolders(index: number): readonly string[] {
    return this.folders.filter(path => path !== this.getCurrentFolder(index));
  }
  isFolderAvailable(path: string): boolean { return this.folders.includes(path); }
  isTagAvailable(name: string): boolean { return this.tags.includes(name); }
  isTagSelected(index: number, name: string): boolean {
    const tags = this.drafts[index]?.tags;
    return tags?.kind === "selected" && tags.names.some(selected => isSameTagIdentity(selected, name));
  }

  selectFolder(index: number, selection: ReviewedFolderIntent): boolean {
    const draft = this.editableDraft(index);
    if (!draft || (selection.kind === "existing-folder" && !this.isFolderAvailable(selection.path))) return false;
    const folder: ReviewedFolderIntent = selection.kind === "keep-current"
      ? Object.freeze({ kind: "keep-current" }) : Object.freeze({ kind: "existing-folder", path: selection.path });
    this.drafts[index] = Object.freeze({ folder, tags: draft.tags });
    return true;
  }

  selectTag(index: number, name: string, selected: boolean): boolean {
    const draft = this.editableDraft(index);
    if (!draft || !this.isTagAvailable(name)) return false;
    const names = draft.tags.kind === "selected" ? [...draft.tags.names] : [];
    const match = names.findIndex(existing => isSameTagIdentity(existing, name));
    // identity比較は重複防止だけ。選ばれた既存表記を別caseへ書き換えない。
    if (selected && match < 0) names.push(name);
    else if (!selected && match >= 0) names.splice(match, 1);
    this.drafts[index] = Object.freeze({ folder: draft.folder,
      tags: Object.freeze({ kind: "selected", names: Object.freeze(names) }) });
    return true;
  }

  getUnreviewedFolderIndices(): readonly number[] {
    return this.drafts.flatMap((draft, index) => draft?.folder.kind === "unreviewed" ? [index] : []);
  }
  canFinish(): boolean {
    return !this.disposed && !this.result && this.drafts.some(Boolean) && this.getUnreviewedFolderIndices().length === 0;
  }
  finish(): OrganizationReviewResult | undefined {
    if (!this.canFinish() || !this.analysis) return undefined;
    const reviewed: ReviewedOrganizationNote[] = [];
    const unavailable: OrganizationReviewResult["unavailable"][number][] = [];
    this.analysis.results.forEach((analysis, index) => {
      const draft = this.drafts[index];
      if (!draft) {
        unavailable.push(Object.freeze({ source: analysis.source, snapshot: analysis.snapshot, reason: "analysis-unavailable" }));
      } else if (draft.folder.kind !== "unreviewed") {
        // explicit Finishだけがuntouched Tagを明示的0個へ確定できる境界。
        const tags = draft.tags.kind === "selected" ? draft.tags
          : Object.freeze({ kind: "selected" as const, names: Object.freeze([] as string[]) });
        this.drafts[index] = Object.freeze({ folder: draft.folder, tags });
        reviewed.push(Object.freeze({ source: analysis.source, snapshot: analysis.snapshot, analysis,
          folder: draft.folder, selectedTags: tags.names, reviewStatus: "reviewed" }));
      }
    });
    this.result = Object.freeze({ reviewed: Object.freeze(reviewed), unavailable: Object.freeze(unavailable) });
    return this.result;
  }

  private editableDraft(index: number): OrganizationReviewDraft | undefined {
    return this.disposed || this.result ? undefined : this.drafts[index];
  }
  dispose(): void {
    this.disposed = true;
    this.analysis = undefined;
    this.result = undefined;
    this.drafts = [];
    this.folders = [];
    this.tags = [];
    this.currentTags = [];
  }
}
