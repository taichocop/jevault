import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

export const repository = "taichocop/jevault";
export const assetNames = ["main.js", "manifest.json", "styles.css"];
const shaPattern = /^[0-9a-f]{40}$/;
const tagPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {
      timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options, encoding: "buffer",
    }, (error, stdout, stderr) => resolve({
      status: error ? (typeof error.code === "number" ? error.code : 1) : 0,
      stdout: stdout ?? Buffer.alloc(0), stderr: stderr ?? Buffer.alloc(0),
    }));
  });
}

function text(bytes) {
  try { return decoder.decode(bytes); } catch { throw new Error("Invalid UTF-8 release data."); }
}

function json(value) {
  try { return JSON.parse(value); } catch { throw new Error("Malformed GitHub release response."); }
}

export function extractAnnotation(raw, tag, commit) {
  const value = text(raw);
  const separator = value.indexOf("\n\n");
  const header = value.slice(0, separator).split("\n");
  if (separator < 0 || header.length !== 4 || header[0] !== `object ${commit}`
    || header[1] !== "type commit" || header[2] !== `tag ${tag}`
    || !/^tagger .+ <[^<>\n]+> \d+ [+-]\d{4}$/.test(header[3])) {
    throw new Error("Annotated tag must directly target the expected commit and tag name.");
  }
  // shell置換やtrimは末尾改行を失うため、tag objectの本文bytesをそのまま使う。
  const annotation = raw.subarray(Buffer.byteLength(value.slice(0, separator + 2), "utf8"));
  const body = text(annotation);
  if (!body.trim() || body.includes("\0") || /-----BEGIN (?:PGP|SSH) SIGNATURE-----/.test(body)) {
    throw new Error("Missing or unsupported tag annotation; refusing to substitute commit notes.");
  }
  return annotation;
}

export function buildReleaseArguments(tag, notesFile) {
  if (!tagPattern.test(tag) || tag === "0.1.0" || !notesFile || notesFile.startsWith("-")) {
    throw new Error("Invalid release tag or notes file.");
  }
  return ["release", "create", tag, ...assetNames.map((name) => `release-assets/${name}`),
    "--repo", repository, "--verify-tag", "--title", `Jevault ${tag}`, "--notes-file", notesFile];
}

export function parseApiResponse(result) {
  const value = text(result.stdout);
  const match = /^HTTP\/[\d.]+ (\d{3})[^\r\n]*\r?\n/.exec(value);
  const separator = /\r?\n\r?\n/.exec(value);
  if (!match || !separator) throw new Error("GitHub API failed without an explicit HTTP response.");
  const status = Number(match[1]);
  if ((status === 200 && result.status !== 0) || (status !== 200 && status !== 404)) {
    throw new Error(`GitHub release API failed (HTTP ${status}).`);
  }
  return { status, body: json(value.slice(separator.index + separator[0].length)) };
}

async function api(run, endpoint) {
  const result = await run("gh", ["api", "--hostname", "github.com", "--method", "GET", "--include", endpoint]);
  return parseApiResponse(result);
}

async function requiredApi(run, endpoint) {
  const response = await api(run, endpoint);
  if (response.status !== 200) throw new Error("Required GitHub release API resource is missing.");
  return response.body;
}

export async function requireNoRelease(run, tag) {
  const prefix = `repos/${repository}`;
  const repo = await requiredApi(run, prefix);
  // Draft一覧にはpush権限が必要。匿名・読取権限だけの404を不存在とみなさない。
  if (!isObject(repo) || repo.full_name !== repository || repo.permissions?.push !== true) {
    throw new Error("Release repository identity or authenticated draft visibility is not established.");
  }
  const existing = await api(run, `${prefix}/releases/tags/${tag}`);
  if (existing.status === 200) throw new Error("Release already exists; refusing to modify it.");
  if (!isObject(existing.body) || existing.body.message !== "Not Found") {
    throw new Error("Release absence was not confirmed by an explicit 404.");
  }
  for (let page = 1; page <= 1000; page += 1) {
    const releases = await requiredApi(run, `${prefix}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases) || releases.some((release) => !isObject(release)
      || typeof release.tag_name !== "string" || typeof release.draft !== "boolean")) {
      throw new Error("Malformed release listing; draft absence is unknown.");
    }
    if (releases.some((release) => release.tag_name === tag)) {
      throw new Error("Draft or release already exists; refusing to modify it.");
    }
    if (releases.length < 100) return;
  }
  throw new Error("Release listing exceeded its validation limit.");
}

export async function validateStagedAssets(root, tag) {
  const stage = path.join(root, "release-assets");
  if (!(await lstat(stage)).isDirectory()
    || (await readdir(stage)).sort().join("\n") !== [...assetNames].sort().join("\n")) {
    throw new Error("Release stage must contain exactly three regular assets.");
  }
  const checksum = await readFile(path.join(root, "release-assets.sha256"), "utf8");
  const lines = checksum.split("\n");
  if (lines.pop() !== "" || lines.length !== 3) throw new Error("Invalid three-asset checksum manifest.");
  const expected = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}release-assets\/(main\.js|manifest\.json|styles\.css)$/.exec(line);
    if (!match || expected.has(match[2])) throw new Error("Invalid three-asset checksum manifest.");
    expected.set(match[2], match[1]);
  }
  for (const name of assetNames) {
    const file = path.join(stage, name);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size === 0) throw new Error("Release asset must be a nonempty regular file.");
    const bytes = await readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== expected.get(name)) {
      throw new Error("Staged release asset hash mismatch.");
    }
    if (name === "manifest.json" && json(text(bytes)).version !== tag) {
      throw new Error("Staged manifest does not match the release tag.");
    }
  }
  const pkg = json(await readFile(path.join(root, "package.json"), "utf8"));
  const lock = json(await readFile(path.join(root, "package-lock.json"), "utf8"));
  if (pkg.version !== tag || lock.version !== tag || lock.packages?.[""]?.version !== tag) {
    throw new Error("Package metadata does not match the release tag.");
  }
  return checksum;
}

async function git(run, args, raw = false) {
  const result = await run("git", args);
  if (result.status !== 0) throw new Error("Release Git verification failed.");
  return raw ? result.stdout : text(result.stdout).trim();
}

export async function validateTag(run, tag, commit) {
  if (await git(run, ["rev-parse", "HEAD"]) !== commit) throw new Error("Release checkout commit mismatch.");
  await git(run, ["merge-base", "--is-ancestor", "HEAD", "origin/main"]);
  const remote = await git(run, ["remote", "get-url", "origin"]);
  if (!["https://github.com/taichocop/jevault.git", "https://github.com/taichocop/jevault",
    "git@github.com:taichocop/jevault.git"].includes(remote)) {
    throw new Error("Release Git remote repository mismatch.");
  }
  const object = await git(run, ["rev-parse", `refs/tags/${tag}`]);
  if (!shaPattern.test(object)) throw new Error("Invalid release tag object.");
  const annotation = extractAnnotation(await git(run, ["cat-file", "tag", object], true), tag, commit);
  const refs = await git(run, ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  const expected = [`${object}\trefs/tags/${tag}`, `${commit}\trefs/tags/${tag}^{}`].sort();
  if (refs.split("\n").sort().join("\n") !== expected.join("\n")) {
    throw new Error("Remote annotated tag object or commit mismatch.");
  }
  const prefix = `repos/${repository}/git`;
  const ref = await requiredApi(run, `${prefix}/ref/tags/${tag}`);
  const annotated = await requiredApi(run, `${prefix}/tags/${object}`);
  if (ref.ref !== `refs/tags/${tag}` || ref.object?.type !== "tag" || ref.object.sha !== object
    || annotated.sha !== object || annotated.tag !== tag || annotated.object?.type !== "commit"
    || annotated.object.sha !== commit || typeof annotated.message !== "string"
    || !Buffer.from(annotated.message, "utf8").equals(annotation)) {
    throw new Error("GitHub tag object, commit or annotation mismatch.");
  }
  return { object, annotation };
}

export async function publishRelease({ root, tag, commit, repository: target }, run = runCommand) {
  if (target !== repository || !tagPattern.test(tag) || tag === "0.1.0" || !shaPattern.test(commit)) {
    throw new Error("Invalid release repository, tag or commit.");
  }
  const execute = (command, args) => run(command, args, { cwd: root });
  const originalChecksum = await validateStagedAssets(root, tag);
  const original = await validateTag(execute, tag, commit);
  await requireNoRelease(execute, tag);
  const notesRoot = await mkdtemp(path.join(tmpdir(), "jevault-release-notes-"));
  try {
    const notesFile = path.join(notesRoot, "notes.txt");
    await writeFile(notesFile, original.annotation, { flag: "wx", mode: 0o600 });
    // API確認中のtag変更・stage変更も公開直前に再検査し、再取得本文へ差し替えない。
    const current = await validateTag(execute, tag, commit);
    if (current.object !== original.object || !current.annotation.equals(original.annotation)
      || !(await readFile(notesFile)).equals(original.annotation)) {
      throw new Error("Release annotation changed before publication.");
    }
    await requireNoRelease(execute, tag);
    if (await validateStagedAssets(root, tag) !== originalChecksum) {
      throw new Error("Staged asset checksum manifest changed before publication.");
    }
    const result = await execute("gh", buildReleaseArguments(tag, notesFile));
    if (result.status !== 0) throw new Error("Release creation failed; no automatic retry or cleanup is performed.");
    return { tag, object: original.object, annotationSha256: createHash("sha256").update(original.annotation).digest("hex") };
  } finally {
    await rm(notesRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if ((process.env.GH_HOST && process.env.GH_HOST !== "github.com")
      || (process.env.GH_REPO && process.env.GH_REPO !== repository)) {
      throw new Error("Release GitHub host or repository override is not permitted.");
    }
    const result = await publishRelease({ root: process.cwd(), tag: process.argv[2] ?? "",
      commit: process.env.GITHUB_SHA ?? "", repository: process.env.GITHUB_REPOSITORY ?? "" });
    console.log(`Published verified release ${result.tag}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
