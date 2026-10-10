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

export async function requireReleaseAuthentication(run) {
  const repo = await requiredApi(run, `repos/${repository}`);
  if (!isObject(repo) || repo.full_name !== repository || repo.id !== repositoryId
    || !isObject(repo.owner) || repo.owner.id !== ownerId) {
    throw new Error("Release repository identity mismatch.");
  }
  // permissions.push はユーザー権限情報。job の contents: write の可否は GitHub が判定する。
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
      // 空の認証済み GET は Draft 可視性・書込権限を証明しない。衝突の最終判定は CLI/API に委ねる。
      observe({ targetState });
      if (targetState !== "absent") throw new Error("Draft or release already exists; refusing to modify it.");
      return;
    }
  }
  throw new Error("Release listing exceeded its validation limit.");
}

export async function requireNoRelease(run, tag, observe = () => {}) {
  if (!tagPattern.test(tag) || tag === "0.1.0") throw new Error("Invalid release tag.");
  await requireReleaseAuthentication(run);
  await inspectReleaseState(run, tag, observe);
}
