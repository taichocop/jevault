import { readFileSync } from "node:fs";
import type { TAbstractFile, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => ({ ...await import("./helpers/obsidian-move"),
  parseFrontMatterTags: vi.fn((fm: Record<string, unknown>) =>
    typeof fm.tags === "string" ? fm.tags.split(",").map(name => `#${name.trim()}`) : null),
}));

import { NoteSource } from "../src/note-source";
import { NoteMoveService, createMovePlan } from "../src/note-move-service";
import { TagApplyService } from "../src/tags/tag-apply-service";
import { TagApplyPreparationSession } from "../src/tags/tag-apply-preparation";
import { TagSuggestionGrantIssuer } from "../src/tags/tag-suggestion-grant";
import { TFile as FakeFile, TFolder as FakeFolder } from "./helpers/obsidian-move";
import {
  OrganizerConfirmationSession, acceptedReview, strictSource, captureBaseline, syntheticReview,
  acquireLease, underLease, mutationKey, runConfirmedSpike, applyProgress, noteTruth,
  type SpikeHooks,
} from "./helpers/organizer-apply-safety-spike";

function file(path = "Inbox/A.md"): TFile {
  return Object.assign(new FakeFile(path), { stat: { ctime: 1, mtime: 2, size: 100 } }) as TFile;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function harness(tags: readonly string[] = ["#reviewed"], destination: string | null = "Dest", count = 1) {
  const files = Array.from({ length: count }, (_, i) => file(`Inbox/${String.fromCharCode(65 + i)}.md`));
  const folder = new FakeFolder("Dest");
  const entries = new Map<string, unknown>([[folder.path, folder], ...files.map(f => [f.path, f] as const)]);
  const forbidden = vi.fn(() => { throw new Error("Forbidden local or external boundary"); });
  const vault = { getAbstractFileByPath: vi.fn((path: string) => (entries.get(path) ?? null) as TAbstractFile | null),
    getFileByPath: vi.fn((path: string) => (entries.get(path) ?? null) as TFile | null),
    read: forbidden, cachedRead: forbidden, create: forbidden, createFolder: forbidden, delete: forbidden,
    modify: forbidden, process: forbidden, secretLookup: forbidden, typesafe: forbidden,
    reanalysis: forbidden, recollection: forbidden,
  };
  const frontmatter: Record<string, unknown> = { tags: ["KEEP"], aliases: ["synthetic"], custom: { preserve: true } };
  const manager = {
    processFrontMatter: vi.fn(async (f: TFile, callback: (fm: Record<string, unknown>) => void) => {
      callback(frontmatter); f.stat.mtime++; f.stat.size += 20;
    }),
    renameFile: vi.fn(async (f: TAbstractFile, target: string) => { entries.delete(f.path); f.path = target; entries.set(target, f); }),
  };
  const review = syntheticReview(files, tags, destination);
  const confirmation = new OrganizerConfirmationSession(vault, review);
  const controller = new AbortController();
  const eligible = vi.fn((path: string) => path === "Dest");
  const run = (hooks: SpikeHooks = {}, intent: unknown = confirmation.confirm()) =>
    runConfirmedSpike(vault, manager, intent, controller.signal, eligible, hooks);
  const source = review.getResult()!.reviewed[0].source;
  return { files, file: files[0], folder, entries, vault, forbidden, frontmatter, manager,
    review, confirmation, controller, eligible, run, source };
}
function manualConfirmation(h: ReturnType<typeof harness>) {
  const outcome = { status: "success" as const, source: h.source, noteTitle: "Synthetic",
    suggestions: [{ tagName: "#manual", tagId: "1", choice: "match" as const, matchProbability: 1 }] };
  const lifetime = new TagSuggestionGrantIssuer(h.vault).issue(outcome)!;
  const session = new TagApplyPreparationSession(h.vault, { on: vi.fn(), offref: vi.fn() }, h.file);
  session.prepare(outcome, lifetime);
  return session.confirm(["#manual"])!;
}
afterEach(() => vi.restoreAllMocks());

describe("#103 confirmation evidence 1–8, exact intent and lifetime", () => {
  it.each(["review", "analysis", "draft", "active", "path", "forged"])("rejects bare %s authority with zero mutations", async input => {
    const h = harness();
    const values: Record<string, unknown> = { review: h.review.getResult(), analysis: h.review.getAnalysisResult(),
      draft: h.review.getDraft(0), active: h.file, path: h.file.path, forged: { kind: "organizer-confirmation" } };
    expect(await h.run({}, values[input])).toEqual({ status: "stopped", reason: "invalid-confirmation", results: [] });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("does not issue from an unfinished review or bare Review result", () => {
    const h = harness();
    expect(new OrganizerConfirmationSession(h.vault, h.review.getResult() as never).confirm()).toBeUndefined();
    h.review.dispose(); expect(h.confirmation.confirm()).toBeUndefined();
  });
  it("rejects copied, serialized, cross-Vault and Manual Tag confirmation objects", () => {
    const h = harness(), token = h.confirmation.confirm()!;
    for (const copy of [{ ...token }, JSON.parse(JSON.stringify(token)), manualConfirmation(h)]) {
      expect(acceptedReview(copy, h.vault, h.controller.signal)).toBeUndefined();
    }
    expect(acceptedReview(token, { ...h.vault }, h.controller.signal)).toBeUndefined();
    expect(acceptedReview(token, h.vault, h.controller.signal)).toBe(h.review.getResult());
  });
  it("binds exact immutable Review object/Folder/Tags; no request can replace it", async () => {
    const h = harness(["#reviewed", "#日本語", "#nested/tag"]), exact = h.review.getResult()!;
    const other = syntheticReview([h.file], ["#other"], null).getResult();
    expect(other).not.toBe(exact);
    const token = h.confirmation.confirm()!;
    expect(acceptedReview(token, h.vault, h.controller.signal)).toBe(exact);
    expect(Object.isFrozen(exact.reviewed[0].selectedTags)).toBe(true);
    expect(Object.isFrozen(exact.reviewed[0].folder)).toBe(true);
    expect(exact.reviewed[0].selectedTags).toEqual(["#reviewed", "#日本語", "#nested/tag"]);
    expect(acceptedReview(token, h.vault, h.controller.signal)).toBeUndefined();
    expect(await h.run({}, token)).toMatchObject({ status: "stopped", reason: "invalid-confirmation" });
  });
  it.each(["confirmation", "review"])("%s disposal invalidates issued confirmation", which => {
    const h = harness(), token = h.confirmation.confirm();
    (which === "confirmation" ? h.confirmation : h.review).dispose();
    expect(acceptedReview(token, h.vault, h.controller.signal)).toBeUndefined();
  });
  it.each(["confirmation", "review"])("%s disposal immediately before Tag starts no API and stops", async which => {
    const h = harness();
    const result = await h.run({ beforeTag: () => (which === "confirmation" ? h.confirmation : h.review).dispose() });
    expect(result).toMatchObject({ status: "stopped", reason: "invalid-confirmation" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it.each(["confirmation", "review"])("%s disposal while negative destination prevalidation settles stops globally", async which => {
    const h = harness(); h.eligible.mockReturnValue(false);
    const pending = h.run(); (which === "confirmation" ? h.confirmation : h.review).dispose();
    expect(await pending).toMatchObject({ status: "stopped", reason: "invalid-confirmation" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
    const next = acquireLease(h.vault, h.source); expect(next).toBeDefined(); next?.release();
  });
  it.each(["confirmation", "review"])("%s disposal during Tag internal callback wait prevents assignment and stops globally", async which => {
    const h = harness(["#reviewed"], "Dest", 2), gate = deferred(), before = structuredClone(h.frontmatter);
    h.manager.processFrontMatter.mockImplementationOnce(async (_f, callback) => { await gate.promise; callback(h.frontmatter); });
    const pending = h.run(); await flush(); (which === "confirmation" ? h.confirmation : h.review).dispose(); gate.resolve();
    const result = await pending;
    expect(result).toMatchObject({ status: "stopped", reason: "invalid-confirmation" }); expect(result.results).toHaveLength(1);
    expect(result.results[0].tag).toBe("failed"); expect(h.frontmatter).toEqual(before);
    expect(h.manager.processFrontMatter).toHaveBeenCalledOnce(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it.each(["confirmation", "review"])("%s disposal after settled Tag and before Move preserves partial truth", async which => {
    for (const stage of ["afterTag", "beforeMove"] as const) {
      const h = harness(), dispose = () => (which === "confirmation" ? h.confirmation : h.review).dispose();
      const result = await h.run({ [stage]: dispose });
      expect(result).toMatchObject({ status: "stopped", reason: "invalid-confirmation" });
      expect(result.results[0]).toMatchObject({ tag: "applied", move: "not-started-prior-failure", outcome: "partial" });
      expect(h.frontmatter.tags).toEqual(["KEEP", "reviewed"]); expect(h.manager.renameFile).not.toHaveBeenCalled();
      const next = acquireLease(h.vault, h.source); expect(next).toBeDefined(); next?.release();
    }
  });
  it("lifetime revocation during final eligibility lookup blocks Move without stale mislabel", async () => {
    const h = harness();
    h.eligible.mockImplementationOnce(() => true).mockImplementationOnce(() => true).mockImplementationOnce(() => {
      h.confirmation.dispose(); return true;
    });
    const result = await h.run();
    expect(result).toMatchObject({ status: "stopped", reason: "invalid-confirmation" });
    expect(result.results[0]).toMatchObject({ tag: "applied", move: "not-started-prior-failure", outcome: "partial" });
    expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("initial abort leaves confirmation unused", async () => {
    const h = harness(), token = h.confirmation.confirm()!; h.controller.abort();
    expect(await h.run({}, token)).toEqual({ status: "cancelled", results: [] });
    expect(acceptedReview(token, h.vault, new AbortController().signal)).toBe(h.review.getResult());
  });
  it.each(["busy", "stale", "tag-failure", "move-failure", "cancelled"])("accepted %s attempt is one-shot", async state => {
    const h = harness(), token = h.confirmation.confirm()!;
    const lease = state === "busy" ? acquireLease(h.vault, h.source) : undefined;
    if (state === "stale") h.file.stat.mtime++;
    if (state === "tag-failure") h.manager.processFrontMatter.mockRejectedValue(new Error("synthetic-private"));
    if (state === "move-failure") h.manager.renameFile.mockRejectedValue(new Error("synthetic-private"));
    await h.run(state === "cancelled" ? { beforeTag: () => h.controller.abort() } : {}, token);
    lease?.release();
    expect(acceptedReview(token, h.vault, new AbortController().signal)).toBeUndefined();
    expect(h.confirmation.confirm()).toBeDefined();
  });
});

describe("#103 original/post-Tag stale evidence 9–15, 25–28", () => {
  const changes: Record<string, (h: ReturnType<typeof harness>) => void> = {
    replacement: h => h.entries.set(h.source.path, file(h.source.path)),
    renamed: h => { h.file.path = "Inbox/Renamed.md"; },
    moved: h => { h.file.path = "Other/A.md"; },
    deleted: h => { h.entries.delete(h.source.path); },
    mtime: h => { h.file.stat.mtime++; },
    size: h => { h.file.stat.size++; },
    nonMarkdown: h => { h.file.extension = "txt"; },
    folder: h => { h.entries.set(h.source.path, new FakeFolder(h.source.path)); },
    nan: h => { h.file.stat.mtime = NaN; },
    infinite: h => { h.file.stat.size = Infinity; },
    negative: h => { h.file.stat.size = -1; },
  };
  it("accepts exact file/path/finite original stat without body reads", () => {
    const h = harness(), note = h.review.getResult()!.reviewed[0];
    expect(strictSource(h.vault, h.source, note.snapshot, h.controller.signal)).toBe(h.file);
    expect(strictSource(h.vault, h.source, { ...note.snapshot, path: "Other.md" }, h.controller.signal)).toBeNull();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(Object.keys(changes))("original %s produces stale, Tag/Move/body 0", async kind => {
    const h = harness(); changes[kind](h);
    expect((await h.run()).results[0]).toMatchObject({ tag: "not-started-stale", move: "not-started-stale", outcome: "stale" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(Object.keys(changes))("post-Tag %s blocks Move and retains applied Tag truth", async kind => {
    const h = harness();
    const result = await h.run({ afterTag: () => changes[kind](h) });
    expect(result.results[0]).toMatchObject({ tag: "applied", move: "not-started-stale", outcome: "partial" });
    expect(h.manager.renameFile).not.toHaveBeenCalled(); expect(h.frontmatter.tags).toEqual(["KEEP", "reviewed"]);
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("awaits actual Tag settlement before capturing immutable baseline; own write passes Move", async () => {
    const h = harness(), gate = deferred(), baselines: unknown[] = [];
    h.manager.processFrontMatter.mockImplementationOnce(async (f, callback) => {
      callback(h.frontmatter); await gate.promise; f.stat.mtime += 4; f.stat.size += 25;
    });
    const pending = h.run({ afterTag: baseline => baselines.push(baseline) }); await flush();
    expect(baselines).toEqual([]); expect(h.manager.renameFile).not.toHaveBeenCalled();
    gate.resolve(); expect((await pending).results[0]).toMatchObject({ tag: "applied", move: "applied", outcome: "moved-and-tags" });
    expect(baselines).toEqual([{ path: "Inbox/A.md", mtime: 6, size: 125 }]); expect(Object.isFrozen(baselines[0])).toBe(true);
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("no Tag work uses original baseline, never accepts a refreshed stale baseline", async () => {
    const h = harness([]);
    const result = await h.run({ beforeMove: () => h.file.stat.mtime++ });
    expect(result.results[0]).toMatchObject({ tag: "not-selected", move: "not-started-stale", outcome: "stale" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
});

describe("#103 additive Tag and destination evidence 16–24, 29–34", () => {
  it("zero selected Tags and Keep current call neither mutation API", async () => {
    const h = harness([], null), result = await h.run();
    expect(result.results[0]).toEqual({ index: 0, tag: "not-selected", move: "keep-current", outcome: "unchanged" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("additive only: preserves supported list/duplicates/order/unrelated fields and semantic identity", async () => {
    const h = harness(["#keep", "#new", "#NEW", "#日本語", "#nested/tag"], null);
    h.frontmatter.tags = ["KEEP", "KEEP", "#existing"];
    const unrelated = h.frontmatter.custom;
    expect((await h.run()).results[0]).toMatchObject({ tag: "applied", move: "keep-current", outcome: "updated-tags" });
    expect(h.frontmatter.tags).toEqual(["KEEP", "KEEP", "#existing", "new", "日本語", "nested/tag"]);
    expect(h.frontmatter.custom).toBe(unrelated); expect(h.frontmatter.aliases).toEqual(["synthetic"]);
    expect(h.manager.processFrontMatter).toHaveBeenCalledOnce(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it.each(["list", "scalar"])("current %s duplicate wins over advisory metadata and returns unchanged", async representation => {
    const h = harness(["#KEEP"], null); h.frontmatter.tags = representation === "list" ? ["keep"] : "keep";
    expect((await h.run()).results[0]).toMatchObject({ tag: "unchanged", outcome: "unchanged" });
    expect(h.frontmatter.tags).toEqual(representation === "list" ? ["keep"] : "keep"); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("callback current frontmatter controls duplicates after API internal read wait", async () => {
    const h = harness(), gate = deferred();
    h.manager.processFrontMatter.mockImplementationOnce(async (_file, callback) => { await gate.promise; callback(h.frontmatter); });
    const pending = h.run(); await flush(); h.frontmatter.tags = ["REVIEWED"]; gate.resolve();
    expect((await pending).results[0]).toMatchObject({ tag: "unchanged", move: "applied", outcome: "moved" });
    expect(h.frontmatter.tags).toEqual(["REVIEWED"]);
  });
  it.each([null, 5, {}, ["ok", null], ["has space"], ["#"], ""])("unsupported tags %j fail without Move/retry/rollback or raw data", async unsupported => {
    const h = harness(); h.frontmatter.tags = unsupported;
    const before = structuredClone(h.frontmatter);
    const result = await h.run();
    expect(result.results[0]).toMatchObject({ tag: "failed", move: "not-started-prior-failure", outcome: "failed", reason: "tag" });
    expect(h.frontmatter).toEqual(before); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect(h.manager.processFrontMatter).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain("tags");
  });
  it("sanitizes raw API exceptions and keeps successful Tag after Move failure", async () => {
    const h = harness(); h.manager.renameFile.mockRejectedValue(new Error("PRIVATE synthetic body/frontmatter/absolute-path/provider"));
    const result = await h.run();
    expect(result.results[0]).toEqual({ index: 0, tag: "applied", move: "failed", outcome: "partial", reason: "move" });
    expect(h.frontmatter.tags).toEqual(["KEEP", "reviewed"]); expect(h.manager.processFrontMatter).toHaveBeenCalledOnce();
    expect(h.manager.renameFile).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it.each(["missing", "file", "ineligible", "collision", "case", "unicode", "unsafe"])("destination %s rejects before Tag; no overwrite or suffix", async kind => {
    const h = harness();
    if (kind === "missing") h.entries.delete("Dest");
    if (kind === "file") h.entries.set("Dest", file("Dest"));
    if (kind === "ineligible") h.eligible.mockReturnValue(false);
    if (kind === "collision") h.entries.set("Dest/A.md", file("Dest/A.md"));
    if (kind === "case") h.folder.children.push(new FakeFile("Dest/a.MD"));
    if (kind === "unicode") {
      h.file.name = "é.md"; h.file.path = "Inbox/é.md"; h.entries.set(h.file.path, h.file);
      h.review = syntheticReview([h.file]); h.confirmation = new OrganizerConfirmationSession(h.vault, h.review);
      h.folder.children.push(new FakeFile("Dest/e\u0301.md"));
    }
    const intent = kind === "unsafe" ? new OrganizerConfirmationSession(h.vault, syntheticReview([h.file], ["#reviewed"], "../Dest")).confirm()
      : h.confirmation.confirm();
    const result = await h.run({}, intent);
    expect(result.results[0].move).toBe("failed"); expect(h.manager.processFrontMatter).not.toHaveBeenCalled();
    expect(h.manager.renameFile).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(["missing", "collision", "ineligible"])("post-Tag destination %s is revalidated and produces partial", async kind => {
    const h = harness();
    const result = await h.run({ afterTag: () => {
      if (kind === "missing") h.entries.delete("Dest");
      if (kind === "collision") h.entries.set("Dest/A.md", file("Dest/A.md"));
      if (kind === "ineligible") h.eligible.mockReturnValue(false);
    } });
    expect(result.results[0]).toMatchObject({ tag: "applied", move: "failed", outcome: "partial" });
    expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("exact reviewed Tag survives unrelated universe changes without rediscovery", async () => {
    const h = harness(["#reviewed"], null);
    h.entries.set("Other.md", file("Other.md"));
    expect((await h.run()).results[0].tag).toBe("applied"); expect(h.forbidden).not.toHaveBeenCalled();
  });
});

describe("#103 shared production coordination regression evidence 35–46", () => {
  it("Manual Tag/Move shared leases block same-source overlap", async () => {
    const h = harness(), gate = deferred(), token = manualConfirmation(h);
    h.manager.processFrontMatter.mockImplementationOnce(async (_f, callback) => { callback(h.frontmatter); await gate.promise; });
    const tag = new TagApplyService(h.vault, h.manager).apply({ confirmation: token }, h.controller.signal);
    await flush(); expect(h.manager.processFrontMatter).toHaveBeenCalledOnce();
    const move = await new NoteMoveService(h.vault, h.manager).move(h.source, ["Dest"], "Dest", h.controller.signal);
    expect(move).toEqual({ status: "failure", reason: "busy" }); expect(h.manager.renameFile).not.toHaveBeenCalled();
    gate.resolve(); await tag;
  });
  it.each(["manual-move/organizer-tag", "manual-tag/organizer-move", "organizer-tag/organizer-move", "organizer/organizer", "manual-move/manual-move", "manual-tag/manual-tag"])(
    "shared production leases exclude %s across service instances around actual APIs", async schedule => {
      const h = harness(), gate = deferred();
      const manualTag = () => new TagApplyService(h.vault, h.manager).apply({ confirmation: manualConfirmation(h) }, h.controller.signal);
      const manualMove = () => new NoteMoveService(h.vault, h.manager).move(h.source, ["Dest"], "Dest", h.controller.signal);
      const firstMove = schedule.startsWith("manual-move");
      if (firstMove) h.manager.renameFile.mockImplementationOnce(async () => { await gate.promise; });
      else h.manager.processFrontMatter.mockImplementationOnce(async (_f, callback) => { callback(h.frontmatter); await gate.promise; });
      const first = schedule.startsWith("organizer") ? h.run() : firstMove ? manualMove() : manualTag();
      await flush();
      const second = schedule.endsWith("manual-move") ? await manualMove()
        : schedule.endsWith("manual-tag") ? await manualTag() : await h.run();
      if ("results" in second) expect(second.results[0].reason).toBe("busy");
      else expect(second).toEqual({ status: "failure", reason: "busy" });
      expect(h.manager.processFrontMatter.mock.calls.length + h.manager.renameFile.mock.calls.length).toBe(1);
      gate.resolve(); await first;
      const fresh = acquireLease(h.vault, new NoteSource(h.file)); expect(fresh).toBeDefined(); fresh?.release();
    },
  );
  it("different Move instances share their source and target leases", async () => {
    const h = harness(), gate = deferred(); h.manager.renameFile.mockImplementation(async () => { await gate.promise; });
    const first = new NoteMoveService(h.vault, h.manager).move(h.source, ["Dest"], "Dest", h.controller.signal);
    const second = new NoteMoveService(h.vault, h.manager).move(h.source, ["Dest"], "Dest", h.controller.signal);
    expect(await second).toEqual({ status: "failure", reason: "busy" });
    expect(h.manager.renameFile).toHaveBeenCalledOnce(); gate.resolve(); await first;
  });
  it("shared Vault path keys cover source/target, case and Unicode aliases; different Vaults remain independent", () => {
    const h = harness(), held = acquireLease(h.vault, h.source, "Dest/é.md")!;
    for (const path of ["Dest/é.md", "dest/e\u0301.MD", h.source.path.toUpperCase()]) {
      const other = file(path); h.entries.set(path, other);
      expect(acquireLease(h.vault, new NoteSource(other))).toBeUndefined();
    }
    expect(acquireLease(h.vault, new NoteSource(file("Other/X.md")), "Dest/e\u0301.md")).toBeUndefined();
    const separate = acquireLease({ ...h.vault }, h.source, "Dest/é.md"); expect(separate).toBeDefined(); separate?.release();
    held.release(); held.release(); const fresh = acquireLease(h.vault, h.source, "Dest/é.md")!;
    held.release(); expect(acquireLease(h.vault, h.source)).toBeUndefined(); fresh.release();
    expect(mutationKey("É/A.MD")).toBe(mutationKey("E\u0301/a.md"));
  });
  it("exact identity covers a source renamed while its lease is held", () => {
    const h = harness(), held = acquireLease(h.vault, h.source)!;
    h.entries.delete(h.file.path); h.file.path = "Other/A.md"; h.entries.set(h.file.path, h.file);
    expect(acquireLease(h.vault, new NoteSource(h.file))).toBeUndefined(); held.release();
  });
  it("unrelated Notes run concurrently and release independently", async () => {
    const h = harness(), other = file("Other/B.md"), gate = deferred(); h.entries.set(other.path, other);
    const first = underLease(h.vault, h.source, "Dest/A.md", async () => { await gate.promise; return "first"; });
    expect(await underLease(h.vault, new NoteSource(other), "Dest/B.md", async () => "second")).toBe("second");
    expect(acquireLease(h.vault, h.source)).toBeUndefined(); gate.resolve(); expect(await first).toBe("first");
  });
  it.each(["success", "safe-failure", "exception"])("lease finally releases after %s", async kind => {
    const h = harness();
    const pending = underLease(h.vault, h.source, "Dest/A.md", async () => {
      if (kind === "exception") throw new Error("Synthetic failure");
      return kind;
    });
    if (kind === "exception") await expect(pending).rejects.toThrow("Synthetic failure"); else await pending;
    const next = acquireLease(h.vault, h.source, "Dest/A.md"); expect(next).toBeDefined(); next?.release();
  });
  it("bounded release/capture/reacquire accepts an intervening write as its own baseline: counterexample", () => {
    const h = harness(), lock = acquireLease(h.vault, h.source)!;
    h.file.stat.mtime++; lock.release();
    const interloper = acquireLease(h.vault, h.source)!; h.file.stat.mtime++; h.file.stat.size += 10; interloper.release();
    const absorbed = captureBaseline(h.vault, h.source)!;
    const move = acquireLease(h.vault, h.source, "Dest/A.md")!;
    expect(strictSource(h.vault, h.source, absorbed, h.controller.signal)).toBe(h.file); move.release();
  });
  it("capture-before-release/reacquire detects intervening stat write but full Note lease removes capture gap", async () => {
    const h = harness(), held = acquireLease(h.vault, h.source)!;
    h.file.stat.mtime++; const baseline = captureBaseline(h.vault, h.source)!; held.release();
    const other = acquireLease(h.vault, h.source)!; h.file.stat.mtime++; other.release();
    expect(strictSource(h.vault, h.source, baseline, h.controller.signal)).toBeNull();
    const fresh = harness();
    expect((await fresh.run({ afterTag: () => {
      expect(acquireLease(fresh.vault, fresh.source)).toBeUndefined();
      expect(acquireLease(fresh.vault, new NoteSource(file("Other.md")), "Dest/A.md")).toBeUndefined();
    } })).results[0].move).toBe("applied");
  });
});

describe("#103 cancellation, immutable partial/history and privacy evidence 47–63", () => {
  it.each(["before-note", "before-tag", "after-tag", "before-move"])("Stop at %s starts no further API and consumes accepted attempt", async stage => {
    const h = harness(), stop = () => h.controller.abort();
    const hooks = stage === "before-note" ? { beforeNote: stop } : stage === "before-tag" ? { beforeTag: stop }
      : stage === "after-tag" ? { afterTag: stop } : { beforeMove: stop };
    const result = await h.run(hooks);
    expect(result.status).toBe("cancelled"); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect(h.manager.processFrontMatter).toHaveBeenCalledTimes(["after-tag", "before-move"].includes(stage) ? 1 : 0);
    expect(result.results[0].outcome).toBe(["after-tag", "before-move"].includes(stage) ? "cancelled-after-partial" : "cancelled");
  });
  it.each(["tag", "move"])("Stop during in-flight %s awaits actual success and retains truth", async phase => {
    const h = harness(undefined, "Dest", 2), gate = deferred(); let finished = false;
    if (phase === "tag") h.manager.processFrontMatter.mockImplementationOnce(async (f, callback) => {
      callback(h.frontmatter); await gate.promise; f.stat.mtime++; f.stat.size++;
    });
    else h.manager.renameFile.mockImplementationOnce(async () => { await gate.promise; });
    const pending = h.run().then(result => { finished = true; return result; }); await flush(); h.controller.abort(); await flush();
    expect(finished).toBe(false); gate.resolve(); const result = await pending;
    expect(result.status).toBe("cancelled"); expect(result.results).toHaveLength(1); expect(result.results[0].tag).toBe("applied");
    expect(result.results[0].move).toBe(phase === "tag" ? "not-started-cancelled" : "applied");
    expect(h.manager.processFrontMatter).toHaveBeenCalledOnce(); expect(h.manager.renameFile).toHaveBeenCalledTimes(phase === "move" ? 1 : 0);
  });
  it.each(["local-failure", "cancel", "invariant"])("later %s cannot erase first Note success", async later => {
    const h = harness(["#reviewed"], "Dest", 2);
    const result = await h.run({ beforeNote: index => {
      if (index !== 1) return;
      if (later === "cancel") h.controller.abort();
      if (later === "local-failure") h.entries.delete(h.files[1].path);
      if (later === "invariant") throw new Error("Synthetic internal invariant");
    } });
    expect(result.results[0]).toMatchObject({ tag: "applied", move: "applied", outcome: "moved-and-tags" });
    expect(result.status).toBe(later === "cancel" ? "cancelled" : later === "invariant" ? "stopped" : "completed");
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.results)).toBe(true);
    expect(result.results.every(Object.isFrozen)).toBe(true);
    expect(applyProgress(2, result).processed).toBe(2); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("target-local Tag/Move/destination failure continues without retry; coordinator exception stops", async () => {
    const h = harness(["#reviewed"], "Dest", 2); h.manager.processFrontMatter.mockRejectedValueOnce(new Error("private"));
    const result = await h.run(); expect(result.status).toBe("completed"); expect(result.results).toHaveLength(2);
    expect(result.results[0].tag).toBe("failed"); expect(result.results[1].move).toBe("applied");
    expect(applyProgress(2, result)).toEqual({ total: 2, processed: 2, failed: 1, stale: 0 });
    const failure = harness(); failure.vault.getAbstractFileByPath.mockImplementation(() => { throw new Error("private"); });
    expect(await failure.run()).toMatchObject({ status: "stopped", reason: "invariant" });
  });
  it("no-op stale remains stale; partial result cannot be flattened into success", () => {
    expect(noteTruth(0, "not-selected", "keep-current", "stale").outcome).toBe("stale");
    expect(noteTruth(0, "applied", "failed").outcome).toBe("partial");
    expect(noteTruth(0, "applied", "not-started-cancelled").outcome).toBe("cancelled-after-partial");
  });
  it("Move-only busy is a terminal failed Note in progress, separate from stale/cancelled", async () => {
    const h = harness([]), lease = acquireLease(h.vault, h.source)!;
    const result = await h.run(); lease.release();
    expect(result.results[0]).toMatchObject({ tag: "not-selected", outcome: "failed", reason: "busy" });
    expect(applyProgress(1, result)).toEqual({ total: 1, processed: 1, failed: 1, stale: 0 });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("Organizer token cannot authorize Manual Tag Apply", async () => {
    const h = harness();
    expect(await new TagApplyService(h.vault, h.manager).apply({ confirmation: h.confirmation.confirm() as never }, h.controller.signal))
      .toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("production imports no spike; Review and entry contain no mutation/confirmation wiring", () => {
    for (const name of ["main.ts", "organizer/organization-review-modal.ts", "organizer/folder-organizer-entry.ts"]) {
      const source = readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/organizer-apply-safety-spike|OrganizationApplyService|OrganizerConfirmationSession|runConfirmedSpike/);
      if (name !== "main.ts") expect(source).not.toMatch(/processFrontMatter|renameFile|\.apply\(/);
    }
    expect(createMovePlan("Inbox/A.md", "Dest")).toEqual({ sourcePath: "Inbox/A.md", destination: "Dest", targetPath: "Dest/A.md" });
  });
});
