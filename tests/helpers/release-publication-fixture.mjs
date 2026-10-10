import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const tag = "1.2.3";
export const commit = "a".repeat(40);
export const object = "b".repeat(40);
export const annotation = Buffer.from("# Synthetic release\n\n日本語 notes\r\n\nTrailing blank lines\n\n", "utf8");
export function rawTag(body = annotation) {
  return Buffer.concat([Buffer.from(`object ${commit}\ntype commit\ntag ${tag}\ntagger Synthetic <fixture@example.invalid> 1234567890 +0000\n\n`), body]);
}

export function fakeGit(args) {
  const key = args.join(" ");
  const outputs = new Map([
    ["rev-parse HEAD", `${commit}\n`],
    ["merge-base --is-ancestor HEAD origin/main", ""],
    ["remote get-url origin", "https://github.com/taichocop/jevault.git\n"],
    [`rev-parse refs/tags/${tag}`, `${object}\n`],
    [`cat-file tag ${object}`, rawTag()],
    [`ls-remote --exit-code --tags origin refs/tags/${tag} refs/tags/${tag}^{}`,
      `${object}\trefs/tags/${tag}\n${commit}\trefs/tags/${tag}^{}\n`],
  ]);
  if (!outputs.has(key)) throw new Error("Unexpected synthetic Git command.");
  return { status: 0, stdout: Buffer.from(outputs.get(key)) };
}

export const authenticationFailures = ["repo-id", "owner-id", "owner-token", "installation-repo",
  "installation-id", "installation-owner", "installation-empty", "installation-wide", "installation-pages", "installation-page-403",
  "installation-count", "installation-malformed",
  ...["metadata", "installation", "release-list"].flatMap(endpoint =>
    [401, 403, 404, 500, 503].map(status => `${endpoint}-${status}`)),
  ...[401, 403, 500, 503].map(status => `release-tag-${status}`)];

export function mockResponse(endpoint, scenario = "allowed") {
  const prefix = "repos/taichocop/jevault";
  const failure = /^(metadata|installation|release-tag|release-list)-(401|403|404|500|503)$/.exec(scenario);
  const matchesEndpoint = failure && (failure[1] === "metadata" ? endpoint === prefix
    : failure[1] === "installation" ? endpoint.startsWith("installation/repositories?")
    : failure[1] === "release-tag" ? endpoint === `${prefix}/releases/tags/${tag}`
    : endpoint.startsWith(`${prefix}/releases?`));
  if (matchesEndpoint) return { status: Number(failure[2]), body: { message: "Synthetic API failure" } };
  if (scenario === "403") return { status: 403, body: { message: "Forbidden" } };
  if (scenario === "401") return { status: 401, body: { message: "Bad credentials" } };
  if (scenario === "500") return { status: 500, body: { message: "Synthetic API failure" } };
  if (endpoint === prefix) return { status: 200, body: {
    id: scenario === "repo-id" ? 1 : 1377662458,
    owner: { id: scenario === "owner-id" ? 1 : 103035565 },
    full_name: scenario === "repo" ? "other/fixture" : "taichocop/jevault",
    ...(["installation", "missing-permissions"].includes(scenario) ? {}
      : { permissions: { push: scenario !== "visibility" } }),
  } };
  if (endpoint.startsWith("installation/repositories?")) {
    if (scenario === "owner-token") return { status: 403, body: { message: "Synthetic unsupported token" } };
    if (/^installation-(401|403|404|500)$/.test(scenario)) {
      return { status: Number(scenario.split("-")[1]), body: { message: "Synthetic API failure" } };
    }
    if (["installation-pages", "installation-page-403"].includes(scenario)) {
      if (endpoint.endsWith("page=2")) return scenario === "installation-page-403"
        ? { status: 403, body: { message: "Synthetic API failure" } }
        : { status: 200, body: { total_count: 100, repositories: [] } };
      return { status: 200, body: { total_count: 100, repositories: [
        { id: 1377662458, full_name: "taichocop/jevault", owner: { id: 103035565 } },
        ...Array.from({ length: 99 }, (_, index) => ({ id: index + 1, full_name: "other/fixture", owner: { id: 2 } })),
      ] } };
    }
    if (scenario === "installation-malformed") return { status: 200, body: { repositories: [] } };
    const repo = { id: 1377662458, full_name: "taichocop/jevault", owner: { id: 103035565 } };
    if (scenario === "installation-repo") repo.full_name = "other/fixture";
    if (scenario === "installation-id") repo.id = 1;
    if (scenario === "installation-owner") repo.owner.id = 1;
    const repositories = scenario === "installation-empty" ? [] : [repo];
    if (scenario === "installation-wide") repositories.push({ id: 2, full_name: "other/fixture", owner: { id: 2 } });
    return { status: 200, body: { total_count: scenario === "installation-count" ? 2 : repositories.length, repositories } };
  }
  if (endpoint.startsWith(`${prefix}/releases?`)) return { status: 200, body: scenario === "draft"
    ? [{ tag_name: tag, draft: true }] : [] };
  if (endpoint === `${prefix}/releases/tags/${tag}`) return scenario === "release"
    ? { status: 200, body: { tag_name: tag, draft: false } }
    : { status: 404, body: { message: "Not Found" } };
  if (endpoint === `${prefix}/git/ref/tags/${tag}`) return { status: 200, body: {
    ref: `refs/tags/${tag}`, object: { type: "tag", sha: scenario === "tag" ? "c".repeat(40) : object },
  } };
  if (endpoint === `${prefix}/git/tags/${object}`) return { status: 200, body: {
    sha: object, tag, object: { type: "commit", sha: scenario === "commit" ? "c".repeat(40) : commit },
    message: scenario === "annotation" ? annotation.toString().trimEnd() : annotation.toString(),
  } };
  return { status: 500, body: { message: "Unexpected mock API route" } };
}

export function fakeApiResult(response) {
  return { status: response.status === 200 ? 0 : 1,
    stdout: Buffer.from(`HTTP/2.0 ${response.status} Synthetic\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(response.body)}`) };
}

export async function releaseFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jevault-publication-fixture-"));
  await mkdir(path.join(root, "release-assets"));
  const assets = { "main.js": Buffer.from("synthetic plugin\n"),
    "manifest.json": Buffer.from(JSON.stringify({ version: tag })), "styles.css": Buffer.from(".synthetic {}\n") };
  const hashes = [];
  for (const [name, bytes] of Object.entries(assets)) {
    await writeFile(path.join(root, "release-assets", name), bytes);
    hashes.push(`${createHash("sha256").update(bytes).digest("hex")}  release-assets/${name}`);
  }
  await writeFile(path.join(root, "release-assets.sha256"), `${hashes.join("\n")}\n`);
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: tag }));
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify({ version: tag, packages: { "": { version: tag } } }));
  return root;
}
