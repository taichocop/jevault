import type { App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RestrictedRuntimeSpike from "./helpers/restricted-tag-fallback-runtime-plugin";
import { TFile as FakeFile } from "./helpers/obsidian-move";

const commands = vi.hoisted(() => new Map<string, () => void>());
vi.mock("obsidian", async () => ({
  TFile: (await import("./helpers/obsidian-move")).TFile,
  Plugin: class {
    constructor(readonly app: unknown) {}
    addCommand(command: { id: string; callback: () => void }) { commands.set(command.id, command.callback); }
  },
  Notice: class {}, Modal: class {},
  getAllTags: () => [], getFrontMatterInfo: vi.fn(), parseYaml: vi.fn(), stringifyYaml: vi.fn(),
}));
beforeEach(() => commands.clear());

async function harness(name = "Jevault-Issue69-Synthetic") {
  const original = Object.assign(new FakeFile("Synthetic/A.md"), { stat: { ctime: 1, mtime: 2, size: 3 } }) as TFile;
  let resolve!: (value: string) => void;
  const pending = new Promise<string>((yes) => { resolve = yes; });
  const vault = {
    getName: () => name, getFileByPath: () => original,
    read: vi.fn(() => pending), process: vi.fn(),
  };
  const plugin = new RestrictedRuntimeSpike({ vault } as unknown as App, {
    id: "synthetic", name: "Synthetic", version: "0.0.0", minAppVersion: "1.5.7", description: "Fixture", author: "Fixture",
  });
  await plugin.onload();
  return { vault, plugin, resolve, pending, run: () => commands.get("run")!(), close: () => commands.get("close")!() };
}

describe("isolated runtime helper command ownership (fake app)", () => {
  it.each(["close", "unload"])("two pending Runs followed by %s cannot leave an uncancelled writer", async (kind) => {
    const h = await harness();
    expect(h.vault.read).not.toHaveBeenCalled();
    h.run(); h.run();
    expect(h.vault.read).toHaveBeenCalledTimes(1);
    if (kind === "close") h.close(); else h.plugin.onunload();
    h.resolve("Amazon S3 synthetic memo\r\n日本語 body\r\n");
    await h.pending; await Promise.resolve();
    expect(h.vault.process).not.toHaveBeenCalled();
  });
  it("old completion cannot take ownership of a new Run after Close", async () => {
    const h = await harness(); h.run(); h.close(); h.run(); h.close();
    expect(h.vault.read).toHaveBeenCalledTimes(2);
    h.resolve("Amazon S3 synthetic memo\r\n日本語 body\r\n");
    await h.pending; await Promise.resolve();
    expect(h.vault.process).not.toHaveBeenCalled();
  });
  it("refuses a different Vault before any body read", async () => {
    const h = await harness("Different Vault"); h.run();
    expect(h.vault.read).not.toHaveBeenCalled(); expect(h.vault.process).not.toHaveBeenCalled();
  });
});
