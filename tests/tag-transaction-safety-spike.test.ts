import { getAllTags, parseFrontMatterTags, type CachedMetadata, type EventRef, type FrontMatterInfo, type MetadataCache, type TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteSource } from "../src/note-source";
import { captureEvaluationProvenance } from "../src/tags/evaluation-provenance";
import { IndexedTagMetadataTracker } from "../src/tags/indexed-tag-metadata";
import { TagApplyAuthorizationService } from "../src/tags/tag-apply-authorization";
import { TagSuggestionGrantIssuer } from "../src/tags/tag-suggestion-grant";
import { TagApplyService } from "../src/tags/tag-apply-service";
import { classifyTagSuggestionFreshness } from "../src/tags/tag-suggestion-freshness";
import { isSameTagIdentity } from "../src/tags/tag-identity";
import { TFile as FakeFile } from "./helpers/obsidian-move";
import { probeRestrictedTransaction, restrictedTagAbsence } from "./helpers/tag-transaction-safety-spike";

vi.mock("obsidian", async () => ({
  TFile: (await import("./helpers/obsidian-move")).TFile,
  getAllTags: vi.fn(), parseFrontMatterTags: vi.fn(),
}));

function file() {
  return Object.assign(new FakeFile("Synthetic/Transaction.md"), { stat: { ctime: 1, mtime: 2, size: 100 } }) as TFile;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

/** #77のraceモデルを保持する。#79ではinline重複は許容し、frontmatterだけをstrictにする。 */
async function observationHarness(existing: string[] = [], frontmatterTags: string[] = []) {
  const original = file(), source = new NoteSource(original);
  const files = new Map([[original.path, original]]);
  const frontmatter: Record<string, unknown> = frontmatterTags.length ? { tags: frontmatterTags.map(tag => tag.slice(1)) } : {};
  let body = "Synthetic initially untagged text";
  let listener!: (file: TFile, data: string, cache: CachedMetadata) => void;
  const forbidden = vi.fn(() => { throw new Error("Forbidden research boundary"); });
  const vault = { getFileByPath: (path: string) => files.get(path) ?? null, read: forbidden, process: forbidden };
  const metadata = {
    on: (_name: string, callback: typeof listener) => { listener = callback; return {} as EventRef; }, offref: vi.fn(),
    getFileCache: forbidden, getCache: forbidden,
  };
  vi.mocked(getAllTags).mockReturnValue([...existing]);
  vi.mocked(parseFrontMatterTags).mockReturnValue([...frontmatterTags]);
  const tracker = new IndexedTagMetadataTracker(vault, metadata as Pick<MetadataCache, "on" | "offref">, source);
  const selected = ["#aws", "#cloud", "#programming", "#programming/aws", "#日本語"];
  const outcome = { source, evaluationProvenance: await captureEvaluationProvenance(source, body),
    suggestions: selected.map(tagName => ({ tagName, tagId: "synthetic", choice: "match" as const, matchProbability: 1 })) };
  // digest完了はPromiseで同期し、metadata catch-upのsleep/pollingをしない。
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  const started = deferred<Promise<ArrayBuffer>>();
  const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, bytes) => {
    const work = digest(algorithm, bytes); started.resolve(work); return work;
  });
  try {
    listener(original, body, {});
    await started.promise;
    await Promise.resolve();
  } finally { spy.mockRestore(); }
  const capture = new TagApplyAuthorizationService(vault, tracker).capture(outcome);
  if (capture.status !== "captured") throw new Error("Synthetic setup failed");
  const fileManager = { processFrontMatter: vi.fn(async (target: TFile, fn: (fm: Record<string, unknown>) => void) => {
    if (target !== original) throw new Error("Wrong synthetic target");
    fn(frontmatter);
  }) };
  const service = new TagApplyService(vault, fileManager);
  const grant = new TagSuggestionGrantIssuer(vault).issue({ ...outcome, status: "success", noteTitle: "Synthetic" })!.grant;
  return { grant, original, source, files, vault, metadata, tracker, outcome, authorization: capture.authorization, service, fileManager,
    frontmatter, forbidden, body: () => body, edit: (next: string) => { body = next; },
    apply: (tags = ["#aws"], signal = new AbortController().signal) => service.apply({ grant, selectedTags: tags }, signal) };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Issue #77: observation correctness is not currency or transaction binding", () => {
  it.each(["before-start", "during-api-read"])("reproduces delayed-notification duplicate with edit %s", async timing => {
    const h = await observationHarness();
    try {
      const old = h.tracker.observation(h.source)!;
      const revision = { ...h.original.stat };
      const edit = () => h.edit("Synthetic current text #aws");
      if (timing === "before-start") edit();
      else h.fileManager.processFrontMatter.mockImplementationOnce(async (_target, fn) => { edit(); fn(h.frontmatter); });
      expect(await h.apply()).toEqual({ status: "applied", addedTags: ["#aws"] });
      expect(h.body().endsWith("#aws")).toBe(true);
      expect(h.frontmatter.tags).toEqual(["aws"]);
      expect(h.original.stat).toEqual(revision);
      expect(h.tracker.observation(h.source)?.existingTags).toEqual([]);
      expect(classifyTagSuggestionFreshness(h.source, h.outcome.evaluationProvenance, old)).toBe("matching");
      expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
      expect(h.forbidden).not.toHaveBeenCalled();
    } finally { h.tracker.dispose(); }
  });

  it.each([
    { existing: ["#aws"], fm: [], selected: "#aws" },
    { existing: ["#aws"], fm: ["#aws"], selected: "#aws" },
    { existing: ["#AWS"], fm: [], selected: "#aws" },
    { existing: ["#日本語"], fm: ["#日本語"], selected: "#日本語" },
    { existing: ["#programming/aws"], fm: [], selected: "#programming/aws" },
  ])("strictly filters frontmatter while inline observation stays advisory: $selected / $fm", async ({ existing, fm, selected }) => {
    const h = await observationHarness(existing, fm);
    try {
      const before = structuredClone(h.frontmatter);
      expect(await h.apply([selected])).toEqual(fm.length ? { status: "no-change" } : { status: "applied", addedTags: [selected] });
      expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
      expect(h.frontmatter).toEqual(fm.length ? before : { tags: [selected.slice(1)] });
    } finally { h.tracker.dispose(); }
  });

  it("does not equate hierarchical parent/child or invent Unicode normalization", async () => {
    const h = await observationHarness(["#programming/aws"]);
    try {
      expect(isSameTagIdentity("#programming", "#programming/aws")).toBe(false);
      expect(isSameTagIdentity("#é", "#e\u0301")).toBe(false);
      expect(await h.apply(["#programming"])).toEqual({ status: "applied", addedTags: ["#programming"] });
      expect(h.frontmatter.tags).toEqual(["programming"]);
    } finally { h.tracker.dispose(); }
  });

  it("shares the existing lock across instances but cannot lock an external edit", async () => {
    const h = await observationHarness(), pending = deferred<void>(), entered = deferred<void>();
    try {
      h.fileManager.processFrontMatter.mockImplementationOnce(async (_target, fn) => {
        entered.resolve(); await pending.promise; fn(h.frontmatter);
      });
      const first = h.apply(); await entered.promise;
      const other = new TagApplyService(h.vault, h.fileManager);
      expect(await other.apply({ grant: h.grant, selectedTags: ["#cloud"] }, new AbortController().signal))
        .toEqual({ status: "failure", reason: "busy" });
      h.edit("Synthetic external write #aws");
      pending.resolve();
      expect(await first).toEqual({ status: "applied", addedTags: ["#aws"] });
      expect(h.body().endsWith("#aws")).toBe(true);
      expect(h.frontmatter.tags).toEqual(["aws"]);
      expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
    } finally { pending.resolve(); h.tracker.dispose(); }
  });

  it("a separate read cannot lock a later processFrontMatter transaction", async () => {
    const h = await observationHarness();
    try {
      const read = vi.fn(async () => h.body());
      const sampled = await read();
      expect(sampled.includes("#")).toBe(false);
      h.edit("Synthetic edit between read and write #aws");
      expect(await h.apply()).toEqual({ status: "applied", addedTags: ["#aws"] });
      expect(h.body().endsWith("#aws")).toBe(true);
      expect(h.frontmatter.tags).toEqual(["aws"]);
      expect(read).toHaveBeenCalledOnce(); expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
    } finally { h.tracker.dispose(); }
  });

  it("cancels before API start with zero mutation calls and rejects same-path replacement", async () => {
    const h = await observationHarness();
    try {
      const signal = new AbortController(); signal.abort();
      expect(await h.apply(["#aws"], signal.signal)).toEqual({ status: "cancelled" });
      h.files.set(h.source.path, file());
      expect(await h.apply()).toEqual({ status: "failure", reason: "source-changed" });
      expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    } finally { h.tracker.dispose(); }
  });
});

const noFrontmatter = { getFrontMatterInfo: vi.fn(() => ({ exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 }) as FrontMatterInfo) };

function transactionHarness(initial = "Synthetic plain text") {
  const original = file(), source = new NoteSource(original), files = new Map([[original.path, original]]);
  let content = initial;
  const committed: string[] = [];
  const vault = {
    getFileByPath: (path: string) => files.get(path) ?? null,
    process: vi.fn(async (target: TFile, fn: (current: string) => string) => {
      if (target !== original) throw new Error("Wrong synthetic target");
      const next = fn(content);
      committed.push(next); content = next; return next;
    }),
  };
  // 固定fixtureのheader追加だけ。production serializer/selected intentは実装しない。
  const transform = vi.fn((current: string) => "---\ntags:\n  - aws\n---\n" + current);
  const controller = new AbortController();
  return { original, source, files, vault, transform, controller, committed, edit: (next: string) => { content = next; },
    run: () => probeRestrictedTransaction(vault, source, noFrontmatter, controller.signal, transform) };
}

describe("Issue #77: conditional no-frontmatter/no-hash subset at a modeled process callback", () => {
  it.each([
    ["Text #aws", false], ["Text #AWS", false], ["#programming/aws", false], ["#日本語", false],
    ["# Heading", false], ["https://example.invalid/#fragment", false], ["`#code`", false],
    ["```\n#not-a-tag\n```", false], ["\\#aws", false],
    ["---\ntags:\n  - aws\n---\nText", false], ["---\ntags: aws\n---\nText", false],
    ["---\naliases: [keep]\n---\nText", false], ["--- malformed delimiter", false],
    ["\uFEFFSynthetic plain text", false], ["Synthetic 日本語 e\u0301", true], ["", true],
  ] as const)("uses a conservative fixed expectation for fixture %#: %s", (content, expected) => {
    expect(restrictedTagAbsence(content, noFrontmatter)).toBe(expected);
  });

  it("rejects unexpected/helper failures instead of asserting absence", () => {
    for (const result of [undefined, {}, { exists: true }]) {
      expect(restrictedTagAbsence("Synthetic", { getFrontMatterInfo: () => result as FrontMatterInfo })).toBe(false);
    }
    expect(restrictedTagAbsence("Synthetic", { getFrontMatterInfo: () => { throw new Error("Synthetic helper error"); } })).toBe(false);
  });

  it("checks later callback content instead of a separate read or evaluation snapshot", async () => {
    const h = transactionHarness();
    const earlierRead = "Synthetic plain text";
    expect(restrictedTagAbsence(earlierRead, noFrontmatter)).toBe(true);
    h.edit("Synthetic later text #aws");
    expect(await h.run()).toBe("failure");
    expect(h.transform).not.toHaveBeenCalled(); expect(h.committed).toHaveLength(0);
  });

  it.each(["before", "callback"])("rejects same-path replacement %s without retargeting", async timing => {
    const h = transactionHarness(), replacement = file();
    if (timing === "before") h.files.set(h.source.path, replacement);
    else h.vault.process.mockImplementationOnce(async (_target, fn) => {
      h.files.set(h.source.path, replacement); return fn("Synthetic");
    });
    expect(await h.run()).toBe(timing === "before" ? "rejected" : "failure");
    expect(h.transform).not.toHaveBeenCalled(); expect(h.committed).toHaveLength(0);
    expect(h.vault.process).toHaveBeenCalledTimes(timing === "before" ? 0 : 1);
    if (timing === "callback") expect(h.vault.process.mock.calls[0][0]).toBe(h.original);
  });

  it("does not start process after pre-start cancellation", async () => {
    const h = transactionHarness(); h.controller.abort();
    expect(await h.run()).toBe("cancelled"); expect(h.vault.process).not.toHaveBeenCalled();
  });

  it("returns the modeled post-start outcome after Close/unload abort without rollback", async () => {
    const h = transactionHarness();
    h.transform.mockImplementationOnce(current => {
      h.controller.abort(); return "---\ntags:\n  - aws\n---\n" + current;
    });
    expect(await h.run()).toBe("accepted-subset");
    expect(h.committed).toHaveLength(1); expect(h.vault.process).toHaveBeenCalledOnce();
  });

  it.each(["transform", "process"])("sanitizes %s failure with no retry, fallback, logs or network", async boundary => {
    const h = transactionHarness();
    const fail = () => { throw new Error("PRIVATE_SYNTHETIC_BODY /private/synthetic/path"); };
    if (boundary === "transform") h.transform.mockImplementationOnce(fail);
    else h.vault.process.mockImplementationOnce(fail);
    const log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error"), info = vi.spyOn(console, "info");
    const network = vi.fn(fail); vi.stubGlobal("fetch", network);
    expect(await h.run()).toBe("failure"); expect(h.vault.process).toHaveBeenCalledOnce();
    expect(h.committed).toHaveLength(0); expect(network).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(info).not.toHaveBeenCalled();
  });

  it.each(["Synthetic 日本語", "Synthetic 日本語\n", "Synthetic 日本語\r\n", "Synthetic e\u0301\n"])(
    "preserves the supplied body suffix exactly for fixture %#", async body => {
      const h = transactionHarness(body);
      expect(await h.run()).toBe("accepted-subset");
      expect(h.committed).toEqual(["---\ntags:\n  - aws\n---\n" + body]);
    },
  );
});
