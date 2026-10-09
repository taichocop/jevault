import { readFileSync } from "node:fs";
import type { TAbstractFile, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => ({ ...await import("./helpers/obsidian-move"),
  parseFrontMatterTags: (fm: Record<string, unknown>) => typeof fm.tags === "string"
    ? fm.tags.split(",").map(name => `#${name.trim()}`) : null,
}));
import { OrganizationApplyConfirmationSession } from "../src/organizer/organization-apply-confirmation";
import { OrganizationApplyService } from "../src/organizer/organization-apply-service";
import { TFile as FakeFile, TFolder as FakeFolder } from "./helpers/obsidian-move";
import { syntheticReview } from "./helpers/organizer-apply-safety-spike";
import { acquireVaultMutationLease } from "../src/vault-mutation-coordinator";
import { NoteMoveService } from "../src/note-move-service";
import { NoteSource } from "../src/note-source";
import { TagApplyService } from "../src/tags/tag-apply-service";
import { TagApplyPreparationSession } from "../src/tags/tag-apply-preparation";
import { TagSuggestionGrantIssuer } from "../src/tags/tag-suggestion-grant";

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function harness(tags: readonly string[] = ["#reviewed"], destination: string | null = "Dest", count = 1) {
  const files = Array.from({ length: count }, (_, index) => Object.assign(new FakeFile(`Inbox/${index}.md`),
    { stat: { ctime: 1, mtime: 2, size: 100 } }) as TFile);
  const folder = new FakeFolder(destination ?? "Dest");
  const entries = new Map<string, unknown>([[folder.path, folder], ...files.map(f => [f.path, f] as const)]);
  const forbidden = vi.fn(() => { throw new Error("Forbidden"); });
  const vault = { configDir: ".obsidian", getAllFolders: vi.fn(() => [folder] as never),
    getAbstractFileByPath: vi.fn((path: string) => (entries.get(path) ?? null) as TAbstractFile | null),
    getFileByPath: vi.fn((path: string) => (entries.get(path) ?? null) as TFile | null),
    read: forbidden, cachedRead: forbidden, create: forbidden, createFolder: forbidden, delete: forbidden,
    modify: forbidden, secretLookup: forbidden, typesafe: forbidden, recollection: forbidden,
  };
  const frontmatters = files.map(() => ({ tags: ["KEEP", "KEEP"], aliases: ["fixture"], custom: { preserve: true } } as Record<string, unknown>));
  const manager = {
    processFrontMatter: vi.fn(async (f: TFile, callback: (fm: Record<string, unknown>) => void) => {
      callback(frontmatters[files.indexOf(f)]); f.stat.mtime++; f.stat.size += 20;
    }),
    renameFile: vi.fn(async (f: TAbstractFile, target: string) => { entries.delete(f.path); f.path = target; entries.set(target, f); }),
  };
  const review = syntheticReview(files, tags, destination);
  const confirmation = new OrganizationApplyConfirmationSession(vault, review);
  const controller = new AbortController();
  const settings = { inboxPath: "", ignoredFolders: [] as string[] };
  const service = new OrganizationApplyService(vault, manager, () => settings);
  const run = (intent: unknown = confirmation.confirm(), progress?: Parameters<OrganizationApplyService["apply"]>[2]) =>
    service.apply(intent as never, controller.signal, progress);
  return { files, file: files[0], folder, entries, vault, forbidden, frontmatters, frontmatter: frontmatters[0],
    manager, review, confirmation, controller, settings, service, run };
}
function manual(h: ReturnType<typeof harness>, file = h.file) {
  const source = new NoteSource(file);
  const outcome = { status: "success" as const, source, noteTitle: "Fixture",
    suggestions: [{ tagName: "#manual", tagId: "1", choice: "match" as const, matchProbability: 1 }] };
  const lifetime = new TagSuggestionGrantIssuer(h.vault).issue(outcome)!;
  const session = new TagApplyPreparationSession(h.vault, { on: vi.fn(), offref: vi.fn() }, file);
  session.prepare(outcome, lifetime);
  return new TagApplyService(h.vault, h.manager).apply({ confirmation: session.confirm(["#manual"])! }, new AbortController().signal);
}

describe("#107 production Apply foundation", () => {
  it("1 rejects bare Review with zero mutations", async () => {
    const h = harness();
    expect(await h.run(h.review.getResult())).toMatchObject({ status: "stopped", reason: "invalid-confirmation", results: [] });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("62 additive Tag then Move uses own post-Tag baseline", async () => {
    const h = harness();
    expect((await h.run()).results[0]).toMatchObject({ tag: "applied", move: "applied", outcome: "moved-and-tags" });
    expect(h.frontmatter).toEqual({ tags: ["KEEP", "KEEP", "reviewed"], aliases: ["fixture"], custom: { preserve: true } });
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("14 same-path replacement is stale", async () => {
    const h = harness(); h.entries.set(h.file.path, Object.assign(new FakeFile(h.file.path), { stat: { ...h.file.stat } }));
    expect((await h.run()).results[0].outcome).toBe("stale");
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("35–36 same-current-folder continues Tags without rename", async () => {
    const h = harness(["#reviewed"], "Inbox");
    expect((await h.run()).results[0]).toMatchObject({ tag: "applied", move: "unchanged", outcome: "updated-tags" });
    expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("58 unchanged Tags still use post-call stat", async () => {
    const h = harness(["#keep"]);
    expect((await h.run()).results[0]).toMatchObject({ tag: "unchanged", move: "applied", outcome: "moved" });
  });
  it("64 Tag success + Move failure preserves partial truth", async () => {
    const h = harness(); h.manager.renameFile.mockRejectedValue(new Error("private"));
    expect((await h.run()).results[0]).toMatchObject({ tag: "applied", move: "failed", outcome: "partial" });
    expect(h.frontmatter.tags).toContain("reviewed");
  });
});

describe("#107 authority 2–12", () => {
  it.each(["forged", "copy", "serialized", "cross-vault", "manual"])("rejects %s without mutation", async mode => {
    const h = harness(), token = h.confirmation.confirm()!;
    const intent = mode === "forged" ? { kind: token.kind } : mode === "copy" ? { ...token }
      : mode === "serialized" ? JSON.parse(JSON.stringify(token)) : token;
    const service = mode === "cross-vault" ? new OrganizationApplyService({ ...h.vault }, h.manager, () => h.settings) : h.service;
    const input = mode === "manual" ? { grant: {}, selectedTags: ["#reviewed"] } : intent;
    expect(await service.apply(input, h.controller.signal)).toMatchObject({ status: "stopped", reason: "invalid-confirmation" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("6/8 exact Review replacement invalidates old intent", async () => {
    const h = harness(), exact = h.review.getResult()!, token = h.confirmation.confirm()!;
    vi.spyOn(h.review, "getResult").mockReturnValue(Object.freeze({ ...exact }));
    expect(await h.run(token)).toMatchObject({ status: "stopped", reason: "invalid-confirmation" });
  });
  it.each(["confirmation", "review"] as const)("7–8 %s disposal invalidates", async owner => {
    const h = harness(), token = h.confirmation.confirm(); h[owner].dispose();
    expect(await h.run(token)).toMatchObject({ status: "stopped", reason: "invalid-confirmation" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled();
  });
  it.each(["success", "stale", "busy", "tag", "move", "cancelled"])("9/11 accepted %s attempt consumes", async mode => {
    const h = harness(), token = h.confirmation.confirm();
    const held = mode === "busy" ? acquireVaultMutationLease(h.vault, h.file.path) : undefined;
    if (mode === "stale") h.file.stat.mtime++;
    if (mode === "tag") h.manager.processFrontMatter.mockRejectedValueOnce(new Error("private"));
    if (mode === "move") h.manager.renameFile.mockRejectedValueOnce(new Error("private"));
    await h.run(token, mode === "cancelled" ? progress => { if (progress.currentPath) h.controller.abort(); } : undefined);
    held?.release();
    expect(await h.service.apply(token!, new AbortController().signal)).toMatchObject({ status: "stopped", reason: "invalid-confirmation" });
  });
  it("10 pre-abort does not consume", async () => {
    const h = harness(), token = h.confirmation.confirm()!; h.controller.abort();
    expect(await h.run(token)).toMatchObject({ status: "cancelled", results: [], progress: { total: 1, processed: 0 } });
    expect((await h.service.apply(token, new AbortController().signal)).status).toBe("completed");
  });
  it("12 zero reviewed cannot issue or complete", async () => {
    const h = harness(), exact = h.review.getResult()!;
    vi.spyOn(h.review, "getResult").mockReturnValue(Object.freeze({ ...exact, reviewed: Object.freeze([]) }));
    const session = new OrganizationApplyConfirmationSession(h.vault, h.review);
    expect(session.confirm()).toBeUndefined();
    expect((await h.run(session.confirm())).status).toBe("stopped");
  });
});

describe("#107 source/stale 13–23", () => {
  const changes: Record<string, (h: ReturnType<typeof harness>) => void> = {
    renamed: h => { h.file.path = "Inbox/renamed.md"; }, moved: h => { h.file.path = "Other/0.md"; },
    deleted: h => { h.entries.delete(h.file.path); }, mtime: h => { h.file.stat.mtime++; },
    size: h => { h.file.stat.size++; }, nonfinite: h => { h.file.stat.mtime = NaN; },
    negativeTime: h => { h.file.stat.mtime = -1; }, negativeSize: h => { h.file.stat.size = -1; },
    infiniteSize: h => { h.file.stat.size = Infinity; }, markdown: h => { h.file.extension = "txt"; },
    filename: h => { h.file.name = "other.md"; },
  };
  it.each(Object.keys(changes))("rejects %s before mutation", async key => {
    const h = harness(); changes[key](h);
    const result = await h.run(); expect(result.results[0]).toMatchObject({ outcome: "stale", reason: "stale" });
    expect(result.progress).toMatchObject({ failed: 0, stale: 1, processed: 1 });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("snapshot path mismatch is stale", async () => {
    const h = harness(), exact = h.review.getResult()!, note = exact.reviewed[0];
    vi.spyOn(h.review, "getResult").mockReturnValue(Object.freeze({ ...exact, reviewed: Object.freeze([
      Object.freeze({ ...note, snapshot: Object.freeze({ ...note.snapshot, path: "Other/0.md" }) }),
    ]) }));
    const session = new OrganizationApplyConfirmationSession(h.vault, h.review);
    expect((await h.run(session.confirm())).results[0].outcome).toBe("stale");
  });
  it("22–23 ignores active note, uses no body/network/Secret/recollection boundary", async () => {
    const h = harness(); Object.assign(h.vault, { activeFile: new FakeFile("Other/active.md"), getActiveFile: h.forbidden });
    expect((await h.run()).results[0].outcome).toBe("moved-and-tags"); expect(h.forbidden).not.toHaveBeenCalled();
  });
});

describe("#107 shared lease 24–33", () => {
  it("holds source+target+identity across Tag→Move, cancellation and settlement", async () => {
    const h = harness(), tagGate = deferred(), moveGate = deferred();
    h.manager.processFrontMatter.mockImplementationOnce(async (f, cb) => { cb(h.frontmatter); f.stat.mtime++; await tagGate.promise; });
    h.manager.renameFile.mockImplementationOnce(() => moveGate.promise);
    const pending = h.run(); await flush();
    expect(acquireVaultMutationLease(h.vault, h.file.path)).toBeUndefined();
    expect(acquireVaultMutationLease(h.vault, "Other/0.md", "Dest/0.md")).toBeUndefined();
    expect(acquireVaultMutationLease(h.vault, "Else/0.md", undefined, h.file)).toBeUndefined();
    expect(await manual(h)).toMatchObject({ status: "failure", reason: "busy" });
    expect(await new NoteMoveService(h.vault, h.manager).move(new NoteSource(h.file), ["Dest"], "Dest", new AbortController().signal))
      .toMatchObject({ status: "failure", reason: "busy" });
    expect((await h.run()).results[0].reason).toBe("busy");
    const other = Object.assign(new FakeFile("Other/0.md"), { stat: { mtime: 2, size: 100 } }) as TFile; h.entries.set(other.path, other);
    expect(await new NoteMoveService(h.vault, h.manager).move(new NoteSource(other), ["Dest"], "Dest", new AbortController().signal))
      .toMatchObject({ status: "failure", reason: "busy" });
    const unrelated = acquireVaultMutationLease(h.vault, "Else/1.md", "Dest/1.md"); expect(unrelated).toBeDefined(); unrelated?.release();
    tagGate.resolve(); await flush(); expect(h.manager.renameFile).toHaveBeenCalledOnce();
    expect(acquireVaultMutationLease(h.vault, h.file.path)).toBeUndefined();
    h.controller.abort(); await flush(); expect(acquireVaultMutationLease(h.vault, h.file.path)).toBeUndefined();
    moveGate.resolve(); const result = await pending;
    expect(result.status).toBe("cancelled"); expect(result.results[0].move).toBe("applied");
    const released = acquireVaultMutationLease(h.vault, h.file.path, "Dest/0.md", h.file); expect(released).toBeDefined(); released?.release();
  });
  it("unrelated actual Manual mutation proceeds while Organizer is pending", async () => {
    const h = harness(), gate = deferred();
    h.manager.processFrontMatter.mockImplementationOnce(async (_f, cb) => { cb(h.frontmatter); await gate.promise; });
    const pending = h.run(); await flush();
    const other = Object.assign(new FakeFile("Other/1.md"), { stat: { mtime: 2, size: 10 } }) as TFile;
    h.files.push(other); h.frontmatters.push({}); h.entries.set(other.path, other);
    expect((await manual(h, other)).status).toBe("applied");
    gate.resolve(); await pending;
  });
  it.each(["success", "stale", "destination", "tag", "move", "invariant"])("32 releases after %s", async mode => {
    const h = harness();
    if (mode === "stale") h.file.stat.size++;
    if (mode === "destination") h.entries.delete("Dest");
    if (mode === "tag") h.manager.processFrontMatter.mockRejectedValueOnce(new Error("private"));
    if (mode === "move") h.manager.renameFile.mockRejectedValueOnce(new Error("private"));
    if (mode === "invariant") h.vault.getAllFolders.mockImplementationOnce(() => { throw new Error("private"); });
    await h.run(); const lease = acquireVaultMutationLease(h.vault, h.file.path, "Dest/0.md", h.file);
    expect(lease).toBeDefined(); lease?.release();
  });
});

describe("#107 destination 34–44", () => {
  it("34 Keep current + zero tags invokes neither API nor destination policy", async () => {
    const h = harness([], null);
    expect((await h.run()).results[0]).toMatchObject({ tag: "not-selected", move: "keep-current", outcome: "unchanged" });
    expect(h.manager.renameFile).not.toHaveBeenCalled(); expect(h.manager.processFrontMatter).not.toHaveBeenCalled();
    expect(h.vault.getAllFolders).not.toHaveBeenCalled();
  });
  it.each(["missing", "ineligible", "collision", "case-collision", "unsafe"])("37–40 %s blocks Tags", async mode => {
    const h = harness(["#reviewed"], mode === "unsafe" ? "../Dest" : "Dest");
    if (mode === "missing") h.entries.delete("Dest");
    if (mode === "ineligible") h.settings.ignoredFolders.push("Dest");
    if (mode === "collision") h.entries.set("Dest/0.md", new FakeFile("Dest/0.md"));
    if (mode === "case-collision") h.folder.children.push(new FakeFile("Dest/0.MD"));
    expect((await h.run()).results[0].outcome).toBe("failed");
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it.each(["missing", "collision", "ineligible"])("41–44 post-Tag %s retains partial truth", async mode => {
    const h = harness();
    h.manager.processFrontMatter.mockImplementationOnce(async (f, cb) => {
      cb(h.frontmatter); f.stat.mtime++; f.stat.size++;
      if (mode === "missing") h.entries.delete("Dest");
      if (mode === "collision") h.entries.set("Dest/0.md", new FakeFile("Dest/0.md"));
      if (mode === "ineligible") h.settings.inboxPath = "Dest";
    });
    const result = await h.run(); expect(result.results[0]).toMatchObject({ tag: "applied", move: "failed", outcome: "partial" });
    expect(result.progress.failed).toBe(1); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
});

describe("#107 Tags and baseline 45–61", () => {
  it("45/55 zero Tags preserves original snapshot and only moves", async () => {
    const h = harness([]); expect((await h.run()).results[0]).toMatchObject({ tag: "not-selected", move: "applied" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled();
  });
  it("46–49/54 exact reviewed names dedupe current FM without rediscovery", async () => {
    const h = harness(["#keep", "#日本語", "#nested/tag"]);
    expect((await h.run()).results[0].tag).toBe("applied");
    expect(h.frontmatter.tags).toEqual(["KEEP", "KEEP", "日本語", "nested/tag"]); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each([null, 42, {}, ["supported", 2], ["bad tag"]])("51–53 unsupported %j safely stops Move", async tags => {
    const h = harness(); h.frontmatter.tags = tags; const before = structuredClone(h.frontmatter);
    const result = await h.run(); expect(result.results[0]).toMatchObject({ tag: "failed", move: "not-started-prior-failure", reason: "tag-failed" });
    expect(h.frontmatter).toEqual(before); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("preserve");
  });
  it("supported scalar Tags retain order with additive write", async () => {
    const h = harness(); h.frontmatter.tags = "one, two";
    await h.run(); expect(h.frontmatter.tags).toEqual(["one", "two", "reviewed"]);
  });
  it.each([false, true])("56/61 intervening change after baseline with Tags=%s blocks Move", async tags => {
    const h = harness(tags ? ["#reviewed"] : []); let calls = 0;
    h.vault.getAllFolders.mockImplementation(() => { if (++calls === 2) h.file.stat.mtime++; return [h.folder] as never; });
    const note = (await h.run()).results[0];
    expect(note).toMatchObject({ tag: tags ? "applied" : "not-selected", move: "not-started-stale", outcome: tags ? "partial" : "stale" });
    expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it.each(["delete", "rename", "replace"])("60 %s after Tag blocks Move", async mode => {
    const h = harness();
    h.manager.processFrontMatter.mockImplementationOnce(async (f, cb) => {
      cb(h.frontmatter); f.stat.mtime++;
      if (mode === "delete") h.entries.delete(f.path);
      if (mode === "rename") f.path = "Else/0.md";
      if (mode === "replace") h.entries.set(f.path, Object.assign(new FakeFile(f.path), { stat: { ...f.stat } }));
    });
    expect((await h.run()).results[0]).toMatchObject({ tag: "applied", move: "not-started-stale", outcome: "partial" });
    expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it("callback stale before assignment is not malformed-frontmatter failure", async () => {
    const h = harness();
    h.manager.processFrontMatter.mockImplementationOnce(async (f, cb) => { f.stat.mtime++; cb(h.frontmatter); });
    expect((await h.run()).results[0]).toMatchObject({ tag: "interrupted-stale", reason: "stale" });
    expect(h.frontmatter.tags).toEqual(["KEEP", "KEEP"]); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
});

describe("#107 cancellation/lifetime 65–77", () => {
  it.each(["abort", "revoke"])("during Tag %s waits real settlement, preserves truth and lease", async mode => {
    const h = harness(["#reviewed"], "Dest", 2), gate = deferred();
    h.manager.processFrontMatter.mockImplementationOnce(async (f, cb) => { cb(h.frontmatter); f.stat.mtime++; await gate.promise; });
    let settled = false; const pending = h.run().then(result => { settled = true; return result; }); await flush();
    if (mode === "abort") h.controller.abort(); else h.confirmation.dispose();
    await flush(); expect(settled).toBe(false); expect(acquireVaultMutationLease(h.vault, h.file.path)).toBeUndefined();
    gate.resolve(); const result = await pending;
    expect(result.status).toBe(mode === "abort" ? "cancelled" : "stopped");
    expect(result.results[0]).toMatchObject({ tag: "applied", outcome: mode === "abort" ? "cancelled-after-partial" : "partial" });
    expect(result.progress.failed).toBe(0); expect(result.results).toHaveLength(1); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect(h.frontmatter.tags).toContain("reviewed"); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(["abort", "revoke"])("before Tag %s starts zero mutation", async mode => {
    const h = harness(); h.vault.getAllFolders.mockImplementationOnce(() => {
      if (mode === "abort") h.controller.abort(); else h.confirmation.dispose(); return [h.folder] as never;
    });
    const result = await h.run(); expect(result.status).toBe(mode === "abort" ? "cancelled" : "stopped");
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it.each(["abort", "revoke"])("before Tag callback assignment %s preserves FM", async mode => {
    const h = harness(), gate = deferred();
    h.manager.processFrontMatter.mockImplementationOnce(async (_f, cb) => { await gate.promise; cb(h.frontmatter); });
    const pending = h.run(); await flush();
    if (mode === "abort") h.controller.abort(); else h.confirmation.dispose();
    gate.resolve(); const result = await pending;
    expect(result.status).toBe(mode === "abort" ? "cancelled" : "stopped"); expect(h.frontmatter.tags).toEqual(["KEEP", "KEEP"]);
    expect(result.results[0].tag).toBe(mode === "abort" ? "interrupted-cancelled" : "interrupted-revoked");
    expect(result.progress.failed).toBe(0);
    expect(result.results[0].reason).not.toBe("tag-failed"); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it.each(["abort", "revoke"])("during Move %s preserves actual settlement and stops next Note", async mode => {
    const h = harness([], "Dest", 2), gate = deferred(); h.manager.renameFile.mockImplementationOnce(() => gate.promise);
    const pending = h.run(); await flush(); if (mode === "abort") h.controller.abort(); else h.confirmation.dispose();
    expect(acquireVaultMutationLease(h.vault, h.file.path)).toBeUndefined(); gate.resolve(); const result = await pending;
    expect(result.status).toBe(mode === "abort" ? "cancelled" : "stopped");
    expect(result.results).toHaveLength(1); expect(result.results[0].move).toBe("applied"); expect(h.manager.renameFile).toHaveBeenCalledOnce();
  });
  it("abort before Move starts rename 0", async () => {
    const h = harness(); let calls = 0;
    h.vault.getAllFolders.mockImplementation(() => { if (++calls === 2) h.controller.abort(); return [h.folder] as never; });
    expect((await h.run()).results[0]).toMatchObject({ tag: "applied", move: "not-started-cancelled", outcome: "cancelled-after-partial" });
    expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
});

describe("#107 sequential results/progress 78–103", () => {
  it.each(["stale", "destination", "tag", "move", "busy"])("80–85 %s failure continues in reviewed order", async mode => {
    const h = harness(["#reviewed"], "Dest", 3);
    const held = mode === "busy" ? acquireVaultMutationLease(h.vault, h.files[1].path) : undefined;
    if (mode === "stale") h.files[1].stat.mtime++;
    if (mode === "destination") h.entries.set("Dest/1.md", new FakeFile("Dest/1.md"));
    if (mode === "tag") h.manager.processFrontMatter.mockImplementation(async (f, cb) => {
      if (f === h.files[1]) throw new Error("private"); cb(h.frontmatters[h.files.indexOf(f)]); f.stat.mtime++;
    });
    if (mode === "move") h.manager.renameFile.mockImplementation(async (f, target) => {
      if (f === h.files[1]) throw new Error("private"); h.entries.delete(f.path); f.path = target; h.entries.set(target, f);
    });
    const progress: unknown[] = []; const result = await h.run(undefined, p => progress.push(p)); held?.release();
    expect(result.status).toBe("completed"); expect(result.results.map(n => n.index)).toEqual([0, 1, 2]);
    expect(result.results[0].outcome).toBe("moved-and-tags"); expect(result.results[2].outcome).toBe("moved-and-tags");
    expect(result.progress).toEqual({ total: 3, processed: 3, failed: mode === "stale" ? 0 : 1, stale: mode === "stale" ? 1 : 0 });
    expect(progress.every(Object.isFrozen)).toBe(true);
    expect(progress).toContainEqual({ total: 3, processed: 0, failed: 0, stale: 0, currentPath: "Inbox/0.md" });
    expect(progress.at(-1)).toEqual(result.progress);
    expect(h.manager.processFrontMatter.mock.calls.filter(([f]) => f === h.files[1]).length).toBeLessThanOrEqual(1);
  });
  it("79 unavailable excluded, no fabricated result", async () => {
    const h = harness(), exact = h.review.getResult()!;
    vi.spyOn(h.review, "getResult").mockReturnValue(Object.freeze({ ...exact, unavailable: Object.freeze([
      Object.freeze({ source: new NoteSource(h.file), snapshot: exact.reviewed[0].snapshot, reason: "analysis-unavailable" as const }),
    ]) }));
    const session = new OrganizationApplyConfirmationSession(h.vault, h.review);
    const result = await h.run(session.confirm()); expect(result.progress.total).toBe(1); expect(result.results).toHaveLength(1);
  });
  it("67/73/86 cancel before next Note retains first result without untouched result", async () => {
    const h = harness(["#reviewed"], "Dest", 2);
    const result = await h.run(undefined, p => { if (p.processed === 1) h.controller.abort(); });
    expect(result.status).toBe("cancelled"); expect(result.results).toHaveLength(1);
    expect(result.results[0].outcome).toBe("moved-and-tags"); expect(result.progress.failed).toBe(0);
  });
  it.each(["lookup", "policy", "callback-missing", "callback-repeated"])("88 internal %s failure stops globally", async mode => {
    const h = harness(["#reviewed"], "Dest", 2);
    if (mode === "lookup") h.vault.getAbstractFileByPath.mockImplementationOnce(() => { throw new Error("private"); });
    if (mode === "policy") h.vault.getAllFolders.mockImplementationOnce(() => { throw new Error("private"); });
    if (mode === "callback-missing") h.manager.processFrontMatter.mockImplementationOnce(async () => {});
    if (mode === "callback-repeated") h.manager.processFrontMatter.mockImplementationOnce(async (_f, cb) => { cb(h.frontmatter); cb(h.frontmatter); });
    expect(await h.run()).toMatchObject({ status: "stopped", reason: "invariant" }); expect(h.manager.renameFile).not.toHaveBeenCalled();
  });
  it.each(["initial", "active", "terminal"])("102 observer exception at %s stops safely", async stage => {
    const h = harness(["#reviewed"], "Dest", 2);
    const result = await h.run(undefined, p => { if (stage === "initial" || stage === "active" && p.currentPath || stage === "terminal" && p.processed === 1) throw new Error("private"); });
    expect(result).toMatchObject({ status: "stopped", reason: "invariant" }); expect(result.results).toHaveLength(stage === "terminal" ? 1 : 0);
    expect(h.manager.processFrontMatter).toHaveBeenCalledTimes(stage === "terminal" ? 1 : 0);
  });
  it("90–95/103 operation, terminal results, arrays and progress are immutable and safe", async () => {
    const h = harness(); h.manager.renameFile.mockRejectedValueOnce(new Error("/absolute/path private body Secret provider"));
    const result = await h.run();
    for (const value of [result, result.results, result.results[0], result.progress]) expect(Object.isFrozen(value)).toBe(true);
    expect(result.results[0].outcome).toBe("partial");
    expect(JSON.stringify(result)).not.toMatch(/absolute|private|Secret|provider|aliases|tags":\[/);
    expect(result.results[0].reason).toBe("move-failed");
  });
  it("110 Apply core stays outside UI/main bundle; no test-spike import in production", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(main).not.toMatch(/OrganizationApply|organization-apply/);
    for (const name of ["confirmation", "service", "result"]) {
      expect(readFileSync(new URL(`../src/organizer/organization-apply-${name}.ts`, import.meta.url), "utf8")).not.toMatch(/tests\/|safety-spike|TargetFileCollector|cachedRead|\.read\(|SecretStorage|typesafe/i);
    }
  });
});

describe("#107 final boundary and in-flight failure truth", () => {
  it.each(["abort", "revoke", "stale", "ineligible", "collision", "throw"])("final Move validator %s starts no rename", async mode => {
    const h = harness(); let calls = 0;
    h.vault.getAllFolders.mockImplementation(() => {
      if (++calls === 3) {
        if (mode === "abort") h.controller.abort();
        if (mode === "revoke") h.confirmation.dispose();
        if (mode === "stale") h.file.stat.size++;
        if (mode === "ineligible") return [] as never;
        if (mode === "collision") h.entries.set("Dest/0.md", new FakeFile("Dest/0.md"));
        if (mode === "throw") throw new Error("private");
      }
      return [h.folder] as never;
    });
    const result = await h.run(); expect(h.manager.renameFile).not.toHaveBeenCalled(); expect(result.results[0].tag).toBe("applied");
    expect(result.results[0].outcome).toBe(mode === "abort" ? "cancelled-after-partial" : "partial");
    expect(result.status).toBe(mode === "revoke" || mode === "throw" ? "stopped" : mode === "abort" ? "cancelled" : "completed");
    expect(result.results[0].reason).toBe(mode === "ineligible" ? "ineligible-destination" : mode === "collision" ? "collision"
      : mode === "stale" ? "stale" : mode === "revoke" ? "invalid-confirmation" : mode === "throw" ? "invariant" : undefined);
  });
  it.each(["tag", "move"] as const)("started %s rejects after abort: retains API failure instead of not-started", async phase => {
    const h = harness(), gate = deferred();
    if (phase === "tag") h.manager.processFrontMatter.mockImplementationOnce(() => gate.promise);
    else h.manager.renameFile.mockImplementationOnce(() => gate.promise);
    const pending = h.run(); await flush(); h.controller.abort(); gate.reject(new Error("private"));
    const result = await pending; expect(result.status).toBe("cancelled");
    expect(result.results[0][phase]).toBe("failed"); expect(result.progress.failed).toBe(1);
    expect(h.manager[phase === "tag" ? "processFrontMatter" : "renameFile"]).toHaveBeenCalledOnce();
  });
  it("mutable or expanded selections cannot replace exact frozen reviewed intent", async () => {
    const h = harness(), exact = h.review.getResult()!;
    expect(() => { (exact.reviewed[0].selectedTags as string[]).push("#unreviewed"); }).toThrow();
    expect(h.review.selectTag(0, "#unreviewed", true)).toBe(false);
    expect(h.review.selectFolder(0, { kind: "existing-folder", path: "Else" })).toBe(false);
    const token = h.confirmation.confirm()!; expect(Object.isFrozen(token)).toBe(true);
    const result = await h.run(token); expect(result.results[0].outcome).toBe("moved-and-tags");
    expect(h.frontmatter.tags).toEqual(["KEEP", "KEEP", "reviewed"]);
  });
  it("source identity binding conflict returns busy without APIs", async () => {
    const h = harness(), lease = acquireVaultMutationLease(h.vault, "Else/0.md", undefined, h.file)!;
    expect((await h.run()).results[0].reason).toBe("busy");
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled(); lease.release();
  });
});

it("final lower-level destination lookup exception stops globally instead of continuing", async () => {
  const h = harness(["#reviewed"], "Dest", 2); let destinationLookups = 0;
  h.vault.getAbstractFileByPath.mockImplementation(path => {
    if (path === "Dest" && ++destinationLookups === 3) throw new Error("private validation failure");
    return (h.entries.get(path) ?? null) as TAbstractFile | null;
  });
  const result = await h.run(); expect(result).toMatchObject({ status: "stopped", reason: "invariant" });
  expect(result.results).toHaveLength(1); expect(result.results[0]).toMatchObject({ tag: "applied", outcome: "partial", reason: "invariant" });
  expect(h.manager.processFrontMatter).toHaveBeenCalledOnce(); expect(h.manager.renameFile).not.toHaveBeenCalled();
  const lease = acquireVaultMutationLease(h.vault, h.file.path, "Dest/0.md"); expect(lease).toBeDefined(); lease?.release();
});

it.each([null, "Inbox"])("cancellation after Tag settlement retains no-op Move %s", async destination => {
  const h = harness(["#reviewed"], destination, 2), gate = deferred();
  h.manager.processFrontMatter.mockImplementationOnce(async (f, cb) => { cb(h.frontmatter); f.stat.mtime++; await gate.promise; });
  const pending = h.run(); await flush(); h.controller.abort(); gate.resolve();
  const result = await pending;
  expect(result.status).toBe("cancelled"); expect(result.results).toHaveLength(1);
  expect(result.results[0]).toMatchObject({ tag: "applied", move: destination === null ? "keep-current" : "unchanged", outcome: "updated-tags" });
  expect(result.progress.failed).toBe(0); expect(h.manager.renameFile).not.toHaveBeenCalled();
});
it("Tag callback interrupted by cancellation retains keep-current intent", async () => {
  const h = harness(["#reviewed"], null), gate = deferred();
  h.manager.processFrontMatter.mockImplementationOnce(async (_f, cb) => { await gate.promise; cb(h.frontmatter); });
  const pending = h.run(); await flush(); h.controller.abort(); gate.resolve();
  expect(await pending).toMatchObject({ status: "cancelled", results: [
    { tag: "interrupted-cancelled", move: "keep-current", outcome: "cancelled" },
  ] });
  expect(h.frontmatter.tags).toEqual(["KEEP", "KEEP"]); expect(h.manager.renameFile).not.toHaveBeenCalled();
});

it.each([null, "Inbox"])("lifetime/stale/failure retains no-op Move %s", async destination => {
  for (const reason of ["revoked", "stale", "tag-failed"] as const) {
    const h = harness(["#reviewed"], destination, 2), gate = deferred();
    h.manager.processFrontMatter.mockImplementationOnce(async (f, cb) => {
      if (reason === "tag-failed") throw new Error("private");
      cb(h.frontmatter); f.stat.mtime++; await gate.promise;
    });
    const pending = h.run(); await flush();
    if (reason === "revoked") h.confirmation.dispose();
    if (reason === "stale") h.entries.delete(h.file.path);
    gate.resolve(); const result = await pending;
    expect(result.results[0].move).toBe(destination === null ? "keep-current" : "unchanged");
    expect(result.results[0].reason).toBe(reason === "revoked" ? "invalid-confirmation" : reason);
    expect(result.status).toBe(reason === "revoked" ? "stopped" : "completed");
    expect(h.manager.renameFile).not.toHaveBeenCalled();
    if (reason === "revoked") expect(result.results).toHaveLength(1);
  }
});
