import type { App, PluginManifest } from "obsidian";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ notices: [] as string[] }));
vi.mock("obsidian", async () => {
  const base = await import("./helpers/obsidian-move");
  class Plugin {
    commands: { id: string }[] = [];
    registered: unknown[] = [];
    constructor(public app: App) {}
    addCommand(command: { id: string }) { this.commands.push(command); }
    registerEvent(ref: unknown) { this.registered.push(ref); }
  }
  class Notice {
    constructor(message: string) { boundary.notices.push(message); }
    hide = vi.fn();
  }
  return { ...base, Plugin, Notice };
});
import * as obsidian from "obsidian";
import Harness from "./helpers/organization-apply-ui-runtime-plugin";

function fixture(mode = "valid") {
  boundary.notices.length = 0;
  const forbidden = vi.fn(() => { throw new Error("Synthetic forbidden operation"); });
  const app = {
    vault: {
      getName: vi.fn(() => { if (mode === "guard") throw new Error("private synthetic detail");
        return mode === "name" ? "Synthetic111" : "Jevault-111-Synthetic-fixture"; }),
      getFileByPath: vi.fn(() => mode === "marker" ? null : {}),
      adapter: { write: forbidden }, read: forbidden, cachedRead: forbidden, getAllFolders: forbidden,
    },
    workspace: { on: vi.fn(() => { if (mode === "file-menu") throw new Error("private synthetic detail"); return {}; }) },
    fileManager: { processFrontMatter: forbidden, renameFile: forbidden },
    get metadataCache() { if (mode === "controller") throw new Error("private synthetic detail"); return {}; },
    secretStorage: { getSecret: forbidden },
  } as unknown as App;
  const plugin = new Harness(app, {} as PluginManifest);
  if (mode === "original-command" || mode === "retry-command") {
    const add = plugin.addCommand.bind(plugin);
    vi.spyOn(plugin, "addCommand").mockImplementation(command => {
      if (command.id === (mode === "original-command" ? "verify-ui" : "verify-ui-diagnostic")) throw new Error("private synthetic detail");
      return add(command);
    });
  }
  return { app, plugin, forbidden };
}
function commands(plugin: Harness) { return (Reflect.get(plugin, "commands") as { id: string }[]).map(command => command.id); }

describe("isolated UI harness startup diagnostic", () => {
  it("registers both explicit commands only after the original synthetic guard", () => {
    const h = fixture(); h.plugin.onload();
    expect(commands(h.plugin)).toEqual(["verify-ui", "verify-ui-diagnostic"]);
    expect(boundary.notices).toEqual(["#111 verification startup: ready"]);
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each([["name", "vault-rejected"], ["marker", "marker-unavailable"], ["guard", "failed-guard"],
    ["controller", "failed-controller"], ["file-menu", "failed-file-menu"],
    ["original-command", "failed-original-command"], ["retry-command", "failed-retry-command"]])(
    "%s startup emits only finite status without raw exceptions or mutation", (mode, status) => {
      const h = fixture(mode); expect(() => h.plugin.onload()).not.toThrow();
      expect(Reflect.get(h.plugin, "startupStatus")).toBe(status);
      expect(boundary.notices).toEqual([`#111 verification startup: ${status}`]);
      expect(h.forbidden).not.toHaveBeenCalled();
      if (mode !== "retry-command") expect(commands(h.plugin)).toEqual([]);
    },
  );
  it("a marker absent at onload is not silently accepted just because it appears later", () => {
    const h = fixture("marker"); h.plugin.onload();
    vi.mocked(h.app.vault.getFileByPath).mockReturnValue({} as never);
    expect(commands(h.plugin)).toEqual([]); expect(Reflect.get(h.plugin, "startupStatus")).toBe("marker-unavailable");
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("CJS footer exports a constructible Plugin subclass and valid startup registers both commands", () => {
    const code = buildSync({ entryPoints: ["tests/helpers/organization-apply-ui-runtime-plugin.ts"], bundle: true,
      platform: "node", format: "cjs", external: ["obsidian"], write: false,
      footer: { js: "module.exports = module.exports.default;" } }).outputFiles[0].text;
    const module = { exports: {} };
    runInNewContext(code, { module, exports: module.exports, AbortController,
      require: (name: string) => { if (name !== "obsidian") throw new Error("Unexpected synthetic import"); return obsidian; } });
    const Exported = module.exports as typeof Harness;
    expect(typeof Exported).toBe("function"); expect(Object.getPrototypeOf(Exported.prototype)).toBe(obsidian.Plugin.prototype);
    const h = fixture(), plugin = new Exported(h.app, {} as PluginManifest); plugin.onload();
    expect(commands(plugin)).toEqual(["verify-ui", "verify-ui-diagnostic"]); expect(h.forbidden).not.toHaveBeenCalled();
  });
});
