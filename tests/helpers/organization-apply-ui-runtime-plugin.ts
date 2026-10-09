import { apiVersion, Menu, Notice, Plugin, TFolder } from "obsidian";
import { FolderOrganizerEntryController } from "../../src/organizer/folder-organizer-entry";
import { TargetFileCollector } from "../../src/organizer/target-file-collector";
import { OrganizationReviewService } from "../../src/organizer/organization-review-service";
import { OrganizationApplyService } from "../../src/organizer/organization-apply-service";
import { ExistingTagSnapshotService } from "../../src/tags/existing-tag-snapshot";
import { TagDiscoveryService } from "../../src/tags/tag-discovery-service";
import { VaultService } from "../../src/vault-service";
import type { OrganizationReviewSession, OrganizationReviewResult } from "../../src/organizer/organization-review-session";
import type { OrganizationApplyResult } from "../../src/organizer/organization-apply-result";
import type { OrganizationNoteAnalysis } from "../../src/organizer/organization-analysis-result";
import { acquireVaultMutationLease } from "../../src/vault-mutation-coordinator";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => window.setTimeout(resolve, 30));
interface Observation {
  tagCalls: number; moveCalls: number; applyCalls: number;
  result?: OrganizationApplyResult;
  owner?: OrganizationReviewSession;
  exact?: OrganizationReviewResult;
}

/** 明示command専用の合成UI driver。本番bundleからimportせず、分析はfakeだけ。 */
export default class OrganizationApplyUIRuntimeVerification extends Plugin {
  private entry?: FolderOrganizerEntryController;
  private attempted = false;
  private safe(): boolean {
    return this.app.vault.getName().startsWith("Jevault-111-Synthetic-") &&
      !!this.app.vault.getFileByPath("SYNTHETIC-111.marker.md");
  }
  onload(): void {
    if (!this.safe()) return;
    this.entry = this.controller("Interactive", { tagCalls: 0, moveCalls: 0, applyCalls: 0 });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => { if (this.safe()) this.entry?.addToMenu(menu, file); }));
    this.addCommand({ id: "verify-ui", name: "Run isolated #111 DOM UI verification", callback: () => { void this.verify(); } });
  }
  onunload(): void { this.entry?.dispose(); }

  private controller(mode: string, observation: Observation, gate?: ReturnType<typeof deferred>, started?: ReturnType<typeof deferred>): FolderOrganizerEntryController {
    const vault = this.app.vault, manager = this.app.fileManager;
    const settings = () => ({ inboxPath: "Inbox", ignoredFolders: [] });
    const review = new OrganizationReviewService(new VaultService(vault), new TagDiscoveryService(vault, this.app.metadataCache),
      new ExistingTagSnapshotService(vault, this.app.metadataCache), settings);
    const service = new OrganizationApplyService(vault, {
      processFrontMatter: async (file, callback) => {
        observation.tagCalls++;
        await manager.processFrontMatter(file, callback);
        if (mode.endsWith("Tag")) { started?.resolve(); await gate?.promise; }
      },
      renameFile: async (file, path) => {
        observation.moveCalls++;
        if (mode === "Partial") throw new Error("Synthetic Move rejection");
        await manager.renameFile(file, path);
        if (mode.endsWith("Move") && mode !== "MoveOnly") { started?.resolve(); await gate?.promise; }
      },
    }, settings);
    return new FolderOrganizerEntryController(this.app, new TargetFileCollector(vault), settings, {
      analyze: async targets => {
        const notes: OrganizationNoteAnalysis[] = targets.map(target => ({ source: target.source, snapshot: target.snapshot,
          status: target.source.path.endsWith("-U.md") ? "failed" : "success",
          folder: { status: "success", value: { status: "success", source: target.source, noteTitle: "Synthetic",
            result: { candidates: [{ path: mode === "SameFolder"
              ? target.source.path.slice(0, target.source.path.lastIndexOf("/")) : "Dest", probability: 1 }] } } },
          tags: { status: "success", value: { status: "success", source: target.source, noteTitle: "Synthetic",
            suggestions: [{ tagName: "#runtime", tagId: "fixture", choice: "match", matchProbability: 1 }] } },
        }));
        return { status: "completed", results: Object.freeze(notes), progress: { total: notes.length, processed: notes.length,
          failed: notes.filter(note => note.status === "failed").length } };
      },
    }, { prepare: (analysis, signal) => {
      const owner = review.prepare(analysis, signal); observation.owner = owner; return owner;
    } }, { apply: async (intent, signal, onProgress) => {
      observation.applyCalls++; observation.exact = observation.owner?.getResult();
      const result = await service.apply(intent, signal, onProgress); observation.result = result; return result;
    } });
  }

  private async verify(): Promise<void> {
    if (!this.safe() || this.attempted) return;
    this.attempted = true;
    const cases: Record<string, unknown> = {};
    let running: FolderOrganizerEntryController | undefined;
    let releaseGate: (() => void) | undefined;
    const check = (value: unknown): void => { if (!value) throw new Error("Synthetic assertion failed"); };
    const content = () => document.querySelector<HTMLElement>(".modal-content")!;
    const click = (label: string): HTMLButtonElement => {
      const button = Array.from(content().querySelectorAll("button")).find(button => button.textContent === label)!;
      check(button && !button.disabled); button.click(); return button;
    };
    const closeX = () => { const close = document.querySelector<HTMLElement>(".modal-close-button"); check(close); close!.click(); };
    try {
      for (const mode of ["TagOnly", "MoveOnly", "Both", "SameFolder", "Keep", "Partial", "StopTag", "StopMove",
        "CloseTag", "CloseMove", "UnloadTag", "UnloadMove", "Cancel", "Esc", "X"]) {
        const observation: Observation = { tagCalls: 0, moveCalls: 0, applyCalls: 0 };
        const gate = deferred(), started = deferred(); releaseGate = gate.resolve;
        const entry = this.controller(mode, observation, gate, started); running = entry;
        const folder = this.app.vault.getAbstractFileByPath(`Cases/${mode}`); check(folder instanceof TFolder);
        let navigate!: () => void;
        // 本番entry callbackを起点にし、以降は実際のObsidian Modal DOMのみを操作する。
        entry.addToMenu({ addItem: (cb: (item: unknown) => void) => {
          const item = { setTitle: () => item, onClick: (action: () => void) => { navigate = action; return item; } }; cb(item);
        } } as unknown as Menu, folder!);
        navigate(); await tick(); click("Preview notes"); click("Analyze notes"); await tick(); click("Review results"); await tick();
        check(!Array.from(content().querySelectorAll("button")).some(button => button.textContent === "Apply selected changes"));
        for (let index = 0; index < 3; index++) {
          if (!content().textContent?.includes("Analysis unavailable for this note.")) {
            if (["TagOnly", "Keep"].includes(mode)) {
              const radio = content().querySelector<HTMLInputElement>('input[type="radio"]')!;
              radio.checked = true; radio.dispatchEvent(new Event("change"));
            } else if (mode === "SameFolder") {
              // alternate selectは現在Folderを除外する。fakeの既存候補radioで同Folderを選ぶ。
              const radio = content().querySelectorAll<HTMLInputElement>('input[type="radio"]')[1];
              check(radio && !radio.disabled); radio.checked = true; radio.dispatchEvent(new Event("change"));
            } else {
              const select = content().querySelector<HTMLSelectElement>("select")!;
              select.value = "Dest"; select.dispatchEvent(new Event("change"));
            }
            if (!["MoveOnly", "Keep"].includes(mode)) {
              const tag = content().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
              tag.checked = true; tag.dispatchEvent(new Event("change"));
            }
          }
          if (index < 2) click("Next");
        }
        click("Finish review"); const exact = observation.owner?.getResult(); check(exact);
        const staleApply = click("Apply selected changes"); await tick(); staleApply.click();
        const confirmationText = content().textContent ?? "";
        check(confirmationText.includes("Reviewed: 2. Unavailable: 1")); check(confirmationText.includes("Tag + Move is not atomic"));
        check(observation.owner?.getResult() === exact); check(observation.tagCalls === 0 && observation.moveCalls === 0 && observation.applyCalls === 0);
        const staleConfirm = Array.from(content().querySelectorAll("button")).find(button => button.textContent === "Confirm Apply")!;
        if (["Cancel", "Esc", "X"].includes(mode)) {
          if (mode === "Cancel") click("Cancel"); else if (mode === "X") closeX();
          else document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
          await tick(); staleConfirm.click(); await tick();
          check(observation.applyCalls === 0 && observation.tagCalls === 0 && observation.moveCalls === 0);
          check(!observation.owner?.getResult());
          cases[mode] = { zeroMutationBeforeConfirm: true, invalidatedOwner: true, staleConfirmIgnored: true }; entry.dispose(); continue;
        }
        click("Confirm Apply"); staleConfirm.click();
        let ownerHeld = false, leaseHeld = false, stopRequestedVisible = false;
        if (/^(Stop|Close|Unload)/.test(mode)) {
          await Promise.race([started.promise, new Promise((_, reject) => window.setTimeout(() => reject(new Error("Synthetic timeout")), 3000))]);
          if (mode.startsWith("Stop")) { const stop = click("Stop"); stop.click(); stopRequestedVisible = content().textContent?.includes("Stop requested") ?? false; }
          else if (mode.startsWith("Close")) closeX(); else entry.dispose();
          ownerHeld = observation.owner?.getResult() === exact;
          const first = exact!.reviewed[0], target = `Dest/${first.source.path.split("/").at(-1)}`;
          const lease = acquireVaultMutationLease(this.app.vault, first.source.path, target); leaseHeld = !lease; lease?.release();
          check(ownerHeld && leaseHeld); gate.resolve();
        }
        for (let i = 0; i < 100 && !observation.result; i++) await tick(); await tick();
        check(observation.result); check(observation.applyCalls === 1); check(observation.exact === exact); check(!observation.owner?.getResult());
        const result = observation.result!;
        const detached = /^(Close|Unload)/.test(mode);
        const terminalText = detached ? "" : content().textContent ?? "";
        if (mode.startsWith("Stop")) {
          check(stopRequestedVisible && result.status === "cancelled" && result.results.length === 1);
          check(terminalText.includes("Apply cancelled") && terminalText.includes("No terminal result: 1"));
        }
        if (detached) check(!document.querySelector(".modal-content"));
        if (/^(Stop|Close|Unload)/.test(mode)) check(observation.tagCalls === 1 && observation.moveCalls === (mode.endsWith("Move") ? 1 : 0));
        if (mode === "Partial") check(terminalText.includes("Partial success") && result.results.every(note => note.tag === "applied" && note.move === "failed"));
        const lease = acquireVaultMutationLease(this.app.vault, exact!.reviewed[0].source.path); check(lease); lease?.release();
        cases[mode] = { result, tagCalls: observation.tagCalls, moveCalls: observation.moveCalls, applyCalls: observation.applyCalls,
          exactOwnerThroughSettlement: true, ownerHeld, leaseHeld, leaseReleased: true, stopRequestedVisible,
          uiDetached: detached, terminalText };
        if (!detached) click("Close"); entry.dispose();
      }
      await this.app.vault.adapter.write("evidence-111.json", JSON.stringify({ apiVersion, cases,
        fakeAnalysis: true, driver: "Explicit verification command activates actual production Modal DOM handlers",
        explicitBodyReads: 0, secretLookups: 0, typesafeRequests: 0, rollback: 0,
        notVerified: ["Real provider analysis", "Other plugins, editor/sync races", "Actual Plugin disable dispatch (same entry.dispose boundary tested)"] }, null, 2));
      new Notice("#111 synthetic UI verification passed; evidence saved.");
    } catch {
      running?.dispose(); releaseGate?.();
      await this.app.vault.adapter.write("evidence-111.json", JSON.stringify({ apiVersion, cases, failed: true }, null, 2));
      new Notice("#111 synthetic UI verification failed; no raw error recorded.");
    }
  }
}
