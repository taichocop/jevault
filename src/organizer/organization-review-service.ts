import type { JevaultSettings } from "../settings";
import type { ExistingTagSnapshotProvider } from "../tags/existing-tag-snapshot";
import type { TagDiscoveryService } from "../tags/tag-discovery-service";
import type { VaultService } from "../vault-service";
import type { FolderOrganizerAnalysisResult } from "./organization-analysis-result";
import { OrganizationReviewSession } from "./organization-review-session";

/** Review entryで一度だけlocal metadataを捕捉する。provider/本文/Secretを持たない。 */
export class OrganizationReviewService {
  constructor(
    private readonly folders: Pick<VaultService, "getAvailableFolderPaths">,
    private readonly tags: Pick<TagDiscoveryService, "discover">,
    private readonly currentTags: ExistingTagSnapshotProvider,
    private readonly getSettings: () => Pick<JevaultSettings, "inboxPath" | "ignoredFolders">,
  ) {}

  prepare(analysis: FolderOrganizerAnalysisResult, signal: AbortSignal): OrganizationReviewSession | undefined {
    if (signal.aborted || analysis.status !== "completed") return undefined;
    try {
      const settings = this.getSettings();
      if (signal.aborted) return undefined;
      const folders = [...this.folders.getAvailableFolderPaths(settings)];
      if (signal.aborted) return undefined;
      const tags = this.tags.discover().map(candidate => candidate.name);
      if (signal.aborted) return undefined;
      const snapshots = [];
      for (const note of analysis.results) {
        const snapshot = this.currentTags.snapshot(note.source);
        if (signal.aborted) return undefined;
        snapshots.push(snapshot.status === "available"
          ? { status: "available" as const, names: [...snapshot.names] } : { status: "unavailable" as const });
      }
      return new OrganizationReviewSession(analysis, folders, tags, snapshots);
    } catch {
      // Obsidian例外のpathや内部情報をUIへ渡さず、intentを作らず失敗する。
      return undefined;
    }
  }
}
