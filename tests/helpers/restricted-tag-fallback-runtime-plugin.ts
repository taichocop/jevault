import { getAllTags, getFrontMatterInfo, Modal, Notice, parseYaml, Plugin, stringifyYaml } from "obsidian";

import { NoteSource } from "../../src/note-source";
import { captureEvaluationProvenance } from "../../src/tags/evaluation-provenance";
import { RestrictedFallbackSpike, restrictedAbsence, type RestrictedHelpers } from "./restricted-tag-fallback-spike";

const vaultName = "Jevault-Issue69-Synthetic";
const targetPath = "Synthetic/A.md";
const body = "Amazon S3 synthetic memo\r\n日本語 body\r\n";
const selected = ["#AWS", "#Programming/AWS", "#日本語"];
const helpers: RestrictedHelpers = { info: getFrontMatterInfo, stringify: stringifyYaml, parse: parseYaml };

/** 一時Synthetic Vault専用。production bundleには含めず、load時の本文readも行わない。 */
export default class RestrictedRuntimeSpike extends Plugin {
  private session?: RestrictedFallbackSpike;
  private controller?: AbortController;
  async onload(): Promise<void> {
    this.addCommand({ id: "run", name: "Issue 69: Run isolated synthetic candidate", callback: () => { void this.run(); } });
    this.addCommand({ id: "inspect", name: "Issue 69: Inspect synthetic round-trip", callback: () => { void this.inspect(); } });
    this.addCommand({ id: "close", name: "Issue 69: Dispose synthetic operation", callback: () => this.close() });
  }
  onunload(): void { this.close(); }
  private close(): void { this.controller?.abort(); this.session?.dispose(); this.session = undefined; this.controller = undefined; }
  private validVault(): boolean { return this.app.vault.getName() === vaultName; }
  private show(values: Record<string, boolean | string>): void {
    // 本文・path・digest・tag collection・生例外はUI/consoleへ渡さない。
    const modal = new Modal(this.app);
    modal.contentEl.createEl("h2", { text: "Issue 69 synthetic observations" });
    for (const [name, value] of Object.entries(values)) modal.contentEl.createEl("p", { text: `${name}: ${value}` });
    modal.open();
  }
  private async run(): Promise<void> {
    if (!this.validVault()) { new Notice("Issue 69 requires its isolated synthetic Vault"); return; }
    if (this.controller || this.session) { new Notice("Dispose the previous synthetic operation first"); return; }
    const file = this.app.vault.getFileByPath(targetPath);
    if (!file) { new Notice("Synthetic fixture unavailable"); return; }
    // read待機中も所有権を固定し、Run連打でClose/unloadのcancel対象を差し替えない。
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const live = () => this.controller === controller && !signal.aborted;
    try {
      const source = new NoteSource(file);
      const current = await this.app.vault.read(file);
      if (!live() || current !== body || !source.matches(file)) return;
      // 固定fixture由来の既存Tagだけを使用。provider/Secret/discoveryを呼ばない。
      const catalog = this.app.vault.getFileByPath("Synthetic/Catalog.md");
      const existing = catalog ? getAllTags(this.app.metadataCache.getFileCache(catalog) ?? {}) ?? [] : [];
      if (!selected.every((tag) => existing.includes(tag))) { new Notice("Synthetic catalog not indexed yet"); return; }
      const provenance = await captureEvaluationProvenance(source, current);
      if (!live()) return;
      this.session = new RestrictedFallbackSpike(this.app.vault, source, provenance, selected, helpers);
      const result = await this.session.apply(selected, signal);
      if (!live()) return;
      this.show({
        result: result.status,
        plain: restrictedAbsence("Plain synthetic prose", helpers),
        headingRejected: !restrictedAbsence("# Heading", helpers),
        frontmatterRejected: !restrictedAbsence("---\ntags: [aws]\n---\nbody", helpers),
        emptyFrontmatterRejected: !restrictedAbsence("---\n---\nbody", helpers),
        malformedRejected: !restrictedAbsence("---\ntags: [aws]\nbody", helpers),
        bomRejected: !restrictedAbsence("\uFEFFbody", helpers),
        crlf: restrictedAbsence("Plain\r\nsynthetic", helpers),
        lf: restrictedAbsence("Plain\nsynthetic", helpers),
        leadingContent: restrictedAbsence(" leading\nsynthetic", helpers),
      });
    } catch { if (!signal.aborted) this.show({ result: "sanitized-failure" }); }
  }
  private async inspect(): Promise<void> {
    if (!this.validVault()) return;
    const file = this.app.vault.getFileByPath(targetPath);
    if (!file) return;
    try {
      const current = await this.app.vault.read(file), info = getFrontMatterInfo(current);
      const parsed: unknown = parseYaml(info.frontmatter);
      const tags = getAllTags(this.app.metadataCache.getFileCache(file) ?? {}) ?? [];
      const values = typeof parsed === "object" && parsed !== null && "tags" in parsed ? parsed.tags : undefined;
      this.show({
        frontmatter: info.exists,
        bodyPreserved: current.slice(info.contentStart) === body,
        representationPreserved: Array.isArray(values) && values.length === selected.length && values.every((value, index) => value === selected[index].slice(1)),
        recognized: selected.every((name) => tags.includes(name)),
      });
    } catch { this.show({ result: "sanitized-failure" }); }
  }
}
