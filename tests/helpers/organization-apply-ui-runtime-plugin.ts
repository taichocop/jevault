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
const verificationCases = ["TagOnly", "MoveOnly", "Both", "SameFolder", "Keep", "Partial", "StopTag", "StopMove",
  "CloseTag", "CloseMove", "UnloadTag", "UnloadMove", "Cancel", "Esc", "X"] as const;
type GuardStatus = "allowed" | "vault-rejected" | "marker-unavailable";
type StartupStage = "guard" | "controller" | "file-menu" | "original-command" | "retry-command";
type StartupStatus = Exclude<GuardStatus, "allowed"> | `failed-${StartupStage}` | "ready";
type VerificationStage = "fixture" | "entry" | "preview" | "analysis" | "review" | "review-selection" |
  "finish-review" | "apply-navigation" | "confirmation" | "cancel-before-confirm" | "confirm-apply" |
  "await-api" | "abort-action" | "authority-held" | "await-settlement" | "service-result" |
  "x-locate" | "x-dispatch" | "x-dismissed" | "stop-truth" | "ui-detached" | "mutation-counts" | "partial-truth" | "lease-released" | "case-close" | "save";
const tick = () => new Promise<void>(resolve => window.setTimeout(resolve, 30));
interface Observation {
  tagCalls: number; moveCalls: number; applyCalls: number;
  result?: OrganizationApplyResult;
  owner?: OrganizationReviewSession;
  exact?: OrganizationReviewResult;
  signal?: AbortSignal;
  abortObservedAtAction?: boolean;
}

/** 明示command専用の合成UI driver。本番bundleからimportせず、分析はfakeだけ。 */
export default class OrganizationApplyUIRuntimeVerification extends Plugin {
  private entry?: FolderOrganizerEntryController;
  private attempted = false;
  private startupStatus?: StartupStatus;
  private startupNotice?: Notice;
  private guardStatus(): GuardStatus {
    if (!this.app.vault.getName().startsWith("Jevault-111-Synthetic-")) return "vault-rejected";
    return this.app.vault.getFileByPath("SYNTHETIC-111.marker.md") ? "allowed" : "marker-unavailable";
  }
  private safe(): boolean { return this.guardStatus() === "allowed"; }
  private reportStartup(status: StartupStatus): void {
    this.startupStatus = status;
    // 未index/起動例外をsilent zero-commandにせず、有限コードだけ表示する。
    try {
      this.startupNotice?.hide();
      this.startupNotice = new Notice(`#111 verification startup: ${status}`, 0);
    } catch { /* Notice自体の例外もraw情報を出さない。 */ }
  }
  onload(): void {
    let stage: StartupStage = "guard";
    try {
      const guard = this.guardStatus();
      if (guard !== "allowed") { this.reportStartup(guard); return; }
      stage = "controller";
      this.entry = this.controller("Interactive", { tagCalls: 0, moveCalls: 0, applyCalls: 0 });
      stage = "file-menu";
      this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => { if (this.safe()) this.entry?.addToMenu(menu, file); }));
      stage = "original-command";
      this.addCommand({ id: "verify-ui", name: "Run isolated #111 DOM UI verification", callback: () => { void this.verify(); } });
      stage = "retry-command";
      this.addCommand({ id: "verify-ui-diagnostic", name: "Run isolated #111 Retry2 diagnostic UI verification",
        callback: () => { void this.verify("Cases/Retry2", "Dest/Retry2"); } });
      this.reportStartup("ready");
    } catch {
      this.entry?.dispose(); this.entry = undefined;
      this.reportStartup(`failed-${stage}`);
    }
  }
  onunload(): void { this.entry?.dispose(); this.startupNotice?.hide(); }

  private controller(mode: string, observation: Observation, gate?: ReturnType<typeof deferred>, started?: ReturnType<typeof deferred>,
    destination: "Dest" | "Dest/Retry2" = "Dest"): FolderOrganizerEntryController {
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
              ? target.source.path.slice(0, target.source.path.lastIndexOf("/")) : destination, probability: 1 }] } } },
          tags: { status: "success", value: { status: "success", source: target.source, noteTitle: "Synthetic",
            suggestions: [{ tagName: "#runtime", tagId: "fixture", choice: "match", matchProbability: 1 }] } },
        }));
        return { status: "completed", results: Object.freeze(notes), progress: { total: notes.length, processed: notes.length,
          failed: notes.filter(note => note.status === "failed").length } };
      },
    }, { prepare: (analysis, signal) => {
      const owner = review.prepare(analysis, signal); observation.owner = owner; return owner;
    } }, { apply: async (intent, signal, onProgress) => {
      observation.applyCalls++; observation.signal = signal; observation.exact = observation.owner?.getResult();
      const result = await service.apply(intent, signal, onProgress); observation.result = result; return result;
    } });
  }

  private async verify(fixtureRoot: "Cases" | "Cases/Retry2" = "Cases",
    destination: "Dest" | "Dest/Retry2" = "Dest"): Promise<void> {
    if (!this.safe() || this.attempted) return;
    this.attempted = true;
    const cases: Record<string, unknown> = {};
    let running: FolderOrganizerEntryController | undefined;
    let releaseGate: (() => void) | undefined;
    let currentCase: typeof verificationCases[number] | "not-started" = "not-started";
    let stage: VerificationStage = "fixture";
    let activeObservation: Observation | undefined;
    const check = (value: unknown): void => { if (!value) throw new Error("Synthetic assertion failed"); };
    const content = () => document.querySelector<HTMLElement>(".modal-content")!;
    const click = (label: string): HTMLButtonElement => {
      const button = Array.from(content().querySelectorAll("button")).find(button => button.textContent === label)!;
      check(button && !button.disabled); button.click(); return button;
    };
    const closeUi = () => {
      const body = content();
      const container = body?.closest<HTMLElement>(".modal-container");
      const candidates = container ? Array.from(container.querySelectorAll<HTMLElement>(
        '.modal-header-button.mod-raised.clickable-icon, .modal-close-button, [aria-label="Close"], [title="Close"]')).filter(element => !body.contains(element)) : [];
      const native = candidates.filter(element => !candidates.some(parent => parent !== element && parent.contains(element)));
      return { native, counts: {
        containerPresent: !!container,
        legacyInDocument: document.querySelectorAll(".modal-close-button").length,
        legacyInContainer: container?.querySelectorAll(".modal-close-button").length ?? 0,
        nativeHeaderInContainer: container?.querySelectorAll(".modal-header-button.mod-raised.clickable-icon").length ?? 0,
        nativeHeaderXIcons: container?.querySelectorAll(".modal-header-button.mod-raised.clickable-icon svg.lucide-x").length ?? 0,
        ariaCloseInContainer: container?.querySelectorAll('[aria-label="Close"]').length ?? 0,
        titleCloseInContainer: container?.querySelectorAll('[title="Close"]').length ?? 0,
        nativeOutsideContent: native.length,
      } };
    };
    let closeUiAtAction: ReturnType<typeof closeUi>["counts"] | undefined;
    const closeX = () => {
      stage = "x-locate";
      const ui = closeUi(); closeUiAtAction = ui.counts;
      check(ui.native.length === 1);
      const close = ui.native[0], view = close.ownerDocument.defaultView;
      check(view);
      stage = "x-dispatch";
      // native dismissだけに、そのdocumentのclickを送る。Close button/APIへfallbackしない。
      close.dispatchEvent(new view!.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    };
    try {
      for (const mode of verificationCases) {
        currentCase = mode; stage = "fixture"; closeUiAtAction = undefined;
        const observation: Observation = { tagCalls: 0, moveCalls: 0, applyCalls: 0 }; activeObservation = observation;
        const gate = deferred(), started = deferred(); releaseGate = gate.resolve;
        const entry = this.controller(mode, observation, gate, started, destination); running = entry;
        const folder = this.app.vault.getAbstractFileByPath(`${fixtureRoot}/${mode}`); check(folder instanceof TFolder);
        let navigate!: () => void;
        // 本番entry callbackを起点にし、以降は実際のObsidian Modal DOMのみを操作する。
        entry.addToMenu({ addItem: (cb: (item: unknown) => void) => {
          const item = { setTitle: () => item, onClick: (action: () => void) => { navigate = action; return item; } }; cb(item);
        } } as unknown as Menu, folder!);
        stage = "entry"; navigate(); await tick();
        stage = "preview"; click("Preview notes");
        stage = "analysis"; click("Analyze notes"); await tick();
        stage = "review"; click("Review results"); await tick();
        check(!Array.from(content().querySelectorAll("button")).some(button => button.textContent === "Apply selected changes"));
        stage = "review-selection";
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
              select.value = destination; select.dispatchEvent(new Event("change"));
            }
            if (!["MoveOnly", "Keep"].includes(mode)) {
              const tag = content().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
              tag.checked = true; tag.dispatchEvent(new Event("change"));
            }
          }
          if (index < 2) click("Next");
        }
        stage = "finish-review"; click("Finish review"); const exact = observation.owner?.getResult(); check(exact);
        stage = "apply-navigation";
        const staleApply = click("Apply selected changes"); await tick(); staleApply.click();
        stage = "confirmation";
        const confirmationText = content().textContent ?? "";
        check(confirmationText.includes("Reviewed: 2. Unavailable: 1")); check(confirmationText.includes("Tag + Move is not atomic"));
        check(observation.owner?.getResult() === exact); check(observation.tagCalls === 0 && observation.moveCalls === 0 && observation.applyCalls === 0);
        const staleConfirm = Array.from(content().querySelectorAll("button")).find(button => button.textContent === "Confirm Apply")!;
        if (["Cancel", "Esc", "X"].includes(mode)) {
          stage = "cancel-before-confirm";
          if (mode === "Cancel") click("Cancel"); else if (mode === "X") closeX();
          else document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
          await tick(); staleConfirm.click(); await tick();
          if (mode === "X") stage = "x-dismissed";
          check(observation.applyCalls === 0 && observation.tagCalls === 0 && observation.moveCalls === 0);
          check(!observation.owner?.getResult());
          cases[mode] = { zeroMutationBeforeConfirm: true, invalidatedOwner: true, staleConfirmIgnored: true, nativeXUi: mode === "X" ? closeUiAtAction : undefined }; entry.dispose(); continue;
        }
        stage = "confirm-apply"; click("Confirm Apply"); staleConfirm.click();
        let ownerHeld = false, leaseHeld = false, stopRequestedVisible = false;
        if (/^(Stop|Close|Unload)/.test(mode)) {
          stage = "await-api";
          await Promise.race([started.promise, new Promise((_, reject) => window.setTimeout(() => reject(new Error("Synthetic timeout")), 3000))]);
          stage = "abort-action";
          closeUiAtAction = closeUi().counts;
          if (mode.startsWith("Stop")) { const stop = click("Stop"); stop.click(); stopRequestedVisible = content().textContent?.includes("Stop requested") ?? false; }
          else if (mode.startsWith("Close")) click("Close"); else entry.dispose();
          observation.abortObservedAtAction = observation.signal?.aborted ?? false;
          stage = "authority-held";
          ownerHeld = observation.owner?.getResult() === exact;
          const first = exact!.reviewed[0], target = `${destination}/${first.source.path.split("/").at(-1)}`;
          const lease = acquireVaultMutationLease(this.app.vault, first.source.path, target); leaseHeld = !lease; lease?.release();
          check(observation.abortObservedAtAction && ownerHeld && leaseHeld); gate.resolve();
        }
        stage = "await-settlement";
        for (let i = 0; i < 100 && !observation.result; i++) await tick(); await tick();
        stage = "service-result";
        check(observation.result); check(observation.applyCalls === 1); check(observation.exact === exact); check(!observation.owner?.getResult());
        const result = observation.result!;
        const detached = /^(Close|Unload)/.test(mode);
        const terminalText = detached ? "" : content().textContent ?? "";
        if (mode.startsWith("Stop")) {
          stage = "stop-truth";
          check(stopRequestedVisible && result.status === "cancelled" && result.results.length === 1);
          check(terminalText.includes("Apply cancelled") && terminalText.includes("No terminal result: 1"));
        }
        stage = "ui-detached";
        if (detached) check(!document.querySelector(".modal-content"));
        stage = "mutation-counts";
        if (/^(Stop|Close|Unload)/.test(mode)) check(observation.tagCalls === 1 && observation.moveCalls === (mode.endsWith("Move") ? 1 : 0));
        stage = "partial-truth";
        if (mode === "Partial") check(terminalText.includes("Partial success") && result.results.every(note => note.tag === "applied" && note.move === "failed"));
        stage = "lease-released";
        const lease = acquireVaultMutationLease(this.app.vault, exact!.reviewed[0].source.path); check(lease); lease?.release();
        cases[mode] = { result, tagCalls: observation.tagCalls, moveCalls: observation.moveCalls, applyCalls: observation.applyCalls,
          exactOwnerThroughSettlement: true, ownerHeld, leaseHeld, leaseReleased: true, stopRequestedVisible,
          uiDetached: detached, abortObservedAtAction: observation.abortObservedAtAction, closeUiAtAction, terminalText };
        stage = "case-close";
        if (!detached) click("Close"); entry.dispose();
      }
      stage = "save";
      await this.app.vault.adapter.write("evidence-111.json", JSON.stringify({ apiVersion, fixtureRoot, destination, cases,
        fakeAnalysis: true, driver: "Explicit verification command activates actual production Modal DOM handlers",
        explicitBodyReads: 0, secretLookups: 0, typesafeRequests: 0, rollback: 0,
        notVerified: ["Real provider analysis", "Other plugins, editor/sync races", "Actual Plugin disable dispatch (same entry.dispose boundary tested)"] }, null, 2));
      new Notice("#111 synthetic UI verification passed; evidence saved.");
    } catch {
      // 有限case/stageとboolean/countだけ。raw例外やDOM本文は診断へ保存しない。
      const failure = { case: currentCase, stage, tagCalls: activeObservation?.tagCalls ?? 0,
        moveCalls: activeObservation?.moveCalls ?? 0, applyCalls: activeObservation?.applyCalls ?? 0,
        ownerActive: !!activeObservation?.owner?.getResult(), signalAborted: activeObservation?.signal?.aborted ?? false,
        abortObservedAtAction: activeObservation?.abortObservedAtAction,
        serviceSettled: !!activeObservation?.result, serviceStatus: activeObservation?.result?.status,
        modalContentCount: document.querySelectorAll(".modal-content").length, closeUiAtAction };
      running?.dispose(); releaseGate?.(); await tick();
      await this.app.vault.adapter.write("evidence-111.json", JSON.stringify({ apiVersion, fixtureRoot, destination, cases, failed: true,
        failure, failedCaseResultAfterCleanup: activeObservation?.result }, null, 2));
      new Notice("#111 synthetic UI verification failed; no raw error recorded.");
    }
  }
}
