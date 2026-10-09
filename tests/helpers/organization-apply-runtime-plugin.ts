import { apiVersion, Notice, Plugin, TFile } from "obsidian";
import { NoteSource } from "../../src/note-source";
import { NoteMoveService } from "../../src/note-move-service";
import { OrganizationApplyConfirmationSession } from "../../src/organizer/organization-apply-confirmation";
import { OrganizationApplyService } from "../../src/organizer/organization-apply-service";
import { syntheticReview } from "./organizer-apply-safety-spike";

/** 専用使い捨てVaultの明示commandだけ。通常pluginへbundle/importしない。 */
export default class OrganizationApplyRuntimeVerification extends Plugin {
  private attempted = false;
  onload(): void {
    this.addCommand({ id: "verify", name: "Run isolated #107 A–J verification", callback: () => { void this.verify(); } });
  }
  private async verify(): Promise<void> {
    const vault = this.app.vault, manager = this.app.fileManager;
    if (this.attempted || !vault.getName().startsWith("Jevault-107-Synthetic-") || !vault.getFileByPath("SYNTHETIC-107.marker.md")) return;
    this.attempted = true;
    try {
      const file = (path: string) => {
        const value = vault.getFileByPath(path); if (!(value instanceof TFile)) throw new Error("Fixture missing"); return value;
      };
      const cases: Record<string, unknown> = {};
      const run = async (name: string, tags: readonly string[], destination: string | null,
        setup?: (source: TFile, controller: AbortController) => Promise<void>) => {
        const source = file(`Inbox/${name}.md`), original = { mtime: source.stat.mtime, size: source.stat.size };
        const review = syntheticReview([source], tags, destination);
        const session = new OrganizationApplyConfirmationSession(vault, review), controller = new AbortController();
        let tagCalls = 0, moveCalls = 0;
        if (setup) await setup(source, controller);
        const service = new OrganizationApplyService(vault, {
          processFrontMatter: async (target, cb) => {
            tagCalls++; await manager.processFrontMatter(target, cb);
            if (name === "H") controller.abort();
          },
          renameFile: async (target, path) => {
            moveCalls++;
            if (name === "G") {
              const folder = vault.getAbstractFileByPath("FailDest");
              if (!folder) throw new Error("Fixture missing"); await vault.delete(folder);
            }
            await manager.renameFile(target, path);
          },
        }, () => ({ inboxPath: "Inbox", ignoredFolders: [] }));
        const result = await service.apply(session.confirm()!, controller.signal);
        let tagRetained = false;
        // 検証観測は公開FM APIだけで行い、本文/frontmatter自体をevidenceへ保存しない。
        if (["A", "C", "D", "G", "H"].includes(name)) {
          await manager.processFrontMatter(source, (fm: Record<string, unknown>) => {
            tagRetained = Array.isArray(fm.tags) && fm.tags.includes("runtime");
          });
        }
        cases[name] = { result, tagCalls, moveCalls, tagRetained,
          ownStatChanged: source.stat.mtime !== original.mtime || source.stat.size !== original.size };
        session.dispose(); review.dispose();
      };
      await run("A", ["#runtime"], null);
      await run("B", [], "Dest");
      await run("C", ["#runtime"], "Dest");
      await run("D", ["#runtime"], "Dest");
      await run("E", ["#runtime"], "Dest", async source => {
        await manager.processFrontMatter(source, (fm: Record<string, unknown>) => { fm.controlled = "edit-after-review"; });
      });
      await run("F", ["#runtime"], "Dest");
      await run("G", ["#runtime"], "FailDest");
      await run("H", ["#runtime"], "Dest");

      const heldFile = file("Inbox/I.md"), unrelated = file("Other/J.md");
      const review = syntheticReview([heldFile], ["#runtime"], "Dest"), session = new OrganizationApplyConfirmationSession(vault, review);
      let openGate!: () => void, tagStarted!: () => void;
      const gate = new Promise<void>(resolve => { openGate = resolve; });
      const started = new Promise<void>(resolve => { tagStarted = resolve; });
      const service = new OrganizationApplyService(vault, {
        processFrontMatter: async (target, cb) => { await manager.processFrontMatter(target, cb); tagStarted(); await gate; },
        renameFile: (target, path) => manager.renameFile(target, path),
      }, () => ({ inboxPath: "Inbox", ignoredFolders: [] }));
      const pending = service.apply(session.confirm()!, new AbortController().signal); await started;
      const manual = new NoteMoveService(vault, manager);
      const conflict = await manual.move(new NoteSource(heldFile), ["Dest"], "Dest", new AbortController().signal);
      const independent = await manual.move(new NoteSource(unrelated), ["Dest"], "Dest", new AbortController().signal);
      openGate(); const result = await pending;
      cases.I = { conflict, organizer: result }; cases.J = { independent };
      session.dispose(); review.dispose();
      await vault.adapter.write("evidence-107.json", JSON.stringify({ apiVersion, cases,
        explicitBodyReads: 0, secretLookups: 0, typesafeRequests: 0, reanalysis: 0, recollection: 0, rollback: 0 }, null, 2));
      new Notice("#107 isolated runtime evidence saved.");
    } catch { new Notice("#107 verification failed; no raw error recorded."); }
  }
}
