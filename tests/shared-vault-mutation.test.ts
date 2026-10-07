import type { TAbstractFile, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => ({ ...await import("./helpers/obsidian-move"), parseFrontMatterTags: () => null }));

import { NoteMoveService } from "../src/note-move-service";
import { NoteSource } from "../src/note-source";
import { TagApplyPreparationSession } from "../src/tags/tag-apply-preparation";
import { TagApplyService } from "../src/tags/tag-apply-service";
import { TagSuggestionGrantIssuer } from "../src/tags/tag-suggestion-grant";
import { acquireVaultMutationLease } from "../src/vault-mutation-coordinator";
import { TFile as FakeFile, TFolder as FakeFolder } from "./helpers/obsidian-move";

function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(paths = ["Inbox/A.md", "Other/A.md", "Inbox/B.md"]) {
  const files = paths.map(path => Object.assign(new FakeFile(path), { stat: { mtime: 1, size: 10 } }) as TFile);
  const entries = new Map<string, unknown>([...files.map(f => [f.path, f] as const), ["Dest", new FakeFolder("Dest")]]);
  const vault = {
    getFileByPath: vi.fn((path: string) => (entries.get(path) ?? null) as TFile | null),
    getAbstractFileByPath: vi.fn((path: string) => (entries.get(path) ?? null) as TAbstractFile | null),
  };
  const manager = {
    processFrontMatter: vi.fn(async (_file: TFile, callback: (fm: Record<string, unknown>) => void) => callback({})),
    renameFile: vi.fn<(_file: TAbstractFile, _target: string) => Promise<void>>(async () => {}),
  };
  const signal = new AbortController().signal;
  const confirm = (file = files[0]) => {
    const source = new NoteSource(file);
    const outcome = { status: "success" as const, source, noteTitle: "Synthetic", suggestions: [
      { tagName: "#existing", tagId: "1", choice: "match" as const, matchProbability: 1 },
    ] };
    const lifetime = new TagSuggestionGrantIssuer(vault).issue(outcome)!;
    const session = new TagApplyPreparationSession(vault, { on: vi.fn(), offref: vi.fn() }, file);
    session.prepare(outcome, lifetime);
    return { confirmation: session.confirm(["#existing"])!, session, lifetime };
  };
  const tag = (file = files[0], abort = signal) => new TagApplyService(vault, manager).apply(confirm(file), abort);
  const move = (file = files[0], abort = signal) => new NoteMoveService(vault, manager).move(new NoteSource(file), ["Dest"], "Dest", abort);
  return { files, entries, vault, manager, signal, confirm, tag, move };
}

describe("shared Manual Tag Apply / Manual Move mutation domain", () => {
  it.each(["tag", "move"] as const)("pending %s blocks the other service until actual settlement after abort", async firstKind => {
    const h = harness(), gate = deferred(), abort = new AbortController();
    if (firstKind === "tag") h.manager.processFrontMatter.mockImplementationOnce(async (_file, callback) => { callback({}); await gate.promise; });
    else h.manager.renameFile.mockImplementationOnce(() => gate.promise);
    const first = h[firstKind](h.files[0], abort.signal);
    abort.abort();
    const token = h.confirm();
    const blocked = firstKind === "tag" ? await h.move()
      : await new TagApplyService(h.vault, h.manager).apply(token, h.signal);
    expect(blocked).toEqual({ status: "failure", reason: "busy" });
    expect(h.manager.processFrontMatter).toHaveBeenCalledTimes(firstKind === "tag" ? 1 : 0);
    expect(h.manager.renameFile).toHaveBeenCalledTimes(firstKind === "move" ? 1 : 0);
    gate.resolve(); expect((await first).status).toBe(firstKind === "tag" ? "applied" : "moved");
    if (firstKind === "move") {
      expect(await new TagApplyService(h.vault, h.manager).apply(token, h.signal))
        .toEqual({ status: "failure", reason: "invalid-confirmation" });
    }
    expect((await (firstKind === "tag" ? h.move() : h.tag())).status).toBe(firstKind === "tag" ? "moved" : "applied");
  });
  it("pre-aborted entry leaves confirmation unconsumed even when coordinator busy", async () => {
    const h = harness(), token = h.confirm(), held = acquireVaultMutationLease(h.vault, h.files[0].path)!;
    const abort = new AbortController(); abort.abort(); const service = new TagApplyService(h.vault, h.manager);
    expect(await service.apply(token, abort.signal)).toEqual({ status: "cancelled" }); held.release();
    expect((await service.apply(token, h.signal)).status).toBe("applied");
  });
  it.each(["same-source", "same-target", "target-source", "source-target", "case", "NFC"])(
    "independent Move instances exclude %s with one rename", async conflict => {
      const h = harness(), gate = deferred(); h.manager.renameFile.mockImplementationOnce(() => gate.promise);
      const first = h.move();
      const path = conflict === "same-source" ? "Inbox/A.md" : conflict === "same-target" ? "Other/A.md"
        : conflict === "target-source" ? "Dest/A.md" : conflict === "source-target" ? "Else/A.md"
          : conflict === "case" ? "OTHER/a.MD" : "Other/A.md";
      const other = path === h.files[0].path ? h.files[0] : Object.assign(new FakeFile(path), { stat: { mtime: 1, size: 10 } }) as TFile;
      h.entries.set(path, other);
      const destination = conflict === "source-target" ? "Inbox" : "Dest";
      if (conflict === "NFC") {
        // first target remains reserved independently of a current file lookup.
        gate.resolve(); await first;
        h.files[0].path = "Inbox/é.md"; h.files[0].name = "é.md";
        h.entries.set(h.files[0].path, h.files[0]); other.path = "Other/e\u0301.md"; other.name = "e\u0301.md";
        h.entries.set(other.path, other);
        const unicodeGate = deferred(); h.manager.renameFile.mockImplementationOnce(() => unicodeGate.promise);
        const unicode = h.move(); const calls = h.manager.renameFile.mock.calls.length;
        expect(await h.move(other)).toEqual({ status: "failure", reason: "busy" });
        expect(h.manager.renameFile).toHaveBeenCalledTimes(calls); unicodeGate.resolve(); await unicode; return;
      }
      if (conflict === "source-target") h.entries.set(destination, new FakeFolder(destination));
      const second = new NoteMoveService(h.vault, h.manager).move(new NoteSource(other), [destination], destination, h.signal);
      expect(await second).toEqual({ status: "failure", reason: "busy" }); expect(h.manager.renameFile).toHaveBeenCalledOnce();
      gate.resolve(); await first;
    },
  );
  it.each(["exact", "case", "NFC"])("Move target crosses Tag source with %s path key in both directions", async variant => {
    const name = variant === "NFC" ? "é.md" : "A.md";
    const target = variant === "exact" ? `Dest/${name}` : variant === "case" ? "DEST/a.MD" : "Dest/e\u0301.md";
    for (const firstKind of ["move", "tag"] as const) {
      const h = harness([`Inbox/${name}`, target]), gate = deferred();
      if (firstKind === "move") {
        h.entries.delete(target); h.manager.renameFile.mockImplementationOnce(() => gate.promise);
        const first = h.move(); h.entries.set(target, h.files[1]);
        expect(await h.tag(h.files[1])).toEqual({ status: "failure", reason: "busy" });
        expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); gate.resolve(); await first;
      } else {
        h.manager.processFrontMatter.mockImplementationOnce(async (_file, callback) => { callback({}); await gate.promise; });
        const first = h.tag(h.files[1]);
        expect(await h.move()).toEqual({ status: "failure", reason: "busy" });
        expect(h.manager.renameFile).not.toHaveBeenCalled(); gate.resolve(); await first;
      }
    }
  });
  it("unrelated Tag and Move APIs are concurrently pending", async () => {
    const h = harness(), tagGate = deferred(), moveGate = deferred();
    h.manager.processFrontMatter.mockImplementationOnce(async (_file, callback) => { callback({}); await tagGate.promise; });
    h.manager.renameFile.mockImplementationOnce(() => moveGate.promise);
    const tag = h.tag(), move = h.move(h.files[2]);
    expect(h.manager.processFrontMatter).toHaveBeenCalledOnce(); expect(h.manager.renameFile).toHaveBeenCalledOnce();
    moveGate.resolve(); await move;
    expect(await h.move()).toEqual({ status: "failure", reason: "busy" }); tagGate.resolve(); await tag;
  });
  it.each(["tag", "move"] as const)("%s lease protects exact identity after public rename before API settlement", async kind => {
    const h = harness(), gate = deferred();
    if (kind === "tag") h.manager.processFrontMatter.mockImplementationOnce(async (_file, callback) => { callback({}); await gate.promise; });
    else h.manager.renameFile.mockImplementationOnce(() => gate.promise);
    const first = h[kind](); h.entries.delete(h.files[0].path);
    Object.assign(h.files[0], { path: "Other/Renamed.md", name: "Renamed.md", basename: "Renamed" }); h.entries.set(h.files[0].path, h.files[0]);
    expect(await h.tag()).toEqual({ status: "failure", reason: "busy" });
    expect(await h.move()).toEqual({ status: "failure", reason: "busy" });
    gate.resolve(); await first; expect((await h.move()).status).toBe("moved");
  });
  it.each(["tag", "move"] as const)("%s rejection releases lease for a fresh authorized operation", async kind => {
    const h = harness(), gate = deferred();
    if (kind === "tag") h.manager.processFrontMatter.mockImplementationOnce(() => gate.promise);
    else h.manager.renameFile.mockImplementationOnce(() => gate.promise);
    const first = h[kind]();
    expect(await h.move()).toEqual({ status: "failure", reason: "busy" });
    gate.reject(new Error("Synthetic private exception")); expect(await first).toEqual({ status: "failure", reason: "unexpected" });
    expect((await h.tag()).status).toBe("applied"); expect((await h.move()).status).toBe("moved");
  });
  it.each(["tag", "move"] as const)("%s unexpected source resolution exception releases path lease", async kind => {
    const h = harness(), token = h.confirm();
    if (kind === "tag") h.vault.getFileByPath.mockImplementationOnce(() => { throw new Error("Synthetic exception"); });
    else h.vault.getAbstractFileByPath.mockImplementationOnce(() => { throw new Error("Synthetic exception"); });
    const result = kind === "tag" ? await new TagApplyService(h.vault, h.manager).apply(token, h.signal) : await h.move();
    expect(result).toEqual({ status: "failure", reason: "unexpected" });
    expect((await h.move()).status).toBe("moved");
  });
  it("Tag callback lifetime rejection releases shared lease", async () => {
    const h = harness(), token = h.confirm();
    h.manager.processFrontMatter.mockImplementationOnce(async (_file, callback) => { token.session.dispose(); callback({}); });
    expect(await new TagApplyService(h.vault, h.manager).apply(token, h.signal)).toEqual({ status: "failure", reason: "invalid-confirmation" });
    expect((await h.move()).status).toBe("moved");
  });
  it("Move binds the final resolved identity when the first lookup had no file", async () => {
    const h = harness(), held = acquireVaultMutationLease(h.vault, "Old.md", undefined, h.files[0])!;
    h.vault.getAbstractFileByPath.mockReturnValueOnce(null);
    expect(await h.move()).toEqual({ status: "failure", reason: "busy" });
    expect(h.manager.renameFile).not.toHaveBeenCalled();
    const paths = acquireVaultMutationLease(h.vault, h.files[0].path, "Dest/A.md"); expect(paths).toBeDefined(); paths?.release();
    held.release(); expect((await h.move()).status).toBe("moved");
  });
  it.each(["tag", "move"] as const)("%s abort after acquisition before API releases the lease", async kind => {
    const h = harness(), token = h.confirm(), abort = new AbortController();
    if (kind === "tag") h.vault.getFileByPath.mockImplementationOnce(() => { abort.abort(); return h.files[0]; });
    else h.vault.getAbstractFileByPath.mockImplementationOnce(() => { abort.abort(); return h.files[0]; });
    const result = kind === "tag" ? await new TagApplyService(h.vault, h.manager).apply(token, abort.signal) : await h.move(h.files[0], abort.signal);
    expect(result).toEqual({ status: "cancelled" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
    expect((await h.move()).status).toBe("moved");
  });
  it.each(["tag", "move"] as const)("%s safe validation failure releases lease without mutating a replacement", async kind => {
    const h = harness(), source = new NoteSource(h.files[0]), token = h.confirm();
    h.entries.set(source.path, Object.assign(new FakeFile(source.path), { stat: { mtime: 1, size: 10 } }));
    const result = kind === "tag" ? await new TagApplyService(h.vault, h.manager).apply(token, h.signal)
      : await new NoteMoveService(h.vault, h.manager).move(source, ["Dest"], "Dest", h.signal);
    expect(result).toEqual({ status: "failure", reason: "source-changed" });
    expect(h.manager.processFrontMatter).not.toHaveBeenCalled(); expect(h.manager.renameFile).not.toHaveBeenCalled();
    h.entries.set(source.path, h.files[0]); expect((await h.move()).status).toBe("moved");
  });
});
