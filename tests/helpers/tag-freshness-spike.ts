import type { TAbstractFile, TagCache, Vault } from "obsidian";

import type { NoteSource } from "../../src/note-source";
import { evaluationContext, fingerprintContent, sameContent, type EvaluationProvenance } from "../../src/tags/evaluation-provenance";
import { resolveTagApplySource } from "../../src/tags/tag-apply-authorization";

type ReadVault = Pick<Vault, "read" | "getFileByPath" | "on" | "offref">;
type ProbeResult = "snapshot-match" | "unavailable";

/** 調査専用。snapshot一致はmutation authorizationではなく、readした文字列の一致だけ。 */
export class CurrentBodyProbe {
  private disposed = false;
  private generation = 0;
  private readonly events;

  constructor(
    private readonly vault: ReadVault,
    private readonly source: NoteSource,
    private readonly fingerprint = fingerprintContent,
  ) {
    const original = resolveTagApplySource(vault, source);
    const invalidate = (file: TAbstractFile) => {
      if (file === original) this.generation++;
    };
    this.events = [vault.on("modify", invalidate), vault.on("delete", invalidate), vault.on("rename", invalidate)];
  }

  async check(provenance: EvaluationProvenance | undefined, signal?: AbortSignal): Promise<ProbeResult> {
    const generation = this.generation;
    const context = evaluationContext(provenance, this.source);
    const file = resolveTagApplySource(this.vault, this.source);
    const valid = () => !this.disposed && !signal?.aborted && generation === this.generation &&
      file !== null && resolveTagApplySource(this.vault, this.source) === file && context !== undefined &&
      file.stat.mtime === context.revision.mtime && file.stat.size === context.revision.size;
    if (!valid() || file === null || !context) return "unavailable";
    try {
      const body = await this.vault.read(file);
      if (!valid()) return "unavailable";
      const current = await this.fingerprint(body);
      if (!valid() || current === undefined) return "unavailable";
      return sameContent(context.content, current) ? "snapshot-match" : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    for (const event of this.events) this.vault.offref(event);
  }
}

type FrontmatterHelpers = Pick<typeof import("obsidian"), "getFrontMatterInfo" | "parseYaml" | "parseFrontMatterTags">;

/** 実helperはObsidian内でのみ利用可能。unit fakeの成功をparser semanticsの証明にしない。 */
export function frontmatterSnapshot(body: string, helpers: FrontmatterHelpers): readonly string[] | undefined {
  try {
    const info = helpers.getFrontMatterInfo(body);
    if (!info.exists) return [];
    const parsed: unknown = helpers.parseYaml(info.frontmatter);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const value: unknown = (parsed as Record<string, unknown>).tags;
    if (value === undefined) return [];
    if (typeof value !== "string" && !(Array.isArray(value) && value.every((tag) => typeof tag === "string"))) return undefined;
    const tags = helpers.parseFrontMatterTags(parsed);
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string" && tag.startsWith("#"))) return undefined;
    return [...tags];
  } catch {
    return undefined;
  }
}

/** positionはliteralのpositive照合にのみ使う。Markdown contextやabsenceは証明しない。 */
export function cachedLiteralPresent(body: string, cached: TagCache): boolean {
  const start = cached.position.start.offset, end = cached.position.end.offset;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= body.length &&
    body.slice(start, end) === cached.tag;
}

/** custom parserではない意図的に不完全な候補。productionには推奨しない。 */
export function conservativeLiteralPresent(body: string, selected: string): boolean {
  return body.includes(selected);
}
