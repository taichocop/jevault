import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../.devcontainer/devcontainer.json", import.meta.url), "utf8"));
const dockerfile = readFileSync(new URL("../.devcontainer/Dockerfile", import.meta.url), "utf8");
const sandboxConfig = JSON.parse(readFileSync(new URL("../.devcontainer/sandbox/devcontainer.json", import.meta.url), "utf8"));
const pinnedNode22BaseImage = /^FROM node:22\.\d+\.\d+-bookworm-slim@sha256:[a-f0-9]{64}$/;

function hasSinglePinnedNode22BaseImage(text: string): boolean {
  // 後続stageのdigestで未固定ベースを隠せないよう、単一stageを必須にする。
  const fromInstructions = text.split(/\r?\n/).filter((line) => /^\s*FROM(?:\s|$)/i.test(line));
  return fromInstructions.length === 1 && pinnedNode22BaseImage.test(fromInstructions[0].trim());
}

describe("Dev Container boundaries", () => {
  it.each([
    { name: "accepts a Node 22 image with a 64-character hexadecimal digest", from: `FROM node:22.23.3-bookworm-slim@sha256:${"a".repeat(64)}`, accepted: true },
    { name: "rejects a missing digest", from: "FROM node:22.23.3-bookworm-slim", accepted: false },
    { name: "rejects a short digest", from: `FROM node:22.23.3-bookworm-slim@sha256:${"a".repeat(63)}`, accepted: false },
    { name: "rejects non-hexadecimal digest characters", from: `FROM node:22.23.3-bookworm-slim@sha256:${"a".repeat(63)}g`, accepted: false },
    { name: "rejects an unpinned FROM followed by a pinned FROM", from: `FROM node:22.23.3-bookworm-slim\nFROM node:22.23.3-bookworm-slim@sha256:${"a".repeat(64)}`, accepted: false },
    { name: "rejects two pinned FROM instructions", from: `FROM node:22.23.3-bookworm-slim@sha256:${"a".repeat(64)}\nFROM node:22.23.3-bookworm-slim@sha256:${"b".repeat(64)}`, accepted: false },
  ])("$name", ({ from, accepted }) => {
    expect(hasSinglePinnedNode22BaseImage(from)).toBe(accepted);
  });

  it("binds only the selected clone and isolates Linux dependencies and Codex state", () => {
    expect(config.workspaceMount).toBe("source=${localWorkspaceFolder},target=/workspaces/jevault,type=bind");
    expect(config.workspaceFolder).toBe("/workspaces/jevault");
    expect(config.mounts).toEqual([
      "source=jevault-${devcontainerId}-node-modules,target=/workspaces/node_modules,type=volume",
      "source=jevault-${devcontainerId}-codex,target=/home/node/.codex,type=volume",
    ]);
    expect(config.build).toEqual({ dockerfile: "Dockerfile", context: "." });
    expect(readFileSync(new URL("../.devcontainer/.dockerignore", import.meta.url), "utf8")).toBe("*\n!Dockerfile\n!.dockerignore\n");
    expect(dockerfile).not.toMatch(/^\s*(COPY|ADD|VOLUME)\b/m);
  });

  it("uses a non-root user without adding privileges, credentials or safety overrides", () => {
    expect(config.containerUser).toBe("node");
    expect(config.remoteUser).toBe("node");
    expect(config.updateRemoteUserUID).toBe(false);
    expect(config.userEnvProbe).toBe("none");
    for (const key of ["runArgs", "privileged", "capAdd", "securityOpt", "containerEnv", "remoteEnv", "features", "customizations"]) {
      expect(config).not.toHaveProperty(key);
    }
    expect(dockerfile.trim().split("\n").slice(-2)).toEqual(["USER node", "WORKDIR /workspaces/jevault"]);
    expect(dockerfile).toContain("git bubblewrap");
    expect(dockerfile).not.toMatch(/danger-full-access|bypass-approvals|sudo|TOKEN|API_KEY|auth\.json/);
  });

  it("validates mounts without automatically reinstalling dependencies or changing engine support", () => {
    expect(config.postCreateCommand).toBe("node .devcontainer/prepare-workspace.mjs");
    expect(config.postStartCommand).toBe(config.postCreateCommand);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.engines.node).toBe("^20.19.0 || ^22.13.0 || >=24.0.0");
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("@openai/codex");
    expect(hasSinglePinnedNode22BaseImage(dockerfile)).toBe(true);
    expect(dockerfile).toMatch(/npm install --global @openai\/codex@\d+\.\d+\.\d+\s/);
  });

  it("keeps the security exception opt-in and reuses the unchanged non-setuid image", () => {
    expect(sandboxConfig.build).toEqual({ dockerfile: "../Dockerfile", context: ".." });
    expect(new URL("../.devcontainer/sandbox/" + sandboxConfig.build.dockerfile, import.meta.url).pathname).toBe(new URL("../.devcontainer/" + config.build.dockerfile, import.meta.url).pathname);
    expect(sandboxConfig.runArgs).toEqual([
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges=true",
      "--security-opt=seccomp=unconfined",
    ]);
    expect(dockerfile).not.toMatch(/chmod\s+[^\n]*(u\+s|[2467][0-7]{3})|setcap|SYS_ADMIN|NET_ADMIN|NET_RAW/);
    expect(config).not.toHaveProperty("runArgs");
  });

  it("does not share ordinary-container state or add implicit privileged setup", () => {
    expect(sandboxConfig.mounts).toEqual([
      "source=jevault-${devcontainerId}-sandbox-node-modules,target=/workspaces/node_modules,type=volume",
      "source=jevault-${devcontainerId}-sandbox-codex,target=/home/node/.codex,type=volume",
    ]);
    // 別profileへ認証状態を引き継がず、許可した3つの差分以外の権限経路を閉じる。
    const sameSettings = { ...sandboxConfig, build: config.build };
    const ordinarySettings = { ...config };
    for (const key of ["name", "mounts", "runArgs"]) delete sameSettings[key];
    for (const key of ["name", "mounts"]) delete ordinarySettings[key];
    expect(sameSettings).toEqual(ordinarySettings);
    expect(sandboxConfig.containerUser).toBe("node");
  });
  it("starts with fresh profiles so saved configuration cannot merge into the command permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "jevault-wrapper-"));
    const wrapper = fileURLToPath(new URL("../.devcontainer/sandbox/codex.sh", import.meta.url));
    // 実Codexや通信を起動せず、shell wrapperが渡した実引数だけをfakeで検査する。
    writeFileSync(join(directory, "codex"), `#!/bin/sh\nprintf '%s\\n' "$@"\n`, { mode: 0o700 });
    const options = { encoding: "utf8" as const, env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } };
    const launch = (args: string[]) => execFileSync("sh", [wrapper, ...args], options).trim().split("\n");
    try {
      const first = launch(["sandbox", "--", "synthetic-command"]);
      const second = launch(["sandbox", "--", "synthetic-command"]);
      const profile = (args: string[]) => JSON.parse(args.find((arg) => arg.startsWith("default_permissions="))!.split("=")[1]) as string;
      for (const args of [first, second]) {
        expect(args.slice(0, 2)).toEqual(["--ask-for-approval", "on-request"]);
        expect(profile(args)).toMatch(/^jevault_[a-f0-9]{32}$/);
        expect(args).toContain('features.network_proxy=true');
        expect(args).toContain('features.use_legacy_landlock=false');
        expect(args).toContain(`permissions.${profile(args)}={extends=":workspace",filesystem={"/workspaces/node_modules"="write"},network={enabled=true,mode="full",allow_local_binding=false,allow_upstream_proxy=false,enable_socks5=false,enable_socks5_udp=false,dangerously_allow_all_unix_sockets=false,dangerously_allow_non_loopback_proxy=false,domains={},unix_sockets={}}}`);
        expect(args.slice(-3)).toEqual(["sandbox", "--", "synthetic-command"]);
      }
      expect(profile(first)).not.toBe(profile(second));
      const control = launch(["--synthetic-loopback-control", "sandbox", "--", "synthetic-command"]);
      expect(control.some((arg) => arg.includes('domains={"127.0.0.1"="allow"}'))).toBe(true);
      expect(control).not.toContain("--synthetic-loopback-control");
      const rejected = spawnSync("sh", [wrapper, "--synthetic-loopback-control", "exec"], options);
      expect(rejected.status).toBe(1);
      expect(rejected.stdout).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
