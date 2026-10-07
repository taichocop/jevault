import { apiVersion, Notice, Plugin, TFile } from "obsidian";

import { NoteMoveService } from "../../src/note-move-service";
import { NoteSource } from "../../src/note-source";
import { TagApplyPreparationSession } from "../../src/tags/tag-apply-preparation";
import { TagApplyService } from "../../src/tags/tag-apply-service";
import { TagSuggestionGrantIssuer } from "../../src/tags/tag-suggestion-grant";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

/** 専用disposable Vaultの明示commandだけ。production bundleへimportしない。 */
export default class SharedMutationRuntimeVerification extends Plugin {
  private attempted = false;
  onload(): void {
    this.addCommand({ id: "verify", name: "Run isolated #105 mutation verification", callback: () => { void this.verify(); } });
  }
  private async verify(): Promise<void> {
    const vault = this.app.vault, manager = this.app.fileManager;
    if (this.attempted || !vault.getName().startsWith("Jevault-105-Synthetic-") ||
      !vault.getFileByPath("SYNTHETIC-105.marker.md")) return;
    this.attempted = true;
    const sessions: TagApplyPreparationSession[] = [];
    const held: ReturnType<typeof gate>[] = [];
    const hold = () => { const value = gate(); held.push(value); return value; };
    try {
      const get = (path: string): TFile => {
        const file = vault.getFileByPath(path);
        if (!(file instanceof TFile)) throw new Error("Fixture unavailable");
        return file;
      };
      const fixtures = ["A", "B", "C", "D", "E", "FTag", "FMove"]
        .map(name => get(`Inbox/${name}.md`));
      const cOther = get("Other/C.md");
      const signal = new AbortController().signal;
      const confirm = (file: TFile) => {
        const source = new NoteSource(file);
        // syntheticの既存Tagを明示選択し、実際のproduction confirmation経路を通す。
        const outcome = { status: "success" as const, source, noteTitle: "Synthetic", suggestions: [
          { tagName: "#runtime", tagId: "1", choice: "match" as const, matchProbability: 1 },
        ] };
        const lifetime = new TagSuggestionGrantIssuer(vault).issue(outcome)!;
        const session = new TagApplyPreparationSession(vault, this.app.metadataCache, file);
        sessions.push(session); session.prepare(outcome, lifetime);
        const confirmation = session.confirm(["#runtime"]);
        if (!confirmation) throw new Error("Synthetic confirmation unavailable");
        return { confirmation };
      };
      const move = (file: TFile) => new NoteMoveService(vault, manager).move(new NoteSource(file), ["Dest"], "Dest", signal);
      const busy = (result: { status: string; reason?: string }) => result.status === "failure" && result.reason === "busy";

      // A/Bはpublic API完了後もwrapperのPromiseをholdし、serviceのawait lifetimeを実hostで確認する。
      const a = fixtures[0], aGate = hold(), aEntered = gate();
      let aTagCalls = 0, aMoveCalls = 0;
      const aAttempt = new TagApplyService(vault, { processFrontMatter: async (file, callback) => {
        aTagCalls++; await manager.processFrontMatter(file, callback); aEntered.resolve(); await aGate.promise;
      } }).apply(confirm(a), signal);
      await aEntered.promise;
      const aBlocked = await new NoteMoveService(vault, { renameFile: async (file, path) => {
        aMoveCalls++; await manager.renameFile(file, path);
      } }).move(new NoteSource(a), ["Dest"], "Dest", signal);
      aGate.resolve(); const aTag = await aAttempt, aFresh = await move(a);

      const b = fixtures[1], bToken = confirm(b), bSource = new NoteSource(b), bGate = hold(), bEntered = gate();
      let bMoveCalls = 0, bTagCalls = 0;
      const bAttempt = new NoteMoveService(vault, { renameFile: async (file, path) => {
        bMoveCalls++; await manager.renameFile(file, path); bEntered.resolve(); await bGate.promise;
      } }).move(bSource, ["Dest"], "Dest", signal);
      await bEntered.promise;
      const bTags = new TagApplyService(vault, { processFrontMatter: async (file, callback) => {
        bTagCalls++; await manager.processFrontMatter(file, callback);
      } });
      const bBlocked = await bTags.apply(bToken, signal);
      const bBlockedTagCalls = bTagCalls;
      bGate.resolve(); const bMove = await bAttempt;
      const bReplay = await bTags.apply(bToken, signal), bFresh = await bTags.apply(confirm(b), signal);

      // C/Dは公開API入口をhold。targetがまだ不存在の同時実行scheduleを作る。
      const c = fixtures[2], cGate = hold(); let cMoveCalls = 0;
      const cManager = { renameFile: async (file: TFile, path: string) => {
        cMoveCalls++; await cGate.promise; await manager.renameFile(file, path);
      } };
      const cAttempt = new NoteMoveService(vault, cManager).move(new NoteSource(c), ["Dest"], "Dest", signal);
      const cBlocked = await new NoteMoveService(vault, cManager).move(new NoteSource(cOther), ["Dest"], "Dest", signal);
      cGate.resolve(); const cMove = await cAttempt;

      const d = fixtures[3], dGate = hold(), dEntered = gate(); let dMoveCalls = 0, dTagCalls = 0;
      const dAttempt = new NoteMoveService(vault, { renameFile: async (file, path) => {
        dMoveCalls++; await manager.renameFile(file, path); dEntered.resolve(); await dGate.promise;
      } }).move(new NoteSource(d), ["Dest"], "Dest", signal);
      await dEntered.promise;
      const dBlocked = await new TagApplyService(vault, { processFrontMatter: async (file, callback) => {
        dTagCalls++; await manager.processFrontMatter(file, callback);
      } }).apply(confirm(d), signal);
      dGate.resolve(); const dMove = await dAttempt;

      const e = fixtures[4], eTagGate = hold(), eMoveGate = hold(), eTagEntered = gate(), eMoveEntered = gate();
      let eTagCalls = 0, eMoveCalls = 0;
      const eTag = new TagApplyService(vault, { processFrontMatter: async (file, callback) => {
        eTagCalls++; await manager.processFrontMatter(file, callback); eTagEntered.resolve(); await eTagGate.promise;
      } }).apply(confirm(e), signal);
      await eTagEntered.promise;
      const eMove = new NoteMoveService(vault, { renameFile: async (file, path) => {
        eMoveCalls++; await manager.renameFile(file, path); eMoveEntered.resolve(); await eMoveGate.promise;
      } }).move(new NoteSource(cOther), ["OtherDest"], "OtherDest", signal);
      await eMoveEntered.promise;
      const eBothPending = eTagCalls === 1 && eMoveCalls === 1;
      eTagGate.resolve(); eMoveGate.resolve(); const eResults = await Promise.all([eTag, eMove]);

      // F: public Tag API callbackの例外と、public renameFileの不存在parent失敗を注入する。
      const fTag = fixtures[5], fMove = fixtures[6]; let fTagCalls = 0, fMoveCalls = 0;
      const fTagFailure = await new TagApplyService(vault, { processFrontMatter: async (file) => {
        fTagCalls++; await manager.processFrontMatter(file, () => { throw new Error("Synthetic callback failure"); });
      } }).apply(confirm(fTag), signal);
      const fTagFresh = await new TagApplyService(vault, manager).apply(confirm(fTag), signal);
      const fMoveFailure = await new NoteMoveService(vault, { renameFile: async (file) => {
        fMoveCalls++; await manager.renameFile(file, "MissingFixtureParent/FMove.md");
      } }).move(new NoteSource(fMove), ["Dest"], "Dest", signal);
      const fMoveFresh = await move(fMove);

      const evidence = {
        apiVersion,
        schedule: "public API entry/completion wrappers hold returned Promise; no private API",
        A: { pass: busy(aBlocked) && aMoveCalls === 0 && aTag.status === "applied" && aFresh.status === "moved", aTagCalls, blockedMoveCalls: aMoveCalls },
        B: { pass: busy(bBlocked) && bBlockedTagCalls === 0 && bTagCalls === 1 && bMove.status === "moved" && bReplay.status === "failure" && bReplay.reason === "invalid-confirmation" && bFresh.status === "applied", bMoveCalls, totalTagCallsIncludingFresh: bTagCalls, blockedTagCalls: bBlockedTagCalls },
        C: { pass: busy(cBlocked) && cMoveCalls === 1 && cMove.status === "moved", cMoveCalls },
        D: { pass: busy(dBlocked) && dTagCalls === 0 && dMove.status === "moved", dMoveCalls, blockedTagCalls: dTagCalls },
        E: { pass: eBothPending && eResults[0].status === "applied" && eResults[1].status === "moved", eTagCalls, eMoveCalls },
        F: { pass: fTagFailure.status === "failure" && fMoveFailure.status === "failure" && fTagFresh.status === "applied" && fMoveFresh.status === "moved", fTagCalls, fMoveCalls },
        explicitBodyReads: 0, secretLookups: 0, typesafeRequests: 0, rollback: 0,
      };
      // booleans/countsのみの検証証跡。source/body/frontmatter/認可を保存しない。
      await vault.adapter.write("evidence-105.json", JSON.stringify(evidence, null, 2));
      new Notice("#105 isolated runtime evidence saved.");
    } catch {
      new Notice("#105 isolated runtime failed; no raw error recorded.");
    } finally {
      held.forEach(value => value.resolve()); sessions.forEach(session => session.dispose());
    }
  }
}
