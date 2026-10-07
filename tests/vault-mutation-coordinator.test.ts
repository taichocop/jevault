import type { TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import { acquireVaultMutationLease as acquire, vaultMutationPathKey } from "../src/vault-mutation-coordinator";

const file = (): TFile => ({ path: "A.md" }) as TFile;

describe("Vault mutation coordinator", () => {
  it.each([
    ["A.md", undefined, "A.md", undefined],
    ["A.md", "Dest/X.md", "B.md", "Dest/X.md"],
    ["A.md", "Dest/X.md", "Dest/X.md", undefined],
    ["A.md", undefined, "B.md", "A.md"],
    ["A.MD", undefined, "a.md", undefined],
    ["É.md", undefined, "E\u0301.md", undefined],
    ["A.md", "DEST/É.MD", "dest/e\u0301.md", undefined],
  ])("conflicting source/target keys %j → %j vs %j → %j are busy", (a, targetA, b, targetB) => {
    const vault = {}, held = acquire(vault, a!, targetA)!;
    expect(acquire(vault, b!, targetB)).toBeUndefined();
    held.release();
    const fresh = acquire(vault, b!, targetB); expect(fresh).toBeDefined(); fresh?.release();
  });
  it("different actual Vaults have independent domains", () => {
    const first = acquire({}, "A.md")!, second = acquire({}, "A.md");
    expect(second).toBeDefined(); first.release(); second?.release();
  });
  it("unrelated source/target pairs proceed and release independently", () => {
    const vault = {}, first = acquire(vault, "A.md", "Dest/A.md")!;
    const second = acquire(vault, "B.md", "Other/B.md"); expect(second).toBeDefined(); second?.release();
    expect(acquire(vault, "Dest/A.md")).toBeUndefined(); first.release();
  });
  it("exact file identity remains busy after rename", () => {
    const vault = {}, identity = file(), held = acquire(vault, identity.path, undefined, identity)!;
    identity.path = "B.md";
    expect(acquire(vault, "B.md", "Dest/B.md", identity)).toBeUndefined();
    // identity conflict must reserve neither the new source nor target.
    const paths = acquire(vault, "B.md", "Dest/B.md"); expect(paths).toBeDefined(); paths?.release();
    held.release(); const fresh = acquire(vault, "B.md", undefined, identity); expect(fresh).toBeDefined(); fresh?.release();
  });
  it.each(["source", "target", "identity"])("%s conflict reserves none of the other keys", conflict => {
    const vault = {}, identity = file();
    const held = acquire(vault, conflict === "source" ? "A.md" : "Held.md",
      conflict === "target" ? "Dest/A.md" : undefined, conflict === "identity" ? identity : undefined)!;
    expect(acquire(vault, "A.md", "Dest/A.md", identity)).toBeUndefined();
    const independent = acquire(vault, conflict === "source" ? "Free.md" : "A.md",
      conflict === "target" ? "FreeTarget.md" : "Dest/A.md", conflict === "identity" ? file() : identity);
    expect(independent).toBeDefined(); independent?.release(); held.release();
  });
  it("failed late identity bind releases all paths and cannot revive", () => {
    const vault = {}, identity = file(), held = acquire(vault, "A.md", undefined, identity)!;
    const attempt = acquire(vault, "B.md", "Dest/B.md")!;
    expect(attempt.bindSourceFile(identity)).toBe(false);
    expect(attempt.bindSourceFile(file())).toBe(false);
    const fresh = acquire(vault, "B.md", "Dest/B.md")!; expect(fresh).toBeDefined();
    attempt.release(); expect(acquire(vault, "B.md")).toBeUndefined(); fresh.release(); held.release();
  });
  it("successful late identity bind conflicts with other paths and releases", () => {
    const vault = {}, identity = file(), lease = acquire(vault, "A.md", "a.MD")!;
    expect(lease.bindSourceFile(identity)).toBe(true); expect(lease.bindSourceFile(identity)).toBe(true);
    expect(acquire(vault, "B.md", undefined, identity)).toBeUndefined(); lease.release();
    expect(lease.bindSourceFile(identity)).toBe(false);
    const next = acquire(vault, "B.md", undefined, identity); expect(next).toBeDefined(); next?.release();
  });
  it("idempotent release cannot release a successor", () => {
    const vault = {}, held = acquire(vault, "A.md")!; held.release(); held.release();
    const successor = acquire(vault, "A.md")!; held.release();
    expect(acquire(vault, "A.md")).toBeUndefined(); successor.release();
  });
  it("comparison does not rewrite input paths or persist onto the Vault", () => {
    const vault = Object.freeze({}), path = "Dest/E\u0301.MD", held = acquire(vault, path)!;
    expect(path).toBe("Dest/E\u0301.MD"); expect(vaultMutationPathKey(path)).toBe("dest/é.md");
    expect(Object.keys(vault)).toEqual([]); held.release();
  });
});
