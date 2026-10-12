import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const workspace = "/workspaces/jevault/";
const home = "/home/node";
const node = "/usr/local/bin/node";

function source(name: string): string {
  return readFileSync(new URL(`../.devcontainer/${name}`, import.meta.url), "utf8")
    .replace(/^import .+;\n/gm, "")
    .replaceAll("import.meta.url", JSON.stringify(`file://${workspace}.devcontainer/${name}`));
}

function context(output: string[]) {
  return {
    URL, join, fileURLToPath, homedir: () => home,
    process: { argv: [node, "probe.mjs"], platform: "linux", getuid: () => 1000, execPath: node, exitCode: 0 },
    console: { log: (text: string) => output.push(text), error: (text: string) => output.push(text) },
  };
}

function filesystemProbe(mode: "protected" | "startup-failure" | "outside-writable", managed = false) {
  const output: string[] = [];
  const files = new Map<string, string>();
  let sequence = 0;
  const parent = context(output);
  if (managed) parent.process.argv.push("--managed");
  const writeFileSync = (file: string, content: string) => files.set(file, content);
  const readFileSync = (file: string) => files.get(file);
  const spawnSync = (command: string, args: string[]) => {
    const sandbox = command === "codex" || command === "sh";
    if (sandbox && mode === "startup-failure") return { status: 1, stdout: "", stderr: "namespace creation failed" };
    const index = args.indexOf("-e");
    const child = { argv: [node, ...args.slice(index + 2)], exitCode: 0 };
    let stdout = "";
    const fs = {
      writeSync: (fd: number, text: string) => { expect(fd).toBe(1); stdout += text; },
      writeFileSync: (file: string, content: string) => {
        if (sandbox && file.startsWith(home) && mode !== "outside-writable") {
          throw Object.assign(new Error("synthetic read-only filesystem"), { code: "EROFS" });
        }
        writeFileSync(file, content);
      },
    };
    // 子のconsole出力だけが欠落しても、実際のwriteとmarkerの検査を省略させない。
    runInNewContext(args[index + 1], { require: () => fs, process: child, console: { log: () => {} } });
    return { status: child.exitCode, stdout, stderr: "" };
  };
  runInNewContext(source("check-sandbox.mjs"), {
    ...parent, spawnSync, writeFileSync, readFileSync,
    mkdtempSync: (prefix: string) => `${prefix}${++sequence}`,
    rmSync: (directory: string) => { for (const file of files.keys()) if (file.startsWith(`${directory}/`)) files.delete(file); },
  });
  return { output, status: parent.process.exitCode, files };
}

async function networkProbe(mode: "protected" | "startup-failure" | "network-writable" | "timeout" | "proxy-unreachable" | "proxy-writable", managed = false) {
  const output: string[] = [];
  const parent = context(output);
  const server = Object.assign(new EventEmitter(), {
    listen: (_port: number, _host: string, done: () => void) => done(),
    address: () => ({ port: 12345 }), close: (done: () => void) => done(),
  });
  const spawn = (command: string, args: string[]) => {
    const stdout = new EventEmitter();
    const child = Object.assign(new EventEmitter(), { stdout, kill: () => {} });
    queueMicrotask(() => {
      if ((command === "codex" || command === "sh") && mode === "startup-failure") { child.emit("close", 1, null); return; }
      const state = { exitCode: 0, env: { HTTP_PROXY: "http://127.0.0.1:3128" } };
      const socket = Object.assign(new EventEmitter(), { setEncoding: () => {}, destroy: () => {}, write: () => {}, setTimeout: (_ms: number, callback: () => void) => { timeout = callback; } });
      let timeout = () => {};
      const script = args[args.indexOf("-e") + 1];
      const proxy = managed && script.includes("const proxy = true");
      const allowed = args.includes("--synthetic-loopback-control");
      const denied = managed ? command === "sh" && !allowed : args.includes("sandbox_workspace_write.network_access=false");
      const fs = { writeSync: (fd: number, text: string) => { expect(fd).toBe(1); stdout.emit("data", text); } };
      runInNewContext(args[args.indexOf("-e") + 1], {
        URL, process: state, console: { log: () => {} },
        require: (name: string) => name === "node:fs" ? fs : { connect: () => socket },
      });
      if (denied && mode === "timeout") timeout();
      else if (proxy && denied && mode !== "proxy-writable" && mode !== "proxy-unreachable") {
        socket.emit("data", "HTTP/1.1 403 Forbidden\r\nx-proxy-error: blocked-by-allowlist\r\n\r\n"); socket.emit("end");
      } else if ((denied && !proxy && mode !== "network-writable") || (denied && proxy && mode === "proxy-unreachable")) socket.emit("error", { code: "EPERM" });
      else { socket.emit("data", managed ? "HTTP/1.1 200 OK\r\n\r\nJEVAULT_SYNTHETIC_HTTP\n" : "JEVAULT_SYNTHETIC_ENDPOINT\n"); socket.emit("end"); }
      child.emit("close", state.exitCode, null);
    });
    return child;
  };
  // 実socketもCodexも起動せず、合成endpointの制御と子の結果伝播を検証する。
  await runInNewContext(`(async () => { ${source(managed ? "check-managed-network.mjs" : "check-network.mjs")} })()`, {
    ...parent, spawn, createServer: () => server, setTimeout, clearTimeout,
  });
  return { output, status: parent.process.exitCode };
}

describe("synthetic sandbox probe acceptance", () => {
  it("checks writes, denial and unchanged content even when child console output is lost", () => {
    const result = filesystemProbe("protected");
    expect(result.status).toBe(0);
    expect(result.output.filter((line) => line.startsWith("PASS "))).toHaveLength(5);
    expect(result.files.size).toBe(0);
  });

  it("checks the same filesystem boundaries through the managed startup wrapper", () => {
    const result = filesystemProbe("protected", true);
    expect(result.status).toBe(0);
    expect(result.output.filter((line) => line.startsWith("PASS "))).toHaveLength(5);
    expect(result.files.size).toBe(0);
  });

  it("does not count a child initialization failure as filesystem protection", () => {
    const result = filesystemProbe("startup-failure");
    expect(result.status).toBe(1);
    expect(result.output).toContain("NOT RUN: sandbox workspace write, sandbox outside write denial, outside content unchanged");
    expect(result.files.size).toBe(0);
  });

  it("rejects an outside write that unexpectedly succeeds", () => {
    const result = filesystemProbe("outside-writable");
    expect(result.status).toBe(1);
    expect(result.output.some((line) => line.startsWith("FAIL sandbox outside write denial"))).toBe(true);
    expect(result.output).not.toContain("PASS outside content unchanged");
  });

  it("requires both network controls and a denied initialized child without real networking", async () => {
    const result = await networkProbe("protected");
    expect(result.status).toBe(0);
    expect(result.output.filter((line) => line.startsWith("PASS "))).toHaveLength(4);
  });

  it.each(["startup-failure", "network-writable", "timeout"] as const)("rejects network %s rather than accepting isolation", async (mode) => {
    const result = await networkProbe(mode);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain("PASS sandbox network denial");
    expect(result.output.some((line) => line.startsWith("FAIL "))).toBe(true);
  });
  it("requires a proxy positive control and an explicit policy denial", async () => {
    const result = await networkProbe("protected", true);
    expect(result.status).toBe(0);
    expect(result.output.filter((line) => line.startsWith("PASS "))).toHaveLength(5);
  });

  it.each(["startup-failure", "network-writable", "timeout", "proxy-unreachable", "proxy-writable"] as const)("rejects managed network %s", async (mode) => {
    const result = await networkProbe(mode, true);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain("PASS managed proxy deny-all");
  });
});
