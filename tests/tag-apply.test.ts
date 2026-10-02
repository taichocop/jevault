import { getAllTags, parseFrontMatterTags, type CachedMetadata, type TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { captureEvaluationProvenance, type EvaluationProvenance } from "../src/tags/evaluation-provenance";
import type { VerifiedTagMetadata } from "../src/tags/indexed-tag-metadata";
import { NoteSource } from "../src/note-source";
import { TagApplyAuthorizationService, type TagApplyAuthorization } from "../src/tags/tag-apply-authorization";
import { TagSuggestionGrantIssuer, type TagSuggestionGrant } from "../src/tags/tag-suggestion-grant";
import { TagApplyService } from "../src/tags/tag-apply-service";
import { TagApplyPreparationSession } from "../src/tags/tag-apply-preparation";
import { TFile as FakeFile } from "./helpers/obsidian-move";

vi.mock("obsidian", async () => ({
  TFile: (await import("./helpers/obsidian-move")).TFile,
  getAllTags: vi.fn(), parseFrontMatterTags: vi.fn(),
}));

const names = ["#aws", "#cloud", "#programming/aws", "#AWS", "#日本語", "#é", "#e\u0301"];

function harness(frontmatter: Record<string, unknown> = {}, existingTags: string[] = [], allowedTags: readonly string[] = names) {
  const file = Object.assign(new FakeFile("Synthetic/A.md"), { stat: { ctime: 1, mtime: 2, size: 100 } }) as TFile;
  let currentTags = [...existingTags];
  let frontmatterTags: string[] = [];
  let callbackTags: string[] = [];
  const forbidden = vi.fn(() => { throw new Error("Forbidden boundary"); });
  const vault = {
    getFileByPath: vi.fn((): TFile | null => file),
    read: forbidden, cachedRead: forbidden, modify: forbidden, process: forbidden,
    create: forbidden, createFolder: forbidden, delete: forbidden, rename: forbidden,
  };
  const cache: CachedMetadata = { frontmatter: {} };
  const proof = Object.freeze({});
  const metadata = {
    getFileCache: vi.fn((): CachedMetadata | null => cache),
    snapshot: vi.fn((): VerifiedTagMetadata => {
      if (metadata.getFileCache() === null) return { status: "failure", reason: "metadata-unavailable" };
      return { status: "verified", proof, existingTags: [...currentTags], frontmatterTags: [...frontmatterTags] };
    }),
  };
  vi.mocked(getAllTags).mockReset().mockImplementation(() => [...currentTags]);
  // 公式runtimeはunit testにないため、helper出力を明示する。自作YAML/tag parserで代替しない。
  vi.mocked(parseFrontMatterTags).mockReset().mockImplementation((value: unknown) =>
    value === frontmatter ? [...callbackTags] : [...frontmatterTags]);
  const fileManager = {
    processFrontMatter: vi.fn(async (_file: TFile, callback: (fm: Record<string, unknown>) => void) => {
      callback(frontmatter);
    }),
  };
  const source = new NoteSource(file);
  const capture = new TagApplyAuthorizationService(vault, metadata);
  const service = new TagApplyService(vault, fileManager);
  const outcome = { source, evaluationProvenance: undefined as EvaluationProvenance | undefined, suggestions: allowedTags.map((tagName) => ({ tagName, tagId: "synthetic", choice: "match" as const, matchProbability: 1 })) };
  async function authorize(): Promise<TagApplyAuthorization> {
    outcome.evaluationProvenance = await captureEvaluationProvenance(source, "Synthetic evaluated content");
    const result = capture.capture(outcome);
    expect(result.status).toBe("captured");
    if (result.status !== "captured") throw new Error("Synthetic capture failed");
    return result.authorization;
  }
  const controller = new AbortController();
  const issuer = new TagSuggestionGrantIssuer(vault);
  const sessions = new Map<TagSuggestionGrant, TagApplyPreparationSession>();
  const confirm = (grant: TagSuggestionGrant, selectedTags: readonly string[] = ["#aws"]) =>
    sessions.get(grant)?.confirm(selectedTags);
  const issue = () => {
    const success = { ...outcome, status: "success" as const, noteTitle: "Synthetic" };
    const lifetime = issuer.issue(success)!;
    const session = new TagApplyPreparationSession(vault, { on: vi.fn(), offref: vi.fn() }, file);
    session.prepare(success, lifetime);
    sessions.set(lifetime.grant, session);
    return lifetime;
  };
  const apply = (grant: TagSuggestionGrant, selectedTags: readonly string[] = ["#aws"]) =>
    service.apply({ confirmation: confirm(grant, selectedTags)! }, controller.signal);
  return {
    file, vault, metadata, fileManager, source, capture, service, outcome, authorize, apply, controller,
    frontmatter, forbidden, cache, issue, issuer, confirm, sessions,
    tags: (tags: string[]) => { currentTags = tags; },
    fmTags: (tags: string[]) => { frontmatterTags = tags; callbackTags = tags; },
    callbackTags: (tags: string[]) => { callbackTags = tags; },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("TagApply authorization capture", () => {
  it("rejects updated stat paired with stale inline metadata after evaluation", async () => {
    const h = harness({}, []);
    h.outcome.evaluationProvenance = await captureEvaluationProvenance(h.source, "Synthetic evaluated content");
    // OLDを評価後、本文へinline #awsが追加されたがcacheはOLDのまま。
    h.file.stat.mtime++;
    h.file.stat.size += 5;
    expect(h.capture.capture(h.outcome).status).toBe("failure");
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("captures source, revision, tags and allowed names before later selection, with immutable copies", async () => {
    const h = harness({}, ["#inline", "#AWS", "#aws"]);
    const authorization = await h.authorize();
    expect(authorization.source).toBe(h.source);
    expect(authorization.revision).toEqual({ mtime: 2, size: 100 });
    expect(authorization.existingTags).toEqual(["#inline", "#AWS", "#aws"]);
    expect(authorization.allowedTags).toEqual(names);
    h.outcome.suggestions.length = 0;
    h.file.stat.mtime++;
    h.tags(["#later"]);
    expect(authorization.allowedTags).toEqual(names);
    expect(authorization.revision.mtime).toBe(2);
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.allowedTags)).toBe(true);
    expect(Object.isFrozen(authorization.existingTags)).toBe(true);
    expect(h.forbidden).not.toHaveBeenCalled();
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("fails closed for unavailable metadata", async () => {
    const h = harness();
    h.outcome.evaluationProvenance = await captureEvaluationProvenance(h.source, "Synthetic evaluated content");
    h.metadata.getFileCache.mockReturnValue(null);
    expect(h.capture.capture(h.outcome)).toEqual({ status: "failure", reason: "metadata-unavailable" });
    expect(getAllTags).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(["source", "revision"])("rejects %s changing during capture", async (change) => {
    const h = harness();
    h.outcome.evaluationProvenance = await captureEvaluationProvenance(h.source, "Synthetic evaluated content");
    h.metadata.getFileCache.mockImplementation(() => {
      if (change === "source") h.file.path = "Renamed.md";
      else h.file.stat.size++;
      return h.cache;
    });
    expect(h.capture.capture(h.outcome)).toEqual({ status: "failure", reason: `${change}-changed` });
  });
  it("sanitizes capture exceptions", async () => {
    const h = harness();
    h.outcome.evaluationProvenance = await captureEvaluationProvenance(h.source, "Synthetic evaluated content");
    h.metadata.getFileCache.mockImplementation(() => { throw new Error("Private synthetic detail"); });
    expect(h.capture.capture(h.outcome)).toEqual({ status: "failure", reason: "unexpected" });
  });
});

describe("TagApplyService confirmed-intent frontmatter safety", () => {
  it("consumes each accepted confirmation once across service instances", async () => {
    const h = harness(), confirmation = h.confirm(h.issue().grant)!;
    expect(await h.service.apply({ confirmation }, h.controller.signal)).toEqual({ status: "applied", addedTags: ["#aws"] });
    h.fileManager.processFrontMatter.mockClear();
    const other = new TagApplyService(h.vault, h.fileManager);
    expect(await other.apply({ confirmation }, h.controller.signal)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("leaves an initially aborted confirmation unused for the later explicit attempt", async () => {
    const h = harness(), confirmation = h.confirm(h.issue().grant)!;
    h.controller.abort();
    expect(await h.service.apply({ confirmation }, h.controller.signal)).toEqual({ status: "cancelled" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(await h.service.apply({ confirmation }, new AbortController().signal)).toEqual({ status: "applied", addedTags: ["#aws"] });
  });
  it("consumes an accepted attempt even when it is cancelled during source resolution", async () => {
    const h = harness(), confirmation = h.confirm(h.issue().grant)!;
    h.vault.getFileByPath.mockImplementationOnce(() => { h.controller.abort(); return h.file; });
    expect(await h.service.apply({ confirmation }, h.controller.signal)).toEqual({ status: "cancelled" });
    expect(await h.service.apply({ confirmation }, new AbortController().signal)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("adds only absent tags and preserves unrelated fields and existing values/order", async () => {
    const h = harness({ tags: ["AWS", "rails", "Rails", "#rails"], title: "Synthetic", aliases: ["keep"], custom: { keep: true } });
    const existing = h.frontmatter.tags;
    expect(await h.apply(h.issue().grant, ["#aws", "#cloud", "#programming/aws"]))
      .toEqual({ status: "applied", addedTags: ["#cloud", "#programming/aws"] });
    expect(existing).toEqual(["AWS", "rails", "Rails", "#rails"]);
    expect(h.frontmatter).toEqual({ tags: ["AWS", "rails", "Rails", "#rails", "cloud", "programming/aws"],
      title: "Synthetic", aliases: ["keep"], custom: { keep: true } });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledExactlyOnceWith(h.file, expect.any(Function));
    expect(h.metadata.snapshot).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(["aws", "AWS", "#aws", "#AWS"])("does not assign when current frontmatter %s already covers selection", async existing => {
    const h = harness({ tags: [existing], custom: { keep: true } });
    const tags = h.frontmatter.tags;
    const setter = vi.fn();
    Object.defineProperty(h.frontmatter, "tags", { get: () => tags, set: setter });
    expect(await h.apply(h.issue().grant)).toEqual({ status: "no-change" });
    expect(setter).not.toHaveBeenCalled(); expect(h.frontmatter.tags).toBe(tags);
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
  });
  it.each([undefined, []].map(tags => ({ tags })))("initializes supported empty frontmatter additively: $tags", ({ tags }) => {
    const h = harness({ tags, title: "Synthetic" });
    return h.apply(h.issue().grant).then(result => {
      expect(result).toEqual({ status: "applied", addedTags: ["#aws"] });
      expect(h.frontmatter).toEqual({ tags: ["aws"], title: "Synthetic" });
    });
  });
  it.each([
    { selected: ["#aws", "#AWS", "#cloud", "#aws"], expected: ["#aws", "#cloud"] },
    { selected: ["#AWS", "#aws"], expected: ["#AWS"] },
    { selected: ["#Programming/AWS", "#programming/aws"], expected: ["#Programming/AWS"] },
    { selected: ["#programming/aws", "#Programming/AWS"], expected: ["#programming/aws"] },
  ])("retains first exact-authorized semantic representation and order: $selected", async ({ selected, expected }) => {
    const h = harness({}, [], [...names, "#Programming/AWS"]);
    expect(await h.apply(h.issue().grant, selected)).toEqual({ status: "applied", addedTags: expected });
    expect(h.frontmatter.tags).toEqual(expected.map(name => name.slice(1)));
  });
  it("keeps hierarchy, Japanese and Unicode forms distinct without normalization", async () => {
    const selected = ["#aws", "#aws2", "#programming", "#programming/aws", "#日本語", "#é", "#e\u0301"];
    const h = harness({}, [], selected);
    expect(await h.apply(h.issue().grant, selected)).toEqual({ status: "applied", addedTags: selected });
    expect(h.frontmatter.tags).toEqual(selected.map(name => name.slice(1)));
  });
  it.each([["#aws", "#AWS"], ["#AWS", "#aws"], ["#AWS"], ["#new"], ["aws"]])(
    "rejects all unauthorized exact selections before semantic dedupe: %s", async (...selected) => {
      const h = harness({}, [], ["#aws"]);
      expect(await h.apply(h.issue().grant, selected)).toEqual({ status: "failure", reason: "invalid-confirmation" });
      expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, null, "#aws", {}, [null], [3], ["#aws", undefined]].map(selected => ({ selected })))("rejects malformed selection %#", async ({ selected }) => {
    const h = harness();
    const grant = h.issue().grant;
    const confirmation = h.sessions.get(grant)!.confirm(selected as unknown as string[]);
    expect(await h.service.apply({ confirmation: confirmation! }, h.controller.signal)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("rejects copied, forged, revoked, cross-Vault and legacy authority with zero mutation", async () => {
    const h = harness(), lifetime = h.issue(), other = harness();
    const legacy = await h.authorize();
    for (const grant of [{ ...lifetime.grant }, { ...lifetime.grant, allowedTags: ["#forged"] }, legacy]) {
      expect(await h.apply(grant as TagSuggestionGrant)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    }
    expect(await other.apply(lifetime.grant)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    lifetime.dispose();
    expect(await h.apply(lifetime.grant)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled(); expect(other.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it.each(["pre-start", "callback"])("rejects a grant revoked at %s before assignment", async stage => {
    const h = harness(), lifetime = h.issue();
    const confirmation = h.confirm(lifetime.grant)!;
    if (stage === "pre-start") h.vault.getFileByPath.mockImplementation(() => { lifetime.dispose(); return h.file; });
    else h.fileManager.processFrontMatter.mockImplementationOnce(async (_file, callback) => { lifetime.dispose(); callback(h.frontmatter); });
    expect(await h.service.apply({ confirmation }, h.controller.signal)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.frontmatter).toEqual({});
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledTimes(stage === "pre-start" ? 0 : 1);
  });
  it("empty selection cannot issue confirmation or start the mutation API", async () => {
    const h = harness();
    expect(await h.apply(h.issue().grant, [])).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.metadata.snapshot).not.toHaveBeenCalled();
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it.each(["#aws", "#AWS"])("inline observation %s does not block an absent frontmatter tag", async inline => {
    const h = harness({}, [inline]);
    const grant = h.issue().grant;
    h.metadata.getFileCache.mockReturnValue(null);
    expect(await h.apply(grant)).toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.frontmatter.tags).toEqual(["aws"]);
    expect(h.metadata.snapshot).not.toHaveBeenCalled(); expect(h.metadata.getFileCache).not.toHaveBeenCalled();
  });
  it.each(["mtime", "size"] as const)("same-source %s change since evaluation is non-blocking", async key => {
    const h = harness();
    h.outcome.evaluationProvenance = await captureEvaluationProvenance(h.source, "Synthetic evaluated content");
    const grant = h.issue().grant;
    h.file.stat[key]++;
    expect(await h.apply(grant)).toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.metadata.snapshot).not.toHaveBeenCalled();
  });
  it.each(["replacement", "rename", "move", "missing", "wrong-file", "non-md", "filename", "basename"])(
    "rejects exact source %s with zero mutation", async change => {
      const h = harness(), grant = h.issue().grant;
      const confirmation = h.confirm(grant)!;
      if (change === "replacement") h.vault.getFileByPath.mockReturnValue(Object.assign(new FakeFile(h.file.path), { stat: h.file.stat }) as TFile);
      if (change === "wrong-file") h.vault.getFileByPath.mockReturnValue(new FakeFile("Synthetic/B.md") as TFile);
      if (change === "rename") h.file.path = "Synthetic/Renamed.md";
      if (change === "move") h.file.path = "Elsewhere/A.md";
      if (change === "missing") h.vault.getFileByPath.mockReturnValue(null);
      if (change === "non-md") h.file.extension = "txt";
      if (change === "filename") h.file.name = "Other.md";
      if (change === "basename") h.file.basename = "Other";
      expect(await h.service.apply({ confirmation }, h.controller.signal)).toEqual({ status: "failure", reason: "source-changed" });
      expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    },
  );
  it.each(["source", "replacement", "frontmatter", "revision"])("uses current callback state during API read: %s", async change => {
    const h = harness(), grant = h.issue().grant;
    h.fileManager.processFrontMatter.mockImplementationOnce(async (_file, callback) => {
      if (change === "source") h.file.path = "Renamed.md";
      if (change === "replacement") h.vault.getFileByPath.mockReturnValue(new FakeFile(h.file.path) as TFile);
      if (change === "frontmatter") h.frontmatter.tags = ["AWS", "manual"];
      if (change === "revision") h.file.stat.mtime++;
      callback(h.frontmatter);
    });
    expect(await h.apply(grant)).toEqual(change === "source" || change === "replacement"
      ? { status: "failure", reason: "source-changed" }
      : change === "frontmatter" ? { status: "no-change" } : { status: "applied", addedTags: ["#aws"] });
    expect(h.frontmatter.tags).toEqual(change === "frontmatter" ? ["AWS", "manual"] : change === "revision" ? ["aws"] : undefined);
  });
  it("delegates supported scalar conversion to the official helper preserving semantic values", async () => {
    const h = harness({ tags: "Rails cloud", aliases: ["keep"] });
    h.callbackTags(["#Rails", "#cloud"]);
    expect(await h.apply(h.issue().grant, ["#cloud", "#aws"])).toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.frontmatter).toEqual({ tags: ["Rails", "cloud", "aws"], aliases: ["keep"] });
    expect(parseFrontMatterTags).toHaveBeenCalledExactlyOnceWith(h.frontmatter);
  });
  it("does not convert an already-covered scalar", async () => {
    const h = harness({ tags: "AWS" }); h.callbackTags(["#AWS"]);
    const setter = vi.fn(); Object.defineProperty(h.frontmatter, "tags", { get: () => "AWS", set: setter });
    expect(await h.apply(h.issue().grant)).toEqual({ status: "no-change" });
    expect(setter).not.toHaveBeenCalled();
  });
  it.each([null, 3, { unknown: true }, "", [null], [3], [{}], [""], ["two tags"], ["##aws"]].map(tags => ({ tags })))(
    "fails closed for unsupported tags %# without assignment or raw error", async ({ tags }) => {
      const h = harness({ tags, custom: "keep" });
      const setter = vi.fn(); Object.defineProperty(h.frontmatter, "tags", { get: () => tags, set: setter });
      expect(await h.apply(h.issue().grant)).toEqual({ status: "failure", reason: "unexpected" });
      expect(setter).not.toHaveBeenCalled(); expect(h.frontmatter.tags).toBe(tags);
      expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
    },
  );
  it.each([[], ["aws"], ["#two tags"]].map(parsed => ({ parsed })))("rejects unsupported scalar helper output %#", async ({ parsed }) => {
    const h = harness({ tags: "ambiguous" }); h.callbackTags(parsed);
    expect(await h.apply(h.issue().grant)).toEqual({ status: "failure", reason: "unexpected" });
    expect(h.frontmatter.tags).toBe("ambiguous");
  });
  it.each(["entry", "selection", "source", "final"])("pre-start abort at %s causes zero mutation API calls", async stage => {
    const h = harness(), grant = h.issue().grant, selected = ["#aws"];
    if (stage === "selection") Object.defineProperty(selected, 0, { get: () => { h.controller.abort(); return "#aws"; } });
    const confirmation = h.confirm(grant, selected)!;
    h.vault.getFileByPath.mockClear();
    if (stage === "entry") h.controller.abort();
    if (stage === "source") h.vault.getFileByPath.mockImplementation(() => { h.controller.abort(); return h.file; });
    if (stage === "final") h.vault.getFileByPath.mockReturnValueOnce(h.file).mockImplementationOnce(() => { h.controller.abort(); return h.file; });
    expect(await h.service.apply({ confirmation }, h.controller.signal)).toEqual({ status: "cancelled" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });
  it.each(["success", "failure"])("returns actual post-start %s after cancellation and releases lock", async outcome => {
    const h = harness(), grant = h.issue().grant;
    h.fileManager.processFrontMatter.mockImplementationOnce(async (_file, callback) => {
      h.controller.abort();
      if (outcome === "failure") throw new Error("PRIVATE_SYNTHETIC_EXCEPTION /absolute/path");
      callback(h.frontmatter);
    });
    expect(await h.apply(grant)).toEqual(outcome === "success"
      ? { status: "applied", addedTags: ["#aws"] } : { status: "failure", reason: "unexpected" });
    expect(await h.service.apply({ confirmation: h.confirm(grant, ["#cloud"])! }, new AbortController().signal))
      .toEqual({ status: "applied", addedTags: ["#cloud"] });
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("holds a shared path lock across instances and releases it on completion", async () => {
    const h = harness(), grant = h.issue().grant;
    let complete!: () => void;
    h.fileManager.processFrontMatter.mockImplementationOnce((_file, callback) => new Promise<void>(resolve => {
      complete = () => { callback(h.frontmatter); resolve(); };
    }));
    const firstConfirmation = h.confirm(grant)!;
    const secondConfirmation = h.confirm(grant)!;
    const first = h.service.apply({ confirmation: firstConfirmation }, h.controller.signal), second = new TagApplyService(h.vault, h.fileManager);
    expect(await second.apply({ confirmation: secondConfirmation }, h.controller.signal)).toEqual({ status: "failure", reason: "busy" });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
    complete(); expect(await first).toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(await second.apply({ confirmation: secondConfirmation }, h.controller.signal)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(await h.apply(grant, ["#cloud"])).toEqual({ status: "applied", addedTags: ["#cloud"] });
  });
  it("holds the same TFile lock after a rename with a newly issued grant", async () => {
    const h = harness(), grant = h.issue().grant;
    let complete!: () => void;
    h.fileManager.processFrontMatter.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    const first = h.apply(grant);
    h.file.path = "Synthetic/Renamed.md"; h.file.name = "Renamed.md"; h.file.basename = "Renamed";
    const lifetime = h.issuer.issue({ ...h.outcome, status: "success", noteTitle: "Renamed", source: new NoteSource(h.file) })!;
    const session = new TagApplyPreparationSession(h.vault, { on: vi.fn(), offref: vi.fn() }, h.file);
    session.prepare({ ...h.outcome, status: "success", noteTitle: "Renamed", source: lifetime.grant.source }, lifetime);
    const second = new TagApplyService(h.vault, h.fileManager);
    expect(await second.apply({ confirmation: session.confirm(["#cloud"])! }, h.controller.signal)).toEqual({ status: "failure", reason: "busy" });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce(); complete(); await first;
  });
  it.each(["API", "helper", "assignment"])("sanitizes %s exception with no retry", async boundary => {
    const h = harness({ tags: "rails" });
    const fail = () => { throw new Error("PRIVATE_SYNTHETIC_YAML /absolute/path"); };
    if (boundary === "API") h.fileManager.processFrontMatter.mockImplementationOnce(fail);
    if (boundary === "helper") vi.mocked(parseFrontMatterTags).mockImplementationOnce(fail);
    if (boundary === "assignment") {
      h.callbackTags(["#rails"]); Object.defineProperty(h.frontmatter, "tags", { get: () => "rails", set: fail });
    }
    const grant = h.issue().grant;
    expect(await h.apply(grant)).toEqual({ status: "failure", reason: "unexpected" });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
    h.fileManager.processFrontMatter.mockClear();
    h.fileManager.processFrontMatter.mockImplementationOnce(async (_file, callback) => callback({}));
    expect(await h.apply(grant)).toEqual({ status: "applied", addedTags: ["#aws"] });
  });
  it("keeps original target and body; never calls provider, Secret, network, storage or logs", async () => {
    const h = harness(); const grant = h.issue().grant;
    const body = "Synthetic unrelated Markdown #aws\r\n日本語\n";
    const state = { body, frontmatter: h.frontmatter };
    h.fileManager.processFrontMatter.mockImplementationOnce(async (_file, callback) => callback(state.frontmatter));
    const workspace = { getActiveFile: h.forbidden }, provider = { evaluate: h.forbidden }, secret = { getSecret: h.forbidden };
    vi.stubGlobal("fetch", h.forbidden); vi.stubGlobal("localStorage", { setItem: h.forbidden });
    const logs = ["log", "info", "warn", "error", "debug"] as const;
    const spies = logs.map(level => vi.spyOn(console, level));
    try {
      expect(await h.apply(grant)).toEqual({ status: "applied", addedTags: ["#aws"] });
      expect(state.body).toBe(body); expect(h.fileManager.processFrontMatter.mock.calls[0][0]).toBe(h.file);
      expect(h.forbidden).not.toHaveBeenCalled(); expect(workspace.getActiveFile).not.toHaveBeenCalled();
      expect(provider.evaluate).not.toHaveBeenCalled(); expect(secret.getSecret).not.toHaveBeenCalled();
      expect(h.metadata.snapshot).not.toHaveBeenCalled(); spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    } finally { spies.forEach(spy => spy.mockRestore()); }
  });
});
