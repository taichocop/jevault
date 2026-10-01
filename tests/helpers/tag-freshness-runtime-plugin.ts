import { Notice, Plugin, getFrontMatterInfo, parseYaml, parseFrontMatterTags } from "obsidian";

import { NoteSource } from "../../src/note-source";
import { captureEvaluationProvenance } from "../../src/tags/evaluation-provenance";
import { IndexedTagMetadataTracker } from "../../src/tags/indexed-tag-metadata";
import { resolveTagApplySource } from "../../src/tags/tag-apply-authorization";
import { CurrentBodyProbe, cachedLiteralPresent, conservativeLiteralPresent, frontmatterSnapshot } from "./tag-freshness-spike";

const selected = ["#aws", "#programming/aws", "#日本語"];

/** isolated synthetic Vault専用の別plugin。通常のmain.jsからは到達しない。 */
export default class TagFreshnessRuntimeSpike extends Plugin {
  private session?: {
    source: NoteSource;
    probe: CurrentBodyProbe;
    tracker: IndexedTagMetadataTracker;
    controller: AbortController;
    provenance?: Awaited<ReturnType<typeof captureEvaluationProvenance>>;
    changed: number;
    ready: boolean;
    stopCounting: () => void;
  };

  onload(): void {
    this.addCommand({ id: "start", name: "Start read-only target snapshot", callback: () => { void this.start(); } });
    this.addCommand({ id: "inspect", name: "Inspect original target snapshot", callback: () => { void this.inspect(); } });
    this.addCommand({ id: "close", name: "Close read-only snapshot", callback: () => this.close() });
  }

  onunload(): void { this.close(); }

  private close(): void {
    const session = this.session;
    this.session = undefined;
    if (!session) return;
    session.controller.abort();
    session.probe.dispose();
    session.tracker.dispose();
    session.stopCounting();
    session.provenance = undefined;
  }

  private async start(): Promise<void> {
    this.close();
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return;
    const source = new NoteSource(file), controller = new AbortController();
    const probe = new CurrentBodyProbe(this.app.vault, source);
    const tracker = new IndexedTagMetadataTracker(this.app.vault, this.app.metadataCache, source);
    const counter = this.app.metadataCache.on("changed", (target) => {
      if (this.session === session && source.matches(target)) session.changed++;
    });
    const session = { source, probe, tracker, controller, changed: 0, ready: false,
      provenance: undefined as Awaited<ReturnType<typeof captureEvaluationProvenance>>,
      stopCounting: () => this.app.metadataCache.offref(counter) };
    this.session = session;
    try {
      if (resolveTagApplySource(this.app.vault, source) !== file) { this.close(); return; }
      const body = await this.app.vault.read(file);
      if (this.session !== session || controller.signal.aborted) return;
      if (resolveTagApplySource(this.app.vault, source) !== file ||
        source.revision?.mtime !== file.stat.mtime || source.revision.size !== file.stat.size) {
        this.close(); return;
      }
      const provenance = await captureEvaluationProvenance(source, body);
      if (this.session !== session || controller.signal.aborted) return;
      session.provenance = provenance;
      session.ready = true;
      new Notice("Spike snapshot ready; no evaluation request or mutation.");
    } catch {
      if (this.session === session) {
        this.close();
        new Notice("Spike snapshot unavailable.");
      }
    }
  }

  private async inspect(): Promise<void> {
    const session = this.session;
    if (!session?.ready) return;
    try {
      const evaluation = await session.probe.check(session.provenance, session.controller.signal);
      if (this.session !== session || session.controller.signal.aborted) return;
      const file = resolveTagApplySource(this.app.vault, session.source);
      if (!file) { new Notice("Spike original source unavailable."); return; }
      const body = await this.app.vault.read(file);
      if (this.session !== session || session.controller.signal.aborted ||
        resolveTagApplySource(this.app.vault, session.source) !== file) return;
      const frontmatter = frontmatterSnapshot(body, { getFrontMatterInfo, parseYaml, parseFrontMatterTags });
      const cache = this.app.metadataCache.getFileCache(file);
      const metadata = session.tracker.snapshot(session.source, session.provenance);
      // statusとbooleanだけを記録する。本文・path・tag collection・digestは出力しない。
      console.info("Jevault #64 read-only spike", {
        evaluationSnapshot: evaluation,
        metadataSnapshot: metadata.status === "verified" ? "verified" : metadata.reason,
        postSessionTargetChanged: session.changed,
        frontmatterHelpers: frontmatter === undefined ? "unverified" : "returned",
        selectedFrontmatterPresent: selected.map((tag) => frontmatter?.includes(tag) ?? null),
        selectedCachedLiteralPresent: selected.map((tag) => cache?.tags?.some((entry) => entry.tag === tag && cachedLiteralPresent(body, entry)) ?? false),
        selectedBodyLiteralPresent: selected.map((tag) => conservativeLiteralPresent(body, tag)),
        tagAbsenceProof: "unverified",
      });
      new Notice("Read-only spike statuses recorded; snapshot results are not Apply authorization.");
    } catch {
      if (this.session === session && !session.controller.signal.aborted) new Notice("Spike inspection unavailable.");
    }
  }
}
