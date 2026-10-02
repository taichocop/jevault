import type { CachedMetadata, EventRef, MetadataCache, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoteSource } from "../src/note-source";
import { captureEvaluationProvenance, type EvaluationProvenance } from "../src/tags/evaluation-provenance";
import {
  TagApplyPreparationSession, type ConfirmedTagApplyIntent,
} from "../src/tags/tag-apply-preparation";
import { TagApplyService, type TagApplyRequest } from "../src/tags/tag-apply-service";
import {
  isIssuedSuggestionGrant, TagSuggestionGrantIssuer, type TagSuggestionGrantLifetime,
} from "../src/tags/tag-suggestion-grant";
import type { TagSuggestionServiceResult } from "../src/tags/tag-suggestion-service";
import { TFile as FakeFile } from "./helpers/obsidian-move";

vi.mock("obsidian", async () => ({
  TFile: (await import("./helpers/obsidian-move")).TFile,
  getAllTags: (cache: { names?: string[] }) => cache.names ?? [],
  parseFrontMatterTags: () => [],
}));

function syntheticFile(path = "Synthetic/A.md"): TFile {
  return Object.assign(new FakeFile(path), { stat: { ctime: 1, mtime: 2, size: 100 } }) as TFile;
}

function harness(allowedTags: readonly string[] = ["#aws", "#AWS", "#cloud"]) {
  const file = syntheticFile();
  const source = new NoteSource(file);
  const forbidden = vi.fn(() => { throw new Error("Forbidden synthetic boundary"); });
  const vault = {
    getFileByPath: vi.fn((path: string): TFile | null => path === file.path ? file : null),
    read: forbidden, cachedRead: forbidden, modify: forbidden, process: forbidden,
    create: forbidden, createFolder: forbidden, delete: forbidden, rename: forbidden,
  };
  const listeners = new Map<EventRef, (file: TFile, body: string, cache: CachedMetadata) => void>();
  const callbacks: Array<(file: TFile, body: string, cache: CachedMetadata) => void> = [];
  const metadata = {
    on: vi.fn((_name: string, callback: (file: TFile, body: string, cache: CachedMetadata) => void) => {
      callbacks.push(callback);
      const ref = {} as EventRef;
      listeners.set(ref, callback);
      return ref;
    }),
    offref: vi.fn((ref: EventRef) => { listeners.delete(ref); }),
    getFileCache: forbidden,
  };
  const frontmatter: Record<string, unknown> = {};
  const fileManager = {
    processFrontMatter: vi.fn(async (_file: TFile, callback: (value: Record<string, unknown>) => void) => {
      callback(frontmatter);
    }),
  };
  const session = new TagApplyPreparationSession(vault, metadata as Pick<MetadataCache, "on" | "offref">, file);
  const issuer = new TagSuggestionGrantIssuer(vault);
  const service = new TagApplyService(vault, fileManager);
  const outcome = (evaluationProvenance?: EvaluationProvenance): TagSuggestionServiceResult => ({
    status: "success", source, noteTitle: "Synthetic", evaluationProvenance,
    suggestions: allowedTags.map(tagName => ({ tagId: "synthetic", tagName, choice: "match", matchProbability: 1 })),
  });
  const prepare = (provenance?: EvaluationProvenance) => {
    const success = outcome(provenance);
    const lifetime = issuer.issue(success)!;
    session.prepare(success, lifetime);
    return lifetime;
  };
  const emit = (body = "Synthetic evaluated body", names: string[] = []) => {
    for (const callback of listeners.values()) callback(file, body, { names } as CachedMetadata);
  };
  const confirm = (selected: readonly string[] = ["#aws"]): ConfirmedTagApplyIntent => {
    const confirmation = session.confirm(selected);
    expect(confirmation).toBeDefined();
    if (!confirmation) throw new Error("Synthetic confirmation unavailable");
    return confirmation;
  };
  const apply = (confirmation: unknown) =>
    service.apply({ confirmation } as TagApplyRequest, new AbortController().signal);
  return { file, source, vault, forbidden, metadata, listeners, callbacks, fileManager, frontmatter,
    session, issuer, service, outcome, prepare, emit, confirm, apply };
}

afterEach(() => vi.restoreAllMocks());

describe("selection-dependent Tag Apply readiness", () => {
  it("permits an exact nonempty selection with no observation and performs no mutation", () => {
    const h = harness(); const lifetime = h.prepare();
    expect(h.session.suggestionGrant).toBe(lifetime.grant);
    expect(h.session.getReadiness(["#aws"])).toEqual({ status: "confirmable", freshness: "unknown" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
    h.session.dispose();
  });

  it.each([
    { selection: [], reason: "empty-selection" },
    { selection: ["#AWS"], reason: "invalid-selection" },
    { selection: ["#aws", "#AWS"], reason: "invalid-selection" },
    { selection: ["aws"], reason: "invalid-selection" },
    { selection: ["#free-form"], reason: "invalid-selection" },
    { selection: undefined, reason: "invalid-selection" },
    { selection: null, reason: "invalid-selection" },
    { selection: "#aws", reason: "invalid-selection" },
    { selection: {}, reason: "invalid-selection" },
    { selection: [null], reason: "invalid-selection" },
    { selection: [4], reason: "invalid-selection" },
    { selection: ["#aws", undefined], reason: "invalid-selection" },
    { selection: new Array<string>(1), reason: "invalid-selection" },
  ])("blocks selection %# before issuing confirmation", ({ selection, reason }) => {
    const h = harness(["#aws"]); h.prepare();
    const selected = selection as unknown as readonly string[];
    expect(h.session.getReadiness(selected)).toEqual({ status: "blocked", reason, freshness: "unknown" });
    expect(h.session.confirm(selected)).toBeUndefined();
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
    h.session.dispose();
  });

  it("authorizes both exact case representations before mutation deduplication", async () => {
    const h = harness(); h.prepare();
    const selection = ["#AWS", "#aws", "#cloud", "#AWS"];
    expect(h.session.getReadiness(selection).status).toBe("confirmable");
    const confirmation = h.confirm(selection);
    expect(confirmation.selectedTags).toEqual(selection);
    expect(await h.apply(confirmation)).toEqual({ status: "applied", addedTags: ["#AWS", "#cloud"] });
    expect(h.frontmatter.tags).toEqual(["AWS", "cloud"]);
    h.session.dispose();
  });

  it.each(["missing", "revoked", "copied", "forged", "cross-vault"])("blocks a %s Grant", kind => {
    const h = harness(); const success = h.outcome();
    const lifetime = h.issuer.issue(success)!;
    let candidate: TagSuggestionGrantLifetime | undefined = lifetime;
    if (kind === "missing") candidate = undefined;
    if (kind === "revoked") lifetime.dispose();
    if (kind === "copied") candidate = { grant: { ...lifetime.grant }, dispose: vi.fn() };
    if (kind === "forged") candidate = { grant: { source: h.source, allowedTags: ["#aws"] }, dispose: vi.fn() };
    if (kind === "cross-vault") candidate = new TagSuggestionGrantIssuer({ getFileByPath: () => h.file }).issue(success)!;
    h.session.prepare(success, candidate);
    expect(h.session.getReadiness(["#aws"])).toEqual({ status: "blocked", reason: "grant-unavailable", freshness: "unknown" });
    expect(h.session.confirm(["#aws"])).toBeUndefined();
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    lifetime.dispose(); h.session.dispose();
  });

  it.each(["replacement", "rename", "move", "deleted", "non-markdown", "filename", "basename"])(
    "blocks original source %s with no active-note fallback", change => {
      const h = harness(); h.prepare();
      if (change === "replacement") h.vault.getFileByPath.mockReturnValue(syntheticFile());
      if (change === "rename") h.file.path = "Synthetic/Renamed.md";
      if (change === "move") h.file.path = "Elsewhere/A.md";
      if (change === "deleted") h.vault.getFileByPath.mockReturnValue(null);
      if (change === "non-markdown") h.file.extension = "txt";
      if (change === "filename") h.file.name = "Other.md";
      if (change === "basename") h.file.basename = "Other";
      expect(h.session.getReadiness(["#aws"])).toMatchObject({ status: "blocked", reason: "source-changed" });
      expect(h.session.confirm(["#aws"])).toBeUndefined();
      expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
      expect(h.forbidden).not.toHaveBeenCalled(); h.session.dispose();
    },
  );

  it.each(["matching", "changed"] as const)("keeps %s freshness advisory", async freshness => {
    const h = harness();
    const provenance = await captureEvaluationProvenance(h.source, "Synthetic evaluated body");
    h.prepare(provenance);
    h.emit(freshness === "matching" ? "Synthetic evaluated body" : "Synthetic different body", ["#aws"]);
    await vi.waitFor(() => expect(h.session.suggestionFreshness).toBe(freshness));
    expect(h.session.getReadiness(["#aws"])).toEqual({ status: "confirmable", freshness });
    expect(h.confirm().selectedTags).toEqual(["#aws"]);
    expect(h.forbidden).not.toHaveBeenCalled(); h.session.dispose();
  });

  it("keeps unknown observation, inline uncertainty and body-only revision change advisory", async () => {
    const h = harness();
    h.prepare(await captureEvaluationProvenance(h.source, "Synthetic evaluated body"));
    h.file.stat.mtime++; h.file.stat.size++;
    expect(h.session.suggestionFreshness).toBe("unknown");
    expect(h.session.getReadiness(["#aws"])).toEqual({ status: "confirmable", freshness: "unknown" });
    expect(await h.apply(h.confirm())).toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.forbidden).not.toHaveBeenCalled(); h.session.dispose();
  });

  it("permits confirmation when the metadata subscription is unavailable", () => {
    const h = harness(); h.session.dispose();
    h.metadata.on.mockImplementationOnce(() => { throw new Error("Private synthetic subscription detail"); });
    const session = new TagApplyPreparationSession(h.vault, h.metadata as Pick<MetadataCache, "on" | "offref">, h.file);
    const success = h.outcome(); session.prepare(success, h.issuer.issue(success));
    expect(session.getReadiness(["#aws"])).toEqual({ status: "confirmable", freshness: "unknown" });
    expect(session.confirm(["#aws"])).toBeDefined();
    expect(h.forbidden).not.toHaveBeenCalled(); session.dispose();
  });
});

describe("single-use confirmed Tag Apply intent", () => {
  it("privately issues immutable Grant-bound ordered selection and copies the caller array", () => {
    const h = harness(); const lifetime = h.prepare();
    const selection = ["#cloud", "#AWS", "#aws", "#cloud"];
    const confirmation = h.confirm(selection);
    selection.reverse(); selection.push("#unauthorized");
    expect(confirmation.grant).toBe(lifetime.grant);
    expect(confirmation.selectedTags).toEqual(["#cloud", "#AWS", "#aws", "#cloud"]);
    expect(Object.isFrozen(confirmation)).toBe(true);
    expect(Object.isFrozen(confirmation.selectedTags)).toBe(true);
    expect(Reflect.set(confirmation, "grant", { ...lifetime.grant })).toBe(false);
    expect(Reflect.set(confirmation.selectedTags, "0", "#unauthorized")).toBe(false);
    expect(Object.keys(confirmation).sort()).toEqual(["grant", "selectedTags"]);
    expect(JSON.stringify(confirmation)).not.toContain("Synthetic evaluated body");
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled(); h.session.dispose();
  });

  it("same exact ordered selection preserves confirmation across array copies", async () => {
    const h = harness(); h.prepare(); const confirmation = h.confirm(["#cloud", "#aws"]);
    expect(h.session.getReadiness(["#cloud", "#aws"]).status).toBe("confirmable");
    expect(await h.apply(confirmation)).toEqual({ status: "applied", addedTags: ["#cloud", "#aws"] });
    h.session.dispose();
  });

  it("reentrant source resolution cannot issue a different unauthorized private selection", () => {
    const h = harness(); h.prepare();
    h.vault.getFileByPath.mockImplementationOnce(() => {
      expect(h.session.getReadiness(["#forged"])).toMatchObject({ status: "blocked", reason: "invalid-selection" });
      return h.file;
    });
    const confirmation = h.session.confirm(["#aws"]);
    expect(confirmation).toBeUndefined();
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    h.session.dispose();
  });

  it("ordinary JavaScript field assignment cannot revive a replaced confirmation", async () => {
    const h = harness(); const lifetime = h.prepare(); const confirmation = h.confirm();
    h.session.getReadiness(["#cloud"]);
    Object.assign(h.session, {
      selectionGeneration: 1, selection: confirmation.selectedTags, disposed: false,
      grant: lifetime.grant, grantLifetime: lifetime, preparedSource: h.source,
    });
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    h.session.dispose();
  });

  it("overriding public readiness cannot confirm an unauthorized or empty private selection", () => {
    const h = harness(); h.prepare();
    expect(h.session.getReadiness(["#forged"]).status).toBe("blocked");
    const presentationReadiness = vi.fn(() => ({ status: "confirmable" as const, freshness: "unknown" as const }));
    h.session.getReadiness = presentationReadiness;
    expect(h.session.confirm(["#forged"])).toBeUndefined();
    expect(h.session.confirm([])).toBeUndefined();
    expect(presentationReadiness).not.toHaveBeenCalled();
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    h.session.dispose();
  });

  it("overriding the public Grant getter cannot rebind confirmed intent", async () => {
    const h = harness(); const lifetime = h.prepare(); const different = h.issuer.issue(h.outcome())!;
    Object.defineProperty(h.session, "suggestionGrant", { get: () => different.grant });
    const confirmation = h.confirm();
    expect(confirmation.grant).toBe(lifetime.grant);
    expect(confirmation.grant).not.toBe(different.grant);
    expect(await h.apply(confirmation)).toEqual({ status: "applied", addedTags: ["#aws"] });
    h.session.dispose(); different.dispose();
  });

  it.each([["#cloud"], [], ["#cloud", "#aws"], ["#AWS"]])(
    "selection replacement permanently invalidates old confirmation: %s", async (...selection) => {
      const h = harness(); h.prepare(); const confirmation = h.confirm(["#aws", "#cloud"]);
      h.session.getReadiness(selection);
      h.session.getReadiness(["#aws", "#cloud"]);
      expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
      expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled(); h.session.dispose();
    },
  );

  it("different Grant preparation cannot preserve a prior confirmation", async () => {
    const h = harness(); const old = h.prepare(); const confirmation = h.confirm();
    const next = h.issuer.issue(h.outcome())!;
    h.session.prepare(h.outcome(), next);
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(isIssuedSuggestionGrant(old.grant, h.vault)).toBe(false);
    h.session.dispose();
  });

  it.each(["copied", "frozen-copy", "forged", "modified-grant", "modified-selection"])(
    "rejects a %s confirmation without consuming its valid original", async kind => {
      const h = harness(); h.prepare(); const confirmation = h.confirm();
      const attempts: Record<string, unknown> = {
        copied: { ...confirmation }, "frozen-copy": Object.freeze({ ...confirmation }),
        forged: { grant: confirmation.grant, selectedTags: ["#aws"] },
        "modified-grant": { ...confirmation, grant: { ...confirmation.grant } },
        "modified-selection": { ...confirmation, selectedTags: ["#cloud"] },
      };
      expect(await h.apply(attempts[kind])).toEqual({ status: "failure", reason: "invalid-confirmation" });
      expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
      expect(await h.apply(confirmation)).toEqual({ status: "applied", addedTags: ["#aws"] });
      h.session.dispose();
    },
  );

  it("rejects cross-Vault use without consuming the original Vault's confirmation", async () => {
    const h = harness(), other = harness(); h.prepare(); const confirmation = h.confirm();
    expect(await other.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(other.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(await h.apply(confirmation)).toEqual({ status: "applied", addedTags: ["#aws"] });
    h.session.dispose(); other.session.dispose();
  });

  it.each([undefined, null, {}, { selectedTags: ["#aws"] }])("rejects missing or malformed confirmation %#", async confirmation => {
    const h = harness(); h.prepare();
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled(); h.session.dispose();
  });

  it("the direct Grant plus selection request cannot bypass explicit confirmation", async () => {
    const h = harness(); const lifetime = h.prepare();
    const request = { grant: lifetime.grant, selectedTags: ["#aws"] } as unknown as TagApplyRequest;
    expect(await h.service.apply(request, new AbortController().signal)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled(); h.session.dispose();
  });

  it.each(["session", "grant"])("%s disposal revokes an unconsumed confirmation", async kind => {
    const h = harness(); const lifetime = h.prepare(); const confirmation = h.confirm();
    if (kind === "session") h.session.dispose(); else lifetime.dispose();
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.session.getReadiness(["#aws"]).status).toBe("blocked");
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    if (kind === "session") {
      expect(h.session.suggestionGrant).toBeUndefined();
      expect(h.session.getReadiness(["#aws"])).toEqual({ status: "blocked", reason: "session-closed", freshness: "unknown" });
      expect(h.listeners.size).toBe(0);
      expect(h.metadata.offref).toHaveBeenCalledOnce();
      expect(isIssuedSuggestionGrant(lifetime.grant, h.vault)).toBe(false);
    }
    h.session.dispose();
  });

  it("applies one attempt per confirmation and rejects replay before mutation", async () => {
    const h = harness(); h.prepare(); const confirmation = h.confirm();
    expect(await h.apply(confirmation)).toEqual({ status: "applied", addedTags: ["#aws"] });
    h.fileManager.processFrontMatter.mockClear();
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled(); h.session.dispose();
  });

  it("same-path replacement after confirmation fails with no mutation and consumes the attempt", async () => {
    const h = harness(); h.prepare(); const confirmation = h.confirm();
    h.vault.getFileByPath.mockReturnValue(syntheticFile());
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "source-changed" });
    h.vault.getFileByPath.mockReturnValue(h.file);
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled(); h.session.dispose();
  });

  it.each(["session", "selection"])("a %s replacement while processFrontMatter waits rejects assignment", async kind => {
    const h = harness(); h.prepare(); const confirmation = h.confirm();
    h.fileManager.processFrontMatter.mockImplementationOnce(async (_file, callback) => {
      if (kind === "session") h.session.dispose(); else h.session.getReadiness(["#cloud"]);
      callback(h.frontmatter);
    });
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.frontmatter).toEqual({});
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce(); h.session.dispose();
  });

  it("freshness transitions alone preserve confirmation through the mutation callback", async () => {
    const h = harness();
    h.prepare(await captureEvaluationProvenance(h.source, "Synthetic evaluated body"));
    h.emit(); await vi.waitFor(() => expect(h.session.suggestionFreshness).toBe("matching"));
    const confirmation = h.confirm();
    h.fileManager.processFrontMatter.mockImplementationOnce(async (_file, callback) => {
      h.file.stat.mtime++; h.file.stat.size++;
      h.emit("Synthetic changed body with #aws", ["#aws"]);
      await vi.waitFor(() => expect(h.session.suggestionFreshness).toBe("changed"));
      callback(h.frontmatter);
    });
    expect(await h.apply(confirmation)).toEqual({ status: "applied", addedTags: ["#aws"] });
    expect(h.frontmatter.tags).toEqual(["aws"]);
    expect(h.forbidden).not.toHaveBeenCalled(); h.session.dispose();
  });

  it("already-aborted Apply performs no lookup/mutation and leaves confirmation usable", async () => {
    const h = harness(); h.prepare(); const confirmation = h.confirm();
    const controller = new AbortController(); controller.abort(); h.vault.getFileByPath.mockClear();
    expect(await h.service.apply({ confirmation }, controller.signal)).toEqual({ status: "cancelled" });
    expect(h.vault.getFileByPath).not.toHaveBeenCalled();
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(await h.apply(confirmation)).toEqual({ status: "applied", addedTags: ["#aws"] });
    h.session.dispose();
  });

  it("sanitizes mutation failure, makes no retry, and consumes the failed attempt", async () => {
    const h = harness(); h.prepare(); const confirmation = h.confirm();
    h.fileManager.processFrontMatter.mockRejectedValueOnce(new Error("Private synthetic body/path/credential detail"));
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "unexpected" });
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(h.fileManager.processFrontMatter).toHaveBeenCalledOnce();
    expect(h.forbidden).not.toHaveBeenCalled(); h.session.dispose();
  });

  it("late fingerprint completion, stale events and late preparation cannot revive a disposed session", async () => {
    const h = harness(); const lifetime = h.prepare();
    let finishDigest!: (digest: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>(resolve => { finishDigest = resolve; });
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockReturnValue(pending);
    h.emit(); const confirmation = h.confirm(); h.session.dispose();
    finishDigest(new ArrayBuffer(32)); await pending; await Promise.resolve();
    h.callbacks[0](h.file, "Late synthetic body", {});
    const incoming = h.issuer.issue(h.outcome())!;
    h.session.prepare(h.outcome(), incoming);
    expect(h.session.getReadiness(["#aws"])).toEqual({ status: "blocked", reason: "session-closed", freshness: "unknown" });
    expect(h.session.suggestionGrant).toBeUndefined();
    expect(h.session.confirm(["#aws"])).toBeUndefined();
    expect(await h.apply(confirmation)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect(isIssuedSuggestionGrant(lifetime.grant, h.vault)).toBe(false);
    expect(isIssuedSuggestionGrant(incoming.grant, h.vault)).toBe(false);
    expect(digest).toHaveBeenCalledOnce();
    expect(h.listeners.size).toBe(0);
    expect(h.fileManager.processFrontMatter).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
});
