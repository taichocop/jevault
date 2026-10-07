import { apiVersion, Notice, Plugin, TFile } from "obsidian";

import { NoteSource } from "../../src/note-source";
import { moveValidatedSource } from "../../src/note-move-service";
import { addSelectedFrontmatterTags } from "../../src/tags/additive-frontmatter-tags";
import {
  OrganizerConfirmationSession, captureBaseline, strictSource, syntheticReview, runConfirmedSpike,
} from "./organizer-apply-safety-spike";

/** 専用synthetic Vaultだけにinstallする明示command。通常pluginへはbundle/importしない。 */
export default class OrganizerApplyRuntimeSpike extends Plugin {
  private running = false;
  private attempted = false;
  onload(): void {
    this.addCommand({ id: "verify", name: "Run isolated #103 safety verification", callback: () => { void this.verify(); } });
  }
  private async verify(): Promise<void> {
    const vault = this.app.vault;
    if (this.running || this.attempted || !vault.getName().startsWith("Jevault-103-Synthetic-") || !vault.getFileByPath("SYNTHETIC-103.marker.md")) return;
    this.running = true;
    this.attempted = true;
    try {
      const get = (path: string): TFile => {
        const file = vault.getFileByPath(path);
        if (!(file instanceof TFile)) throw new Error("Fixture unavailable");
        return file;
      };
      const manager = this.app.fileManager;
      const signal = new AbortController().signal;
      const first = get("Inbox/A.md"), source = new NoteSource(first);
      const original = Object.freeze({ path: first.path, mtime: first.stat.mtime, size: first.stat.size });
      const originalPassed = strictSource(vault, source, original, signal) === first;
      await manager.processFrontMatter(first, (fm: Record<string, unknown>) => {
        addSelectedFrontmatterTags(fm, ["#runtime"], () => {
          if (strictSource(vault, source, original, signal) !== first) throw new Error("Source stale");
        });
      });
      const post = captureBaseline(vault, source);
      const baseline = {
        originalPassed, sameIdentity: vault.getFileByPath(source.path) === first,
        samePath: first.path === original.path,
        originalMtime: original.mtime, originalSize: original.size,
        postMtime: post?.mtime, postSize: post?.size,
        postGuard: !!post && strictSource(vault, source, post, signal) === first,
        originalGuardAfterTag: strictSource(vault, source, original, signal) === first,
      };
      const run = async (path: string) => {
        const file = get(path), review = syntheticReview([file], ["#runtime"]);
        const session = new OrganizerConfirmationSession(vault, review);
        let tagCalls = 0, moveCalls = 0;
        const apis = {
          processFrontMatter: async (target: TFile, callback: (fm: Record<string, unknown>) => void) => {
            tagCalls++; await manager.processFrontMatter(target, callback);
          },
          renameFile: async (target: TFile, destination: string) => {
            moveCalls++; await manager.renameFile(target, destination);
          },
        };
        const result = await runConfirmedSpike(vault, apis, session.confirm(), signal, p => p === "Dest");
        session.dispose(); review.dispose();
        return { result, tagCalls, moveCalls };
      };
      const normal = await run("Inbox/B.md");

      // C: post-Tag baseline後のcontrolled editを公開APIで行い、共有Move guardで拒否する。
      const controlled = get("Inbox/C.md");
      let interveningMoveCalls = 0;
      const cOriginal = new NoteSource(controlled);
      await manager.processFrontMatter(controlled, (fm: Record<string, unknown>) => {
        addSelectedFrontmatterTags(fm, ["#runtime"], () => {});
      });
      const cPost = captureBaseline(vault, cOriginal);
      const postCaptured = !!cPost;
      await manager.processFrontMatter(controlled, (fm: Record<string, unknown>) => { fm.syntheticIntervening = true; });
      const changeDetected = !!cPost && strictSource(vault, cOriginal, cPost, signal) === null;
      const interveningResult = await moveValidatedSource(vault, {
        renameFile: async (target, destination) => { interveningMoveCalls++; await manager.renameFile(target, destination); },
      }, cOriginal, "Dest", signal, target => !!cPost && strictSource(vault, cOriginal, cPost, signal) === target);

      // D: API開始境界で空のsynthetic destinationを削除し、exact targetの実API failureを調べる。
      const partialFile = get("Inbox/D.md"), partialReview = syntheticReview([partialFile], ["#runtime"], "PartialDest");
      const partialSession = new OrganizerConfirmationSession(vault, partialReview);
      let partialTagCalls = 0, partialMoveCalls = 0;
      const partial = await runConfirmedSpike(vault, {
        processFrontMatter: async (file, callback) => { partialTagCalls++; await manager.processFrontMatter(file, callback); },
        renameFile: async (target, destination) => {
          partialMoveCalls++;
          const emptyFolder = vault.getAbstractFileByPath("PartialDest");
          if (!emptyFolder) throw new Error("Fixture unavailable");
          await vault.delete(emptyFolder);
          await manager.renameFile(target, destination);
        },
      }, partialSession.confirm(), signal, p => p === "PartialDest");
      let partialTagRetained = false;
      await manager.processFrontMatter(partialFile, (fm: Record<string, unknown>) => {
        partialTagRetained = Array.isArray(fm.tags) && fm.tags.includes("runtime");
      });
      partialSession.dispose(); partialReview.dispose();
      // evidenceのみ永続化。confirmation/Review/source/body/frontmatter/Secretは保存しない。
      await vault.adapter.write("evidence-103.json", JSON.stringify({
        apiVersion, baseline, normal,
        intervening: { postCaptured, changeDetected, result: interveningResult, moveCalls: interveningMoveCalls },
        partial: { result: partial, tagCalls: partialTagCalls, moveCalls: partialMoveCalls, partialTagRetained,
          sameSource: vault.getFileByPath("Inbox/D.md") === partialFile },
        explicitBodyReads: 0, secretLookups: 0, typesafeRequests: 0, reanalysis: 0, recollection: 0, rollback: 0,
      }, null, 2));
      new Notice("#103 isolated runtime evidence saved.");
    } catch {
      new Notice("#103 isolated runtime verification failed; no raw error recorded.");
    } finally { this.running = false; }
  }
}
