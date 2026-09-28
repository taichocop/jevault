import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { prepareRelease } from "../scripts/prepare-release.mjs";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jevault-release-"));
  roots.push(root);
  await Promise.all([
    writeFile(path.join(root, "main.js"), "/* TypeSafe notice */\nplugin code"),
    writeFile(path.join(root, "styles.css"), ".suggestion { margin: 1px; }"),
    writeFile(path.join(root, "manifest.json"), JSON.stringify({ version: "0.2.0", minAppVersion: "1.11.4" })),
    writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.2.0" })),
    writeFile(path.join(root, "versions.json"), JSON.stringify({ "0.1.0": "1.11.4" })),
  ]);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("allows an unchanged minAppVersion without a current versions entry and stages only exact assets", async () => {
  const root = await fixture();
  const before = await readFile(path.join(root, "manifest.json"));
  await writeFile(path.join(root, ".env.1password"), "fixture, not a secret");
  await writeFile(path.join(root, "main.js.map"), "fixture map");
  await prepareRelease(root, "0.2.0");
  expect(await readdir(path.join(root, "release-assets"))).toEqual(["main.js", "manifest.json", "styles.css"]);
  expect(await readFile(path.join(root, "manifest.json"))).toEqual(before);
  expect((await readFile(path.join(root, "release-assets.sha256"), "utf8")).trim().split("\n")).toHaveLength(3);
});

it("rejects a mismatched tag or package version", async () => {
  const root = await fixture();
  await expect(prepareRelease(root, "v0.2.0")).rejects.toThrow("Release tag");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.3.0" }));
  await expect(prepareRelease(root, "0.2.0")).rejects.toThrow("versions");
});

it("rejects missing or empty styles.css and other missing assets", async () => {
  const root = await fixture();
  await rm(path.join(root, "styles.css"));
  await expect(prepareRelease(root)).rejects.toThrow();
  await writeFile(path.join(root, "styles.css"), "");
  await expect(prepareRelease(root)).rejects.toThrow("nonempty");
  const otherRoot = await fixture();
  await rm(path.join(otherRoot, "main.js"));
  await expect(prepareRelease(otherRoot)).rejects.toThrow();
});

it("requires a current mapping when minAppVersion changes", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "manifest.json"), JSON.stringify({ version: "0.2.0", minAppVersion: "1.13.0" }));
  await expect(prepareRelease(root)).rejects.toThrow("minAppVersion changed; versions.json requires an entry");
});

it("accepts a matching current compatibility mapping", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "manifest.json"), JSON.stringify({ version: "0.2.0", minAppVersion: "1.13.0" }));
  await writeFile(path.join(root, "versions.json"), JSON.stringify({ "0.1.0": "1.11.4", "0.2.0": "1.13.0" }));
  await expect(prepareRelease(root, "0.2.0")).resolves.toMatchObject({ version: "0.2.0" });
});

it("rejects a conflicting current versions.json entry", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "manifest.json"), JSON.stringify({ version: "0.2.0", minAppVersion: "1.13.0" }));
  await writeFile(path.join(root, "versions.json"), JSON.stringify({ "0.1.0": "1.11.4", "0.2.0": "1.12.0" }));
  await expect(prepareRelease(root)).rejects.toThrow("minAppVersion");
});

it("uses numeric SemVer ordering regardless of versions.json key order", async () => {
  for (const mappings of [
    { "0.9.0": "1.11.4", "0.10.0": "1.13.0" },
    { "0.10.0": "1.13.0", "0.9.0": "1.11.4" },
  ]) {
    const root = await fixture();
    await writeFile(path.join(root, "manifest.json"), JSON.stringify({ version: "0.11.0", minAppVersion: "1.13.0" }));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.11.0" }));
    await writeFile(path.join(root, "versions.json"), JSON.stringify(mappings));
    await expect(prepareRelease(root)).resolves.toMatchObject({ version: "0.11.0" });
  }
});

it("fails closed when no earlier compatibility mapping exists", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "versions.json"), JSON.stringify({ "0.3.0": "1.13.0" }));
  await expect(prepareRelease(root)).rejects.toThrow("compatibility mapping");
});
