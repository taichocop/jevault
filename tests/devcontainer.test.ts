import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../.devcontainer/devcontainer.json", import.meta.url), "utf8"));
const dockerfile = readFileSync(new URL("../.devcontainer/Dockerfile", import.meta.url), "utf8");
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
      "source=jevault-${devcontainerId}-node-modules,target=/workspaces/jevault/node_modules,type=volume",
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

  it("installs dependencies on recreation without changing product engine support", () => {
    expect(config.postCreateCommand).toBe("npm ci");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.engines.node).toBe("^20.19.0 || ^22.13.0 || >=24.0.0");
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("@openai/codex");
    expect(hasSinglePinnedNode22BaseImage(dockerfile)).toBe(true);
    expect(dockerfile).toMatch(/npm install --global @openai\/codex@\d+\.\d+\.\d+\s/);
  });
});
