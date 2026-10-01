import type { FrontMatterInfo, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { NoteSource } from "../src/note-source";
import { captureEvaluationProvenance } from "../src/tags/evaluation-provenance";
import { TFile as FakeFile } from "./helpers/obsidian-move";
import { RestrictedFallbackSpike, restrictedAbsence, type RestrictedHelpers } from "./helpers/restricted-tag-fallback-spike";

vi.mock("obsidian", async () => ({ TFile: (await import("./helpers/obsidian-move")).TFile }));

const absent: FrontMatterInfo = { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 };
const allowed = ["#AWS", "#aws", "#cloud", "#Programming/AWS", "#programming/aws", "#日本語", "#é", "#e\u0301"];
const makeFile = (path = "Synthetic/A.md") => Object.assign(new FakeFile(path), { stat: { ctime: 1, mtime: 2, size: 3 } }) as TFile;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function harness(body = "Amazon S3 memo", authorized: readonly string[] = allowed) {
  const original = makeFile(), other = makeFile("Synthetic/B.md"), source = new NoteSource(original);
  const files = new Map([[original.path, original], [other.path, other]]);
  let current = body, mutationCount = 0;
  let beforeCallback = () => {};
  let afterCallback = () => {};
  const gate = deferred(); gate.resolve();
  let processGate = gate.promise;
  const forbidden = vi.fn(() => { throw new Error("Forbidden boundary"); });
  const vault = {
    getFileByPath: vi.fn((path: string) => files.get(path) ?? null),
    read: vi.fn(async (file: TFile) => { expect(file).toBe(original); return current; }),
    process: vi.fn(async (file: TFile, callback: (value: string) => string) => {
      expect(file).toBe(original);
      await processGate;
      beforeCallback();
      const candidate = callback(current);
      afterCallback();
      current = candidate; mutationCount++;
      return candidate;
    }),
    cachedRead: forbidden, modify: forbidden, rename: forbidden, delete: forbidden,
    create: forbidden, createFolder: forbidden, processFrontMatter: forbidden,
    getApiKey: forbidden, evaluate: forbidden, getActiveFile: forbidden, telemetry: forbidden,
  };
  // public helperはNodeに実装がない。fixtureの出力を固定し、YAML/parserを自作しない。
  const generated = new Map<string, FrontMatterInfo>();
  const parsed = new Map<string, unknown>();
  const helpers: RestrictedHelpers = {
    info: vi.fn((value) => generated.get(value) ?? { ...absent }),
    stringify: vi.fn(({ tags }: { tags: string[] }) => {
      const eol = body.indexOf("\n") > 0 && body[body.indexOf("\n") - 1] === "\r" ? "\r\n" : "\n";
      const yaml = `tags:\n${tags.map((name) => `  - ${name}\n`).join("")}`;
      const serialized = yaml.replace(/\n/g, eol);
      const header = `---${eol}${serialized}---${eol}`;
      const info = { exists: true, frontmatter: serialized, from: 4, to: header.length - 4, contentStart: header.length };
      generated.set(header + body, info); parsed.set(serialized, { tags: [...tags] });
      return yaml;
    }),
    parse: vi.fn((yaml) => parsed.get(yaml)),
  };
  const provenance = await captureEvaluationProvenance(source, body);
  const newSpike = (names: readonly string[] = authorized, proof = provenance) => new RestrictedFallbackSpike(vault, source, proof, names, helpers);
  const spike = newSpike(), controller = new AbortController();
  const apply = (tags: readonly string[] = ["#AWS"]) => spike.apply(tags, controller.signal);
  return { original, other, source, files, vault, helpers, forbidden, spike, newSpike, apply, controller,
    mutations: () => mutationCount, body: () => current,
    setBody: (value: string) => { current = value; },
    before: (fn: () => void) => { beforeCallback = fn; },
    after: (fn: () => void) => { afterCallback = fn; },
    pause: (promise: Promise<void>) => { processGate = promise; },
  };
}

describe("Issue #69 restricted whole-content candidate (fake process, not Desktop proof)", () => {
  it("Case 1: exact matching no-frontmatter/no-hash note produces one candidate", async () => {
    const h = await harness();
    expect(await h.apply()).toEqual({ status: "written", addedTags: ["#AWS"] });
    expect(h.body()).toBe("---\ntags:\n  - AWS\n---\nAmazon S3 memo");
    expect(h.mutations()).toBe(1);
    expect(h.vault.process).toHaveBeenCalledOnce();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(["different body", "Amazon S3 memo #aws", "---\ntags: [aws]\n---\nAmazon S3 memo"])(
    "Cases 2–4: callback content change is rejected (%s)", async (value) => {
      const h = await harness(); h.before(() => h.setBody(value));
      expect(await h.apply()).toEqual({ status: "failure", reason: "freshness-unverified" });
      expect(h.mutations()).toBe(0); expect(h.body()).toBe(value);
      expect(h.helpers.stringify).not.toHaveBeenCalled();
    });
  it.each(["rename", "move", "delete", "replacement"])("Case 5: rejects %s before process and inside callback", async (kind) => {
    for (const atCallback of [false, true]) {
      const h = await harness();
      const change = () => {
        if (kind === "rename") h.original.path = "Synthetic/Renamed.md";
        if (kind === "move") h.original.path = "Other/A.md";
        if (kind === "delete") h.files.delete(h.source.path);
        if (kind === "replacement") h.files.set(h.source.path, makeFile(h.source.path));
      };
      if (atCallback) h.before(change); else change();
      expect(await h.apply()).toEqual({ status: "failure", reason: "source-changed" });
      expect(h.mutations()).toBe(0);
      expect(h.vault.process).toHaveBeenCalledTimes(atCallback ? 1 : 0);
    }
  });
  it("Case 6: an active-note switch never consults the active file or retargets", async () => {
    const h = await harness();
    h.before(() => { h.files.set(h.other.path, h.other); });
    await h.apply();
    expect(h.vault.read).toHaveBeenCalledExactlyOnceWith(h.original);
    expect(h.vault.process.mock.calls[0][0]).toBe(h.original);
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("Cases 7–8: one transform preserves selected order/case/hierarchy/Japanese/NFD", async () => {
    const h = await harness();
    const selected = ["#Programming/AWS", "#日本語", "#AWS", "#é", "#e\u0301"];
    expect(await h.apply(selected)).toEqual({ status: "written", addedTags: selected });
    expect(h.body()).toBe("---\ntags:\n  - Programming/AWS\n  - 日本語\n  - AWS\n  - é\n  - e\u0301\n---\nAmazon S3 memo");
    expect(h.mutations()).toBe(1);
  });
  it.each(["callback", "operation", "after-candidate"])("Case 9: %s failure is sanitized with no false written result", async (where) => {
    const h = await harness();
    const fail = () => { throw new Error("Synthetic raw body and absolute path error"); };
    if (where === "callback") vi.mocked(h.helpers.stringify).mockImplementation(fail);
    if (where === "operation") h.vault.process.mockImplementation(async () => { fail(); return ""; });
    if (where === "after-candidate") h.after(fail);
    expect(await h.apply()).toEqual({ status: "failure", reason: "unexpected" });
    expect(h.mutations()).toBe(0); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("Case 10: different instances in the same Vault share path/file locks", async () => {
    const h = await harness(), gate = deferred(); h.pause(gate.promise);
    const first = h.apply(); await vi.waitFor(() => expect(h.vault.process).toHaveBeenCalledOnce());
    expect(await h.newSpike().apply(["#cloud"], h.controller.signal)).toEqual({ status: "failure", reason: "busy" });
    gate.resolve(); expect((await first).status).toBe("written");
    expect(h.mutations()).toBe(1);
    expect((await h.apply()).status).toBe("failure");
    expect((await h.newSpike().apply(["#cloud"], h.controller.signal)).status).toBe("failure");
    expect(h.mutations()).toBe(1);
  });
  it.each([["#aws", "#AWS", "#cloud"], ["#AWS", "#aws", "#cloud"], ["#Programming/AWS", "#programming/aws"]])(
    "keeps #66 first selected semantic representation (%s)", async (...selected) => {
      const h = await harness(); const expected = selected.length === 3 ? [selected[0], "#cloud"] : [selected[0]];
      expect(await h.apply(selected)).toEqual({ status: "written", addedTags: expected });
    });
  it.each([["#aws", "#AWS"], ["#AWS", "#aws"]])("exact authorization precedes semantic filtering (%s)", async (...selected) => {
    const h = await harness("Amazon S3 memo", ["#aws"]);
    expect(await h.apply(selected)).toEqual({ status: "failure", reason: "invalid-selection" });
    expect(h.vault.read).not.toHaveBeenCalled(); expect(h.mutations()).toBe(0);
  });
  it("missing provenance and mismatching read cannot authorize process", async () => {
    const h = await harness();
    const noProof = new RestrictedFallbackSpike(h.vault, h.source, undefined, allowed, h.helpers);
    expect((await noProof.apply(["#AWS"], h.controller.signal)).status).toBe("failure");
    expect(h.vault.read).not.toHaveBeenCalled();
    h.setBody("EDIT"); expect((await h.apply()).status).toBe("failure");
    expect(h.vault.process).not.toHaveBeenCalled();
  });
  it.each(["abort", "dispose"])("%s before process performs zero reads/transforms", async (kind) => {
    const h = await harness(); if (kind === "abort") h.controller.abort(); else h.spike.dispose();
    expect(await h.apply()).toEqual({ status: "cancelled" });
    expect(h.vault.read).not.toHaveBeenCalled(); expect(h.vault.process).not.toHaveBeenCalled();
  });
  it.each(["abort", "dispose"])("%s during read performs zero process calls", async (kind) => {
    const h = await harness(), gate = deferred();
    h.vault.read.mockImplementation(async () => { await gate.promise; return "Amazon S3 memo"; });
    const pending = h.apply(); if (kind === "abort") h.controller.abort(); else h.spike.dispose();
    gate.resolve(); expect(await pending).toEqual({ status: "cancelled" });
    expect(h.vault.process).not.toHaveBeenCalled();
  });
  it.each(["abort", "dispose"])("%s before callback returns no candidate", async (kind) => {
    const h = await harness(); h.before(() => { if (kind === "abort") h.controller.abort(); else h.spike.dispose(); });
    expect(await h.apply()).toEqual({ status: "cancelled" }); expect(h.mutations()).toBe(0);
  });
  it("cancel after returning the candidate does not roll back or misreport a resolved write", async () => {
    const h = await harness(); h.after(() => h.controller.abort());
    expect((await h.apply()).status).toBe("written"); expect(h.mutations()).toBe(1);
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("helper side effects are rechecked before returning the candidate", async () => {
    const h = await harness(); const stringify = vi.mocked(h.helpers.stringify).getMockImplementation()!;
    vi.mocked(h.helpers.stringify).mockImplementation((value) => { const result = stringify(value); h.controller.abort(); return result; });
    expect(await h.apply()).toEqual({ status: "cancelled" }); expect(h.mutations()).toBe(0);
  });
  it.each(["plain", " leading\ncontent", "first\r\nsecond\r\n", "first\nsecond", "first\r\nsecond\nthird", "", "日本語🙂e\u0301"])(
    "preserves every original body code unit and final newline (%s)", async (body) => {
      const h = await harness(body); expect((await h.apply()).status).toBe("written");
      const eol = body.startsWith("first\r\n") ? "\r\n" : "\n";
      expect(h.body()).toBe(`---${eol}tags:${eol}  - AWS${eol}---${eol}${body}`);
    });
  it("round-trip representation mismatch and unexpected helper output fail closed", async () => {
    const h = await harness(); vi.mocked(h.helpers.parse).mockReturnValue({ tags: ["aws"] });
    expect((await h.apply()).status).toBe("failure"); expect(h.mutations()).toBe(0);
  });
  it.each(["Synthetic #aws", "---\ntags: [aws]\n---\nSynthetic"])("callback applies absence guard to exact matching content (%s)", async (body) => {
    const h = await harness(body);
    expect(await h.apply()).toEqual({ status: "failure", reason: "content-not-eligible" });
    expect(h.mutations()).toBe(0); expect(h.helpers.stringify).not.toHaveBeenCalled();
  });
  it("in-memory retention is unavailable after disposal; no body in result", async () => {
    const h = await harness(); const result = await h.apply(); h.spike.dispose();
    expect(JSON.stringify(result)).not.toContain("Amazon");
    expect(await h.apply()).toEqual({ status: "cancelled" });
    expect(h.forbidden).not.toHaveBeenCalled();
  });
});

export const guardCorpus = [
  ["plain prose", "Plain synthetic prose", true],
  ["heading", "# Heading", false],
  ["URL fragment", "https://example.com/#section", false],
  ["inline code", "`#example`", false],
  ["fenced code", "```\n#example\n```", false],
  ["escaped hash", "\\#example", false],
  ["actual inline tag", "Synthetic #aws", false],
  ["ordinary hash", "ordinary # character", false],
  ["long note", "Synthetic prose\n".repeat(10000), true],
  ["frontmatter", "---\ntags: [aws]\n---\nSynthetic", false],
] as const;

describe("conservative corpus and no-frontmatter contract (helper output is a fixture)", () => {
  it.each(guardCorpus)("%s → eligible=%s", (_name, current, expected) => {
    expect(restrictedAbsence(current, { info: () => absent })).toBe(expected);
  });
  it.each([
    ["normal", "---\ntags: [aws]\n---\nbody"], ["empty", "---\n---\nbody"],
    ["malformed delimiter", "---\ntags: [aws]\nbody"], ["BOM", "\uFEFFbody"],
    ["BOM frontmatter", "\uFEFF---\ntags: [aws]\n---\nbody"],
    ["leading blank delimiter", "\n---\ntags: [aws]\n---\nbody"], ["bare CR", "body\rmore"],
  ])("rejects ambiguous/existing %s even if the helper says absent", (_name, current) => {
    expect(restrictedAbsence(current, { info: () => absent })).toBe(false);
  });
  it.each([
    { ...absent, exists: true }, { ...absent, exists: undefined }, { ...absent, frontmatter: "tags: [aws]" },
    { ...absent, contentStart: 1 }, { ...absent, from: NaN }, { ...absent, to: -1 },
  ])("unexpected helper return fails closed", (info) => {
    expect(restrictedAbsence("body", { info: () => info as FrontMatterInfo })).toBe(false);
  });
  it("helper error fails closed", () => {
    expect(restrictedAbsence("body", { info: () => { throw new Error("Synthetic helper error"); } })).toBe(false);
  });
});
