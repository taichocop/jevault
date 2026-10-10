import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { buildReleaseArguments, extractAnnotation, parseApiResponse, publishRelease,
  requireNoRelease, validateStagedAssets, type CommandRunner } from "../scripts/publish-release.mjs";
import { annotation, commit, fakeApiResult, fakeGit, mockResponse, object, rawTag,
  releaseFixture, tag } from "./helpers/release-publication-fixture.mjs";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await releaseFixture(); roots.push(root); return root; }
function runner(scenario = "allowed") {
  return vi.fn<CommandRunner>(async (command, args) => {
    if (command === "git") return fakeGit(args);
    if (command === "gh" && args[0] === "api") return fakeApiResult(mockResponse(args.at(-1)!, scenario));
    if (command === "gh" && args[0] === "release") return { status: 0, stdout: Buffer.alloc(0) };
    throw new Error("Unexpected fixture command.");
  });
}

it("preserves every annotation byte, including Unicode, CRLF and trailing blank lines", () => {
  expect(extractAnnotation(rawTag(), tag, commit)).toEqual(annotation);
  for (const body of [Buffer.from("notes"), Buffer.from("notes\n\n\n")]) {
    expect(extractAnnotation(rawTag(body), tag, commit)).toEqual(body);
  }
});

it.each([Buffer.alloc(0), Buffer.from(" \n"), Buffer.from("notes\0"), Buffer.from([0xff]),
  Buffer.from("notes\n-----BEGIN PGP SIGNATURE-----\nfixture")])("rejects missing or invalid annotation %j", (body) => {
  expect(() => extractAnnotation(rawTag(body), tag, commit)).toThrow();
});

it("rejects wrong tag, wrong commit, lightweight tags and indirect tag objects", () => {
  expect(() => extractAnnotation(rawTag(), "2.0.0", commit)).toThrow();
  expect(() => extractAnnotation(rawTag(), tag, "c".repeat(40))).toThrow();
  expect(() => extractAnnotation(Buffer.from("commit message"), tag, commit)).toThrow();
  expect(() => extractAnnotation(Buffer.from(rawTag().toString().replace("type commit", "type tag")), tag, commit)).toThrow();
});

it("uses the exact three assets, fixed repository, verified tag and notes-file flags", () => {
  expect(buildReleaseArguments(tag, "/synthetic/notes.txt")).toEqual([
    "release", "create", tag, "release-assets/main.js", "release-assets/manifest.json", "release-assets/styles.css",
    "--repo", "taichocop/jevault", "--verify-tag", "--title", `Jevault ${tag}`, "--notes-file", "/synthetic/notes.txt",
  ]);
  expect(() => buildReleaseArguments("0.1.0", "/synthetic/notes.txt")).toThrow();
  expect(() => buildReleaseArguments("v1.2.3", "/synthetic/notes.txt")).toThrow();
});

it.each(["draft", "release", "401", "403", "500", "repo", "visibility"])("fails closed before creation on %s", async (scenario) => {
  const root = await fixture();
  const run = runner(scenario);
  await expect(publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run)).rejects.toThrow();
  expect(run.mock.calls.some(([, args]) => args[0] === "release")).toBe(false);
});

it.each(["tag", "commit", "annotation"])("rejects GitHub %s differences before creation", async (scenario) => {
  const root = await fixture();
  const run = runner(scenario);
  await expect(publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run)).rejects.toThrow("mismatch");
  expect(run.mock.calls.some(([, args]) => args[0] === "release")).toBe(false);
});

it("rejects local checkout, ancestry, remote identity and same-commit tag replacement", async () => {
  const root = await fixture();
  for (const failed of ["rev-parse HEAD", "merge-base --is-ancestor HEAD origin/main", "remote get-url origin", "ls-remote"]) {
    const run = runner();
    const original = run.getMockImplementation()!;
    run.mockImplementation(async (command, args, options) => command === "git" && args.join(" ").startsWith(failed)
      ? { status: failed.startsWith("merge") ? 1 : 0, stdout: Buffer.from("wrong\n") } : original(command, args, options));
    await expect(publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run)).rejects.toThrow();
    expect(run.mock.calls.some(([, args]) => args[0] === "release")).toBe(false);
  }
});

it("does not infer absence from exit codes, malformed responses or transport failures", () => {
  for (const result of [
    { status: 1, stdout: Buffer.alloc(0) },
    { status: 1, stdout: Buffer.from("HTTP/2.0 200 OK\n\n{}") },
    { status: 1, stdout: Buffer.from("HTTP/2.0 404 Not Found\n\ninvalid") },
    { status: 1, stdout: Buffer.from("HTTP/2.0 403 Forbidden\n\n{}") },
  ]) expect(() => parseApiResponse(result)).toThrow();
});

it("rejects later-page drafts, API failures and malformed listings", async () => {
  for (const later of [mockResponse("repos/taichocop/jevault/releases?per_page=100&page=2", "draft"),
    { status: 403, body: {} }, { status: 200, body: [{ tag_name: tag }] }]) {
    const run = runner();
    const original = run.getMockImplementation()!;
    run.mockImplementation(async (command, args, options) => {
      const endpoint = args.at(-1)!;
      if (endpoint.endsWith("page=1")) return fakeApiResult({ status: 200,
        body: Array.from({ length: 100 }, () => ({ tag_name: "other", draft: false })) });
      if (endpoint.endsWith("page=2")) return fakeApiResult(later);
      return original(command, args, options);
    });
    await expect(requireNoRelease(run, tag)).rejects.toThrow();
  }
});

it("refuses missing, empty, extra, symlinked, changed or unbound assets and metadata", async () => {
  const mutations = [
    async (root: string) => rm(path.join(root, "release-assets", "styles.css")),
    async (root: string) => writeFile(path.join(root, "release-assets", "main.js"), ""),
    async (root: string) => writeFile(path.join(root, "release-assets", "fourth.txt"), "extra"),
    async (root: string) => writeFile(path.join(root, "release-assets", "styles.css"), "changed"),
    async (root: string) => { await rm(path.join(root, "release-assets", "main.js"));
      await symlink(path.join(root, "package.json"), path.join(root, "release-assets", "main.js")); },
    async (root: string) => writeFile(path.join(root, "release-assets.sha256"), ""),
    async (root: string) => writeFile(path.join(root, "package-lock.json"), JSON.stringify({ version: "9.9.9" })),
  ];
  for (const mutation of mutations) {
    const root = await fixture(); await mutation(root);
    await expect(validateStagedAssets(root, tag)).rejects.toThrow();
  }
});

it("passes exact annotation bytes to the shared CLI and removes the temporary notes file", async () => {
  const root = await fixture(); const run = runner(); const original = run.getMockImplementation()!;
  let notesFile = "";
  run.mockImplementation(async (command, args, options) => {
    if (args[0] === "release") {
      notesFile = args.at(-1)!;
      expect(await readFile(notesFile)).toEqual(annotation);
      expect(options?.cwd).toBe(root);
    }
    return original(command, args, options);
  });
  await expect(publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run)).resolves.toMatchObject({ tag, object });
  await expect(readFile(notesFile)).rejects.toThrow();
});

it("rejects a changed tag or asset during API preflight and never retries a creation error", async () => {
  for (const mutation of ["tag", "asset", "create-error"]) {
    const root = await fixture(); const run = runner(); const original = run.getMockImplementation()!;
    let reads = 0;
    run.mockImplementation(async (command, args, options) => {
      if (command === "git" && args[0] === "cat-file" && ++reads === 2 && mutation === "tag") {
        return { status: 0, stdout: rawTag(Buffer.from("changed notes\n")) };
      }
      if (args.at(-1)?.includes("/releases?") && mutation === "asset") {
        await writeFile(path.join(root, "release-assets", "styles.css"), "changed");
      }
      if (args[0] === "release" && mutation === "create-error") return { status: 1, stdout: Buffer.alloc(0) };
      return original(command, args, options);
    });
    await expect(publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run)).rejects.toThrow();
    expect(run.mock.calls.filter(([, args]) => args[0] === "release")).toHaveLength(mutation === "create-error" ? 1 : 0);
  }
});

it("rejects a draft that appears during preflight and a rewritten asset plus checksum", async () => {
  for (const mutation of ["late-draft", "rewritten-checksum"]) {
    const root = await fixture(); const run = runner(); const original = run.getMockImplementation()!;
    let listings = 0;
    run.mockImplementation(async (command, args, options) => {
      if (args.at(-1)?.includes("/releases?") && ++listings === 2) {
        if (mutation === "late-draft") return fakeApiResult({ status: 200, body: [{ tag_name: tag, draft: true }] });
        const bytes = Buffer.from("different plugin bytes");
        const checksum = await readFile(path.join(root, "release-assets.sha256"), "utf8");
        await writeFile(path.join(root, "release-assets", "main.js"), bytes);
        await writeFile(path.join(root, "release-assets.sha256"), checksum.replace(/^[0-9a-f]{64}/,
          createHash("sha256").update(bytes).digest("hex")));
      }
      return original(command, args, options);
    });
    await expect(publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run)).rejects.toThrow();
    expect(run.mock.calls.some(([, args]) => args[0] === "release")).toBe(false);
  }
});

it("rejects a public target override before any command", async () => {
  const root = await fixture(); const run = runner();
  await expect(publishRelease({ root, tag, commit, repository: "other/fixture" }, run)).rejects.toThrow("repository");
  expect(run).not.toHaveBeenCalled();
});

it("keeps attestation unchanged and validation restricted to mock execution", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const [validation, release] = workflow.split("  release:\n");
  expect(validation).toContain("node scripts/validate-release-cli.mjs");
  expect(release).toContain('node scripts/publish-release.mjs "$RELEASE_TAG"');
  expect(release).toContain("actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6");
  expect(workflow).not.toContain("--notes-from-tag");
});
