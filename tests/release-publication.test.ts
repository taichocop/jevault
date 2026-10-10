import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { buildReleaseArguments, extractAnnotation, parseApiResponse, publishRelease,
  publicationEnvironment, requireNoRelease, validateStagedAssets, type CommandRunner } from "../scripts/publish-release.mjs";
import { authenticationFailures, annotation, commit, fakeApiResult, fakeGit, mockResponse, object, rawTag,
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

it.each(["draft", "release", "401", "403", "500", "repo", "visibility", ...authenticationFailures])("fails closed before creation on %s", async (scenario) => {
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

it("rejects a changed tag or asset during API preflight and invokes the outer CLI once on error (internal retries are separate)", async () => {
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


it.each(["owner-metadata", "installation", "missing-permissions"])("accepts %s metadata only with independent installation access", async (scenario) => {
  const run = runner(scenario);
  await expect(requireNoRelease(run, tag)).resolves.toBeUndefined();
  expect(run.mock.calls.some(([, args]) => args.at(-1)?.startsWith("installation/repositories?"))).toBe(true);
  expect(run.mock.calls.every(([command, args]) => command === "gh" && args.includes("GET"))).toBe(true);
});

it("checks every installation page rather than stopping at the target repository", async () => {
  for (const second of [{ status: 401, body: {} }, { status: 404, body: {} }, { status: 500, body: {} },
    { status: 200, body: { total_count: 101, repositories: [{ id: 101, full_name: "other/fixture", owner: { id: 2 } }] } }]) {
    const run = runner(); const original = run.getMockImplementation()!;
    run.mockImplementation(async (command, args, options) => {
      const endpoint = args.at(-1)!;
      if (endpoint === "installation/repositories?per_page=100&page=1") return fakeApiResult({ status: 200,
        body: { total_count: 101, repositories: [
          { id: 1377662458, full_name: "taichocop/jevault", owner: { id: 103035565 } },
          ...Array.from({ length: 99 }, (_, index) => ({ id: index + 1, full_name: `other/fixture-${index}`, owner: { id: 2 } })),
        ] } });
      if (endpoint === "installation/repositories?per_page=100&page=2") return fakeApiResult(second);
      return original(command, args, options);
    });
    await expect(requireNoRelease(run, tag)).rejects.toThrow();
    expect(run.mock.calls.some(([, args]) => args.at(-1)?.endsWith("installation/repositories?per_page=100&page=2"))).toBe(true);
    expect(run.mock.calls.some(([, args]) => args.at(-1)?.includes("/releases"))).toBe(false);
  }
});

it("rejects malformed, incomplete, duplicate and changing installation counts", async () => {
  const repo = { id: 1377662458, full_name: "taichocop/jevault", owner: { id: 103035565 } };
  for (const listing of [null, {}, { total_count: 2, repositories: [repo] },
    { total_count: 1, repositories: [] }, { total_count: 2, repositories: [repo, repo] },
    { total_count: "1", repositories: [repo] }, { total_count: 1, repositories: [{ ...repo, owner: null }] },
    { total_count: 1, repositories: [{ ...repo, permissions: { push: false } }] }]) {
    const run = runner(); const original = run.getMockImplementation()!;
    run.mockImplementation(async (command, args, options) => args.at(-1)?.startsWith("installation/repositories?")
      ? fakeApiResult({ status: 200, body: listing }) : original(command, args, options));
    await expect(requireNoRelease(run, tag)).rejects.toThrow();
  }
  const run = runner(); const original = run.getMockImplementation()!;
  run.mockImplementation(async (command, args, options) => {
    if (args.at(-1) === "installation/repositories?per_page=100&page=1") return fakeApiResult({ status: 200,
      body: { total_count: 100, repositories: Array.from({ length: 100 }, (_, id) => ({ id: id + 1, full_name: "other/fixture", owner: { id: 2 } })) } });
    if (args.at(-1) === "installation/repositories?per_page=100&page=2") return fakeApiResult({ status: 200, body: { total_count: 101, repositories: [] } });
    return original(command, args, options);
  });
  await expect(requireNoRelease(run, tag)).rejects.toThrow("Malformed installation");
});

it.each(["repos/taichocop/jevault", "installation/repositories?per_page=100&page=1",
  `repos/taichocop/jevault/releases/tags/${tag}`, "repos/taichocop/jevault/releases?per_page=100&page=1"])("treats transport loss at %s as unknown", async (endpoint) => {
  const run = runner(); const original = run.getMockImplementation()!;
  run.mockImplementation(async (command, args, options) => args.at(-1) === endpoint
    ? { status: 1, stdout: Buffer.alloc(0) } : original(command, args, options));
  await expect(requireNoRelease(run, tag)).rejects.toThrow("without an explicit HTTP response");
});

function workflowEnvironment(): NodeJS.ProcessEnv {
  return { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "taichocop/jevault",
    GITHUB_REPOSITORY_ID: "1377662458", GITHUB_REPOSITORY_OWNER_ID: "103035565",
    GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: tag, GITHUB_REF: `refs/tags/${tag}`, GITHUB_SHA: commit,
    GITHUB_WORKFLOW_REF: `taichocop/jevault/.github/workflows/release.yml@refs/tags/${tag}`,
    GITHUB_WORKFLOW_SHA: commit, GITHUB_RUN_ATTEMPT: "1", GH_TOKEN: "synthetic-workflow-token" };
}

it("requires the reviewed tag-push context and isolates CLI configuration without fallback", () => {
  const env = { ...workflowEnvironment(), PATH: "/synthetic/bin", GH_CONFIG_DIR: "/untrusted/config",
    GITHUB_TOKEN: "synthetic-other-token", HTTPS_PROXY: "https://untrusted.invalid", HOME: "/synthetic/home" };
  const scoped = publicationEnvironment(env, "/synthetic/empty-config");
  expect(scoped.GH_TOKEN).toBe("synthetic-workflow-token");
  expect(scoped.GH_CONFIG_DIR).toBe("/synthetic/empty-config");
  expect(scoped.GH_HOST).toBe("github.com");
  expect(scoped).not.toHaveProperty("GITHUB_TOKEN");
  expect(scoped).not.toHaveProperty("HOME");
  expect(scoped).not.toHaveProperty("HTTPS_PROXY");
  for (const key of Object.keys(workflowEnvironment())) {
    const missing = { ...workflowEnvironment() }; delete missing[key];
    expect(() => publicationEnvironment(missing, "/synthetic/config")).toThrow();
  }
});

it.each([
  { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_EVENT_NAME: "workflow_dispatch" },
  { GITHUB_REPOSITORY: "other/fixture" }, { GITHUB_REPOSITORY_ID: "1" }, { GITHUB_REPOSITORY_OWNER_ID: "1" },
  { GITHUB_REF_TYPE: "branch" }, { GITHUB_REF: "refs/heads/main" }, { GITHUB_REF_NAME: "v1.2.3" },
  { GITHUB_WORKFLOW_REF: "other/fixture/.github/workflows/release.yml@refs/tags/1.2.3" },
  { GITHUB_WORKFLOW_SHA: "c".repeat(40) }, { GITHUB_RUN_ATTEMPT: "2" }, { GH_TOKEN: " " },
  { GH_HOST: "other.invalid" }, { GH_REPO: "other/fixture" },
])("rejects untrusted production context %j", (change) => {
  expect(() => publicationEnvironment({ ...workflowEnvironment(), ...change }, "/synthetic/config")).toThrow();
});

it("blocks default production execution outside Actions before filesystem or network work", async () => {
  vi.stubEnv("GITHUB_ACTIONS", "false");
  try {
    await expect(publishRelease({ root: "/nonexistent/synthetic", tag, commit, repository: "taichocop/jevault" })).rejects.toThrow("Trusted tag-push");
  } finally { vi.unstubAllEnvs(); }
});
