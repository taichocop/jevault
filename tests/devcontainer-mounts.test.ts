import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../.devcontainer/prepare-workspace.mjs", import.meta.url), "utf8")
  .replace(/^import .+;\n/gm, "");
const targets = ["/workspaces/jevault", "/workspaces/node_modules", "/home/node/.codex"];

function prepare(mounts: string[], existing?: "directory" | "correct-link" | "wrong-link") {
  const links: string[][] = [];
  const copies: string[][] = [];
  const run = () => runInNewContext(source, {
    readFileSync: () => mounts.map((target) => `1 0 254:1 / ${target} rw - ext4 /dev/vda1 rw`).join("\n"),
    lstatSync: () => {
      if (!existing) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { isSymbolicLink: () => existing !== "directory" };
    },
    readlinkSync: () => existing === "correct-link" ? "/workspaces/node_modules" : "/host/dependencies",
    symlinkSync: (...args: string[]) => links.push(args),
    copyFileSync: (...args: string[]) => copies.push(args),
    console: { log: () => {} },
  });
  return { links, copies, run };
}

describe("Dev Container actual mount gate", () => {
  it.each(targets)("refuses a missing %s mount before creating a host link", (target) => {
    const probe = prepare(targets.filter((item) => item !== target));
    expect(probe.run).toThrow("Required mount missing");
    expect(probe.links).toEqual([]);
    expect(probe.copies).toEqual([]);
  });

  it.each(["directory", "wrong-link"] as const)("preserves existing host %s", (existing) => {
    const probe = prepare(targets, existing);
    expect(probe.run).toThrow("use a clean clone");
    expect(probe.links).toEqual([]);
    expect(probe.copies).toEqual([]);
  });

  it("creates only the container dependency link after all mounts pass", () => {
    const probe = prepare(targets);
    probe.run();
    expect(probe.links).toEqual([["/workspaces/node_modules", "/workspaces/jevault/node_modules"]]);
    expect(probe.copies).toEqual([
      ["/workspaces/jevault/package.json", "/workspaces/package.json"],
      ["/workspaces/jevault/package-lock.json", "/workspaces/package-lock.json"],
      ["/workspaces/jevault/.npmrc", "/workspaces/.npmrc"],
    ]);
  });

  it("accepts an already prepared clone without replacing the link", () => {
    const probe = prepare(targets, "correct-link");
    probe.run();
    expect(probe.links).toEqual([]);
  });
});
