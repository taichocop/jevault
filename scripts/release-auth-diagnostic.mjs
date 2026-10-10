import { Buffer } from "node:buffer";
import console from "node:console";
import path from "node:path";
import process from "node:process";
import { request } from "node:https";
import { fileURLToPath } from "node:url";
import { repository, repositoryId, ownerId, requireNoRelease } from "./release-auth-readonly.mjs";

export const diagnosticTag = "0.5.2";
const prefix = `repos/${repository}`;
const workflow = `${repository}/.github/workflows/release-auth-diagnostic.yml@refs/heads/main`;
const limit = 4 * 1024 * 1024;
class DiagnosticError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function validateDiagnosticContext(env) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REPOSITORY !== repository || env.GITHUB_REPOSITORY_ID !== String(repositoryId)
    || env.GITHUB_REPOSITORY_OWNER_ID !== String(ownerId) || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REF_TYPE !== "branch" || env.GITHUB_REF_NAME !== "main"
    || !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? "") || env.GITHUB_WORKFLOW_REF !== workflow
    || env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA || env.GITHUB_RUN_ATTEMPT !== "1"
    || typeof env.GH_TOKEN !== "string" || !env.GH_TOKEN.trim()) {
    throw new DiagnosticError("context-rejected");
  }
}

export function validateDiagnosticRequest(method, endpoint) {
  const paged = /^(installation\/repositories|repos\/taichocop\/jevault\/releases)\?per_page=100&page=([1-9]\d{0,3})$/.exec(endpoint);
  if (method !== "GET" || !(endpoint === prefix || endpoint === `${prefix}/releases/tags/${diagnosticTag}`
    || (paged && Number(paged[2]) <= 1000))) throw new DiagnosticError("request-refused");
}

// native HTTPS は CLI・keyring・proxy 設定を参照せず、redirect も追わない。
function nativeGet(url, options) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, response => {
      const status = response.statusCode;
      if (status >= 300 && status < 400) {
        response.resume(); resolve({ status, bytes: Buffer.alloc(0), link: undefined }); return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > limit) { req.destroy(new DiagnosticError("response-too-large")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, bytes: Buffer.concat(chunks), link: response.headers.link }));
      response.on("error", () => reject(new DiagnosticError("transport-failure")));
      response.on("aborted", () => reject(new DiagnosticError("transport-failure")));
    });
    req.on("error", error => reject(error instanceof DiagnosticError ? error : new DiagnosticError("transport-failure")));
    req.end();
  });
}

export async function diagnosticGet(endpoint, token, transport = nativeGet) {
  validateDiagnosticRequest("GET", endpoint);
  if (typeof token !== "string" || !token.trim()) throw new DiagnosticError("context-rejected");
  let response;
  try {
    response = await transport(`https://api.github.com/${endpoint}`, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "User-Agent": "jevault-release-auth-diagnostic" },
      signal: globalThis.AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw error instanceof DiagnosticError ? error : new DiagnosticError("transport-failure");
  }
  if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599
    || !Buffer.isBuffer(response.bytes)) throw new DiagnosticError("unknown-response");
  if (response.status >= 300 && response.status < 400) throw new DiagnosticError("redirect-refused");
  if (response.bytes.length > limit) throw new DiagnosticError("response-too-large");
  // 短い page に next がある応答は、共有 scanner の完了条件と矛盾するため停止する。
  if (typeof response.link === "string" && /rel="?next\b/.test(response.link)) {
    let body;
    try { body = JSON.parse(response.bytes.toString("utf8")); } catch { throw new DiagnosticError("invalid-json"); }
    const entries = endpoint.startsWith("installation/") ? body?.repositories : body;
    if (!Array.isArray(entries) || entries.length !== 100) throw new DiagnosticError("pagination-incomplete");
    const page = Number(/&page=(\d+)$/.exec(endpoint)?.[1]);
    const expected = `https://api.github.com/${endpoint.replace(/&page=\d+$/, `&page=${page + 1}`)}`;
    const next = /<([^>]+)>;\s*rel="?next\b/.exec(response.link)?.[1];
    if (next !== expected || page >= 1000) throw new DiagnosticError("pagination-incomplete");
  }
  return response;
}

function failureCode(error, status, targetState) {
  if (error instanceof DiagnosticError) return error.code;
  if ([401, 403, 404].includes(status) || status >= 500) return `http-${status}`;
  if (error?.message === "Malformed GitHub release response.") return "invalid-json";
  if (error?.message === "Invalid UTF-8 release data.") return "invalid-utf8";
  const reasons = {
    "Release repository identity mismatch.": "repository-identity-mismatch",
    "Repository permissions contradict the publication context.": "permissions-contradiction",
    "Installation token repository scope is not established.": "installation-scope-mismatch",
    "Malformed installation repository listing.": "installation-list-invalid",
    "Inconsistent installation repository count.": "installation-list-invalid",
    "Installation listing exceeded its validation limit.": "pagination-incomplete",
    "Release listing exceeded its validation limit.": "pagination-incomplete",
    "Malformed release listing; draft absence is unknown.": "release-list-invalid",
    "Malformed target release response.": "target-release-invalid",
    "Draft or release already exists; refusing to modify it.": targetState === "draft" ? "existing-draft" : targetState === "draft-and-release" ? "existing-draft-and-release" : "existing-release",
  };
  return reasons[error?.message] ?? "validation-failed";
}

export async function runDiagnostic({ env = process.env, transport = nativeGet } = {}) {
  const report = { schema: 1, targetTag: diagnosticTag, context: "rejected", result: "failed", failure: null,
    phase: "context", httpStatus: {}, metadata: null, installation: null, releases: null, targetState: "unknown",
    releaseWritePermission: "not-proven-by-GET", draftVisibility: "unknown", publisherVerified: false };
  let lastStatus;
  try {
    validateDiagnosticContext(env);
    report.context = "verified";
    const run = async (command, args) => {
      if (command !== "gh" || args.length !== 7 || args.slice(0, 6).join(" ") !== "api --hostname github.com --method GET --include") {
        throw new DiagnosticError("request-refused");
      }
      const endpoint = args[6];
      validateDiagnosticRequest("GET", endpoint);
      report.phase = endpoint === prefix ? "metadata" : endpoint.startsWith("installation/") ? "installation"
        : endpoint.includes("/releases/tags/") ? "target-release" : "release-list";
      const response = await diagnosticGet(endpoint, env.GH_TOKEN, transport);
      lastStatus = response.status;
      report.httpStatus[report.phase] = response.status;
      // gh API の GET adapter だけ。公開コマンド・child process に到達する経路は持たない。
      return { status: response.status === 200 ? 0 : 1,
        stdout: Buffer.concat([Buffer.from(`HTTP/1.1 ${response.status} Diagnostic\r\n\r\n`), response.bytes]) };
    };
    await requireNoRelease(run, diagnosticTag, observation => Object.assign(report, observation));
    report.result = "checks-passed";
  } catch (error) { report.failure = failureCode(error, lastStatus, report.targetState); }
  if (report.releases?.complete) report.draftVisibility = report.releases.drafts > 0 ? "draft-returned" : "no-direct-draft-evidence";
  return report;
}

export async function diagnosticMain(options, write = value => console.log(value)) {
  const report = await runDiagnostic(options);
  // raw body / error.message / env を出さず、固定 schema の有限な結果だけを公開ログへ送る。
  write(JSON.stringify(report));
  return report.result === "checks-passed" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await diagnosticMain();
}
