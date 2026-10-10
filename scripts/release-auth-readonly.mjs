import { TextDecoder } from "node:util";

export const repository = "taichocop/jevault";
export const repositoryId = 1377662458;
export const ownerId = 103035565;
const tagPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function text(bytes) {
  try { return decoder.decode(bytes); } catch { throw new Error("Invalid UTF-8 release data."); }
}
function json(value) {
  try { return JSON.parse(value); } catch { throw new Error("Malformed GitHub release response."); }
}

// 公開用コマンドや filesystem を持たない GET 検査だけを、publisher と診断で共有する。
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

export async function requiredApi(run, endpoint) {
  const response = await api(run, endpoint);
  if (response.status !== 200) throw new Error("Required GitHub release API resource is missing.");
  return response.body;
}

function requireRepositoryIdentity(repo) {
  if (!isObject(repo) || repo.full_name !== repository || repo.id !== repositoryId
    || !isObject(repo.owner) || repo.owner.id !== ownerId) {
    throw new Error("Release repository identity mismatch.");
  }
  // permissions は任意のユーザー権限情報。欠落は Installation の独立照合で補う。
  if (Object.hasOwn(repo, "permissions") && (!isObject(repo.permissions)
    || repo.permissions.push !== true)) {
    throw new Error("Repository permissions contradict the publication context.");
  }
}

export async function requireReleaseAuthentication(run, observe = () => {}) {
  const repo = await requiredApi(run, `repos/${repository}`);
  observe({ metadata: {
    nameMatches: isObject(repo) && repo.full_name === repository,
    repositoryIdMatches: isObject(repo) && repo.id === repositoryId,
    ownerIdMatches: isObject(repo) && isObject(repo.owner) && repo.owner.id === ownerId,
    permissionsPresent: isObject(repo) && Object.hasOwn(repo, "permissions"),
    push: !isObject(repo) || !Object.hasOwn(repo, "permissions") ? "missing"
      : !isObject(repo.permissions) || !Object.hasOwn(repo.permissions, "push") ? "invalid"
      : repo.permissions.push === true ? "true" : repo.permissions.push === false ? "false" : "invalid",
  } });
  requireRepositoryIdentity(repo);
  let total;
  const seen = new Set();
  let matches = true;
  for (let page = 1; page <= 1000; page += 1) {
    const listing = await requiredApi(run, `installation/repositories?per_page=100&page=${page}`);
    if (!isObject(listing) || !Number.isSafeInteger(listing.total_count) || listing.total_count < 0
      || !Array.isArray(listing.repositories) || listing.repositories.length > 100
      || (total !== undefined && total !== listing.total_count)) {
      throw new Error("Malformed installation repository listing.");
    }
    total = listing.total_count;
    observe({ installation: { pages: page, count: seen.size + listing.repositories.length, complete: false } });
    for (const repo of listing.repositories) {
      if (!isObject(repo) || !Number.isSafeInteger(repo.id) || repo.id <= 0
        || typeof repo.full_name !== "string" || !isObject(repo.owner)
        || !Number.isSafeInteger(repo.owner.id) || seen.has(repo.id)) {
        throw new Error("Malformed installation repository listing.");
      }
      seen.add(repo.id);
      matches &&= repo.id === repositoryId && repo.full_name === repository && repo.owner.id === ownerId;
      if (repo.id === repositoryId) requireRepositoryIdentity(repo);
    }
    if (seen.size > total) throw new Error("Inconsistent installation repository count.");
    if (listing.repositories.length < 100) {
      // GITHUB_TOKEN はこの Repository だけ。アクセス成功を Contents write の証明にしない。
      if (seen.size !== total || total !== 1 || !matches) {
        throw new Error("Installation token repository scope is not established.");
      }
      observe({ installation: { pages: page, count: seen.size, complete: true } });
      return;
    }
  }
  throw new Error("Installation listing exceeded its validation limit.");
}

export async function inspectReleaseState(run, tag, observe = () => {}) {
  if (!tagPattern.test(tag) || tag === "0.1.0") throw new Error("Invalid release tag.");
  const prefix = `repos/${repository}`;
  const existing = await api(run, `${prefix}/releases/tags/${tag}`);
  let targetState = "absent";
  if (existing.status === 200) {
    if (!isObject(existing.body) || existing.body.tag_name !== tag || typeof existing.body.draft !== "boolean") {
      throw new Error("Malformed target release response.");
    }
    targetState = existing.body.draft ? "draft" : "release";
    observe({ targetState });
  } else if (!isObject(existing.body) || existing.body.message !== "Not Found") {
    throw new Error("Release absence was not confirmed by an explicit 404.");
  }
  let count = 0;
  let drafts = 0;
  for (let page = 1; page <= 1000; page += 1) {
    const releases = await requiredApi(run, `${prefix}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases) || releases.length > 100 || releases.some((release) => !isObject(release)
      || typeof release.tag_name !== "string" || typeof release.draft !== "boolean")) {
      throw new Error("Malformed release listing; draft absence is unknown.");
    }
    count += releases.length;
    drafts += releases.filter(release => release.draft).length;
    for (const target of releases.filter(release => release.tag_name === tag)) {
      const state = target.draft ? "draft" : "release";
      targetState = targetState === "absent" || targetState === state ? state : "draft-and-release";
    }
    observe({ releases: { pages: page, count, drafts, complete: releases.length < 100 },
      ...(targetState !== "absent" ? { targetState } : {}) });
    if (releases.length < 100) {
      observe({ targetState });
      if (targetState !== "absent") throw new Error("Draft or release already exists; refusing to modify it.");
      return;
    }
  }
  throw new Error("Release listing exceeded its validation limit.");
}

export async function requireNoRelease(run, tag, observe = () => {}) {
  if (!tagPattern.test(tag) || tag === "0.1.0") throw new Error("Invalid release tag.");
  await requireReleaseAuthentication(run, observe);
  await inspectReleaseState(run, tag, observe);
}
