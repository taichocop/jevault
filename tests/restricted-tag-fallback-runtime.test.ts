import type { App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RestrictedRuntimeSpike from "./helpers/restricted-tag-fallback-runtime-plugin";
import { TFile as FakeFile } from "./helpers/obsidian-move";

const commands = vi.hoisted(() => new Map<string, () => void>());
const fixture = vi.hoisted(() => {
  const body = "Amazon S3 synthetic memo\r\n日本語 body\r\n";
  const tags = ["AWS", "Programming/AWS", "日本語"];
  const yaml = "tags:\r\n  - AWS\r\n  - Programming/AWS\r\n  - 日本語\r\n";
  const header = `---\r\n${yaml}---\r\n`;
  return { body, tags, yaml, header, candidate: header + body };
});
vi.mock("obsidian", async () => {
  const fake = await import("./helpers/obsidian-move");
  return {
    TFile: fake.TFile, Modal: fake.Modal,
    Plugin: class {
      constructor(readonly app: unknown) {}
      addCommand(command: { id: string; callback: () => void }) { commands.set(command.id, command.callback); }
    },
    Notice: class {},
    getAllTags: () => fixture.tags.map((tag) => `#${tag}`),
    // 固定fixtureのpublic helper出力。parser実装やDesktop契約の証明ではない。
    getFrontMatterInfo: (value: string) => value === fixture.candidate
      ? { exists: true, frontmatter: fixture.yaml, from: 5, to: fixture.header.length - 5, contentStart: fixture.header.length }
      : { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 },
    parseYaml: () => ({ tags: [...fixture.tags] }),
    stringifyYaml: () => fixture.yaml,
  };
});
beforeEach(() => commands.clear());

function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function harness(name = "Jevault-Issue69-Synthetic") {
  const original = Object.assign(new FakeFile("Synthetic/A.md"), { stat: { ctime: 1, mtime: 2, size: 3 } }) as TFile;
  const catalog = new FakeFile("Synthetic/Catalog.md") as TFile;
  const first = deferred(), second = deferred(), written = deferred();
  let current = fixture.body, reads = 0;
  const vault = {
    getName: () => name,
    getFileByPath: (path: string) => path === original.path ? original : path === catalog.path ? catalog : null,
    read: vi.fn((file: TFile) => {
      expect(file).toBe(original);
      reads++;
      return reads === 1 ? first.promise : reads === 2 ? second.promise : Promise.resolve(current);
    }),
    process: vi.fn(async (file: TFile, transform: (value: string) => string) => {
      expect(file).toBe(original);
      current = transform(current);
      written.resolve(current);
      return current;
    }),
  };
  const metadataCache = { getFileCache: vi.fn((file: TFile) => { expect(file).toBe(catalog); return {}; }) };
  const plugin = new RestrictedRuntimeSpike({ vault, metadataCache } as unknown as App, {
    id: "synthetic", name: "Synthetic", version: "0.0.0", minAppVersion: "1.5.7", description: "Fixture", author: "Fixture",
  });
  await plugin.onload();
  return { vault, metadataCache, plugin, first, second, written, body: () => current,
    run: () => commands.get("run")!(), close: () => commands.get("close")!() };
}

describe("isolated runtime helper command ownership (fake app)", () => {
  it.each(["close", "unload"])("two pending Runs followed by %s cannot leave an uncancelled writer", async (kind) => {
    const h = await harness();
    expect(h.vault.read).not.toHaveBeenCalled();
    h.run(); h.run();
    expect(h.vault.read).toHaveBeenCalledTimes(1);
    if (kind === "close") h.close(); else h.plugin.onunload();
    h.first.resolve(fixture.body);
    await h.first.promise;
    expect(h.metadataCache.getFileCache).not.toHaveBeenCalled();
    expect(h.vault.process).not.toHaveBeenCalled();
  });
  it("old completion cannot take ownership while the new Run remains live", async () => {
    const h = await harness(); h.run(); h.close(); h.run();
    expect(h.vault.read).toHaveBeenCalledTimes(2);
    h.first.resolve(fixture.body);
    await h.first.promise;
    expect(h.metadataCache.getFileCache).not.toHaveBeenCalled();
    expect(h.vault.process).not.toHaveBeenCalled();
    // 新Runをliveのまま完了させ、同じfakeが実際にwriterへ到達することも確認する。
    h.second.resolve(fixture.body);
    expect(await h.written.promise).toBe(fixture.candidate);
    expect(h.metadataCache.getFileCache).toHaveBeenCalledOnce();
    expect(h.vault.read).toHaveBeenCalledTimes(3);
    expect(h.vault.process).toHaveBeenCalledOnce();
    expect(h.body()).toBe(fixture.candidate);
    h.close();
  });
  it("refuses a different Vault before any body read", async () => {
    const h = await harness("Different Vault"); h.run();
    expect(h.vault.read).not.toHaveBeenCalled(); expect(h.vault.process).not.toHaveBeenCalled();
  });
});
