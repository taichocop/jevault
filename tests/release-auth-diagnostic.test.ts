import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { diagnosticGet, diagnosticMain, runDiagnostic, validateDiagnosticContext, validateDiagnosticRequest,
  type Transport } from "../scripts/release-auth-diagnostic.mjs";
import { mockResponse } from "./helpers/release-publication-fixture.mjs";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("node:https", () => ({ request: requestMock }));
afterEach(() => { requestMock.mockReset(); });
const prefix = "repos/taichocop/jevault";
const targetTag = "0.5.2";
const secret = "synthetic-token-never-print";
function environment(): NodeJS.ProcessEnv {
  return { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "taichocop/jevault",
    GITHUB_REPOSITORY_ID: "1377662458", GITHUB_REPOSITORY_OWNER_ID: "103035565", GITHUB_REF: "refs/heads/main",
    GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main", GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_REF: "taichocop/jevault/.github/workflows/release-auth-diagnostic.yml@refs/heads/main",
    GITHUB_WORKFLOW_SHA: "a".repeat(40), GITHUB_RUN_ATTEMPT: "1", GH_TOKEN: secret };
}
function response(status: number, body: unknown, link?: string) {
  return { status, bytes: Buffer.from(JSON.stringify(body)), link };
}
function transport(scenario = "installation") {
  return vi.fn<Transport>(async (url) => {
    const endpoint = url.replace("https://api.github.com/", "").replaceAll(targetTag, "1.2.3");
    const result = mockResponse(endpoint, scenario);
    return { status: result.status, bytes: Buffer.from(JSON.stringify(result.body).replaceAll("1.2.3", targetTag)) };
  });
}

it.each(["installation", "missing-permissions", "owner-metadata"])("diagnoses %s shape without treating GET as write authority", async scenario => {
  const get = transport(scenario);
  const result = await runDiagnostic({ env: environment(), transport: get });
  expect(result).toMatchObject({ result: "checks-passed", context: "verified", targetState: "absent",
    installation: { pages: 1, count: 1, complete: true }, releases: { pages: 1, count: 0, complete: true },
    releaseWritePermission: "not-proven-by-GET", draftVisibility: "no-direct-draft-evidence", publisherVerified: false });
  expect(result.metadata?.push).toBe(scenario === "owner-metadata" ? "true" : "missing");
  expect(get.mock.calls.every(([url, options]) => url.startsWith("https://api.github.com/") && options.method === "GET")).toBe(true);
});

it.each(["visibility", "repo", "repo-id", "owner-id", "installation-repo", "installation-id", "installation-owner",
  "installation-empty", "installation-wide", "installation-count", "installation-malformed", "owner-token"])("fails closed on %s without credential fallback", async scenario => {
  const get = transport(scenario);
  const result = await runDiagnostic({ env: { ...environment(), GITHUB_TOKEN: "synthetic-owner-fallback" }, transport: get });
  expect(result.result).toBe("failed");
  expect(result.publisherVerified).toBe(false);
  expect(get.mock.calls.every(([, options]) => options.headers.Authorization === `Bearer ${secret}`)).toBe(true);
  expect(get.mock.calls.some(([url]) => url.includes("/releases"))).toBe(false);
  if (scenario === "visibility") expect(result).toMatchObject({ metadata: { push: "false" }, failure: "permissions-contradiction" });
  if (scenario === "owner-token") expect(result).toMatchObject({ phase: "installation", failure: "http-403" });
});

it.each(["draft", "release"])("reports existing %s after completing the release listing", async scenario => {
  const get = transport(scenario);
  const result = await runDiagnostic({ env: environment(), transport: get });
  expect(result).toMatchObject({ result: "failed", targetState: scenario, failure: `existing-${scenario}`, releases: { complete: true } });
  expect(get.mock.calls.some(([url]) => url.includes("/releases?"))).toBe(true);
});

it("visits every installation page and rejects a wider scope even when the target appears first", async () => {
  const get = transport("installation-pages");
  const result = await runDiagnostic({ env: environment(), transport: get });
  expect(result.failure).toBe("installation-scope-mismatch");
  expect(get.mock.calls.some(([url]) => url.endsWith("installation/repositories?per_page=100&page=2"))).toBe(true);
  expect(get.mock.calls.some(([url]) => url.includes("/releases"))).toBe(false);
});

it("does not infer success from an incomplete or unavailable second installation page", async () => {
  const get = transport("installation-page-403");
  const result = await runDiagnostic({ env: environment(), transport: get });
  expect(result).toMatchObject({ result: "failed", failure: "http-403", installation: { complete: false } });
});

it.each([false, true])("scans later release pages, including later drafts: %s", async draft => {
  const get = transport(); const original = get.getMockImplementation()!;
  get.mockImplementation(async (url, options) => {
    if (url.endsWith(`${prefix}/releases?per_page=100&page=1`)) return response(200,
      Array.from({ length: 100 }, () => ({ tag_name: "other", draft: false })));
    if (url.endsWith(`${prefix}/releases?per_page=100&page=2`)) return response(200, draft ? [{ tag_name: targetTag, draft: true }] : []);
    return original(url, options);
  });
  const result = await runDiagnostic({ env: environment(), transport: get });
  expect(result.releases).toMatchObject({ pages: 2, complete: true, count: draft ? 101 : 100 });
  expect(result.result).toBe(draft ? "failed" : "checks-passed");
  expect(result.draftVisibility).toBe(draft ? "draft-returned" : "no-direct-draft-evidence");
});

const endpoints = [prefix, "installation/repositories?per_page=100&page=1",
  `${prefix}/releases/tags/${targetTag}`, `${prefix}/releases?per_page=100&page=1`];
it.each(endpoints.flatMap(endpoint => [401, 403, 404, 500, 503].map(status => ({ endpoint, status }))))("distinguishes HTTP failure $status at $endpoint", async ({ endpoint, status }) => {
  const get = transport(); const original = get.getMockImplementation()!;
  get.mockImplementation(async (url, options) => url.endsWith(endpoint)
    ? response(status, { message: "Not Found" }) : original(url, options));
  const result = await runDiagnostic({ env: environment(), transport: get });
  if (status === 404 && endpoint.includes("/releases/tags/")) expect(result.result).toBe("checks-passed");
  else expect(result).toMatchObject({ result: "failed", failure: `http-${status}` });
});

it.each(endpoints)("does not log untrusted body, transport error, token or environment at %s", async endpoint => {
  for (const failure of ["json", "transport", "shape", "utf8"]) {
    const get = transport(); const original = get.getMockImplementation()!;
    get.mockImplementation(async (url, options) => {
      if (!url.endsWith(endpoint)) return original(url, options);
      if (failure === "transport") throw new Error(`Authorization: Bearer ${secret} synthetic-private-notes`);
      return { status: 200, bytes: failure === "json" ? Buffer.from(`invalid ${secret}`)
        : failure === "utf8" ? Buffer.from([255]) : Buffer.from(JSON.stringify({ private: secret })) };
    });
    const logs: string[] = [];
    const code = await diagnosticMain({ env: { ...environment(), PRIVATE_FIXTURE: "synthetic-private-notes" }, transport: get }, text => logs.push(text));
    expect(code).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).not.toContain(secret);
    expect(logs[0]).not.toContain("synthetic-private-notes");
    expect(logs[0]).not.toContain("Authorization");
    expect(JSON.parse(logs[0]).failure).toEqual(failure === "transport" ? "transport-failure"
      : failure === "json" ? "invalid-json" : failure === "utf8" ? "invalid-utf8" : expect.any(String));
  }
});

it.each([301, 302, 303, 307, 308])("refuses HTTP redirect %s without a second request", async status => {
  const get = vi.fn<Transport>(async () => response(status, { location: "https://other.invalid/secret" }));
  const result = await runDiagnostic({ env: environment(), transport: get });
  expect(result.failure).toBe("redirect-refused");
  expect(get).toHaveBeenCalledTimes(1);
});

it("refuses pagination links that contradict completion, skip pages or change the host", async () => {
  for (const [body, link] of [
    [[], `<https://api.github.com/${prefix}/releases?per_page=100&page=2>; rel="next"`],
    [Array.from({ length: 100 }, () => ({ draft: false, tag_name: "other" })), `<https://other.invalid/page=2>; rel="next"`],
    [Array.from({ length: 100 }, () => ({ draft: false, tag_name: "other" })), `<https://api.github.com/${prefix}/releases?per_page=100&page=3>; rel="next"`],
  ] as const) {
    await expect(diagnosticGet(`${prefix}/releases?per_page=100&page=1`, secret,
      async () => response(200, body, link))).rejects.toThrow("pagination-incomplete");
  }
});

it("accepts an exact next-page link but bounds pagination and response size", async () => {
  const rows = Array.from({ length: 100 }, () => ({ draft: false, tag_name: "other" }));
  await expect(diagnosticGet(`${prefix}/releases?per_page=100&page=1`, secret, async () => response(200, rows,
    `<https://api.github.com/${prefix}/releases?per_page=100&page=2>; rel="next"`))).resolves.toMatchObject({ status: 200 });
  await expect(diagnosticGet(prefix, secret, async () => ({ status: 200, bytes: Buffer.alloc(4 * 1024 * 1024 + 1) }))).rejects.toThrow("response-too-large");
  await expect(diagnosticGet(prefix, secret, async () => ({ status: 0, bytes: Buffer.alloc(0) }))).rejects.toThrow("unknown-response");
});

it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD"])("rejects %s requests", method => {
  expect(() => validateDiagnosticRequest(method, prefix)).toThrow("request-refused");
});
it.each(["https://api.github.com/repos/taichocop/jevault", "repos/other/fixture", "graphql", `${prefix}/git/refs`,
  `${prefix}/releases/tags/0.5.3`, `${prefix}/releases?per_page=100&page=0`, `${prefix}/releases?per_page=100&page=1001`,
  `${prefix}/releases?per_page=100&page=1&token=synthetic`, "installation/repositories?per_page=100&page=01"])("rejects non-allowlisted endpoint %s", endpoint => {
  expect(() => validateDiagnosticRequest("GET", endpoint)).toThrow("request-refused");
});

const invalidContexts: NodeJS.ProcessEnv[] = [{ GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_EVENT_NAME: "pull_request_target" },
  { GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/other" }, { GITHUB_REPOSITORY: "other/fixture" },
  { GITHUB_REPOSITORY_ID: "1" }, { GITHUB_REPOSITORY_OWNER_ID: "1" }, { GITHUB_REF_NAME: "other" },
  { GITHUB_REF_TYPE: "tag" }, { GITHUB_WORKFLOW_SHA: "b".repeat(40) }, { GITHUB_SHA: "invalid" },
  { GITHUB_WORKFLOW_REF: "taichocop/jevault/.github/workflows/release.yml@refs/heads/main" },
  { GITHUB_RUN_ATTEMPT: "2" }, { GH_TOKEN: "" }, { GITHUB_ACTIONS: "false" }];
it.each(invalidContexts)("rejects untrusted context %j before any request", async change => {
  const get = transport();
  const result = await runDiagnostic({ env: { ...environment(), ...change }, transport: get });
  expect(result).toMatchObject({ context: "rejected", failure: "context-rejected", result: "failed" });
  expect(get).not.toHaveBeenCalled();
});
it("requires every context field and does not fall back to GITHUB_TOKEN", () => {
  for (const key of Object.keys(environment())) {
    const env: NodeJS.ProcessEnv = { ...environment(), GITHUB_TOKEN: secret }; delete env[key];
    expect(() => validateDiagnosticContext(env)).toThrow("context-rejected");
  }
});

it("uses native HTTPS with GET, fixed host and explicit token, without CLI or proxy fallback", async () => {
  requestMock.mockImplementation((url, options, handle) => {
    expect(url).toBe(`https://api.github.com/${prefix}`);
    expect(options.method).toBe("GET");
    expect(options.headers["User-Agent"]).toBe("jevault-release-auth-diagnostic");
    expect(options.signal).toBeDefined();
    expect(options.headers.Authorization).toBe(`Bearer ${secret}`);
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
      handle(res); res.emit("data", Buffer.from("{}")); res.emit("end");
    };
    return req;
  });
  await expect(diagnosticGet(prefix, secret)).resolves.toMatchObject({ status: 200, bytes: Buffer.from("{}") });
  expect(requestMock).toHaveBeenCalledTimes(1);
});

it("has only dispatch, main guards before checkout, a pinned checkout, and token only on the diagnostic step", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release-auth-diagnostic.yml", import.meta.url), "utf8");
  expect(workflow.match(/on:\n([\s\S]*?)\npermissions:/)?.[1].trim()).toBe("workflow_dispatch:");
  expect(workflow).toContain("permissions: {}");
  expect(workflow.match(/ {4}permissions:\n([\s\S]*?) {4}steps:/)?.[1].trim()).toBe("contents: write");
  expect(workflow.match(/\$\{\{ github.token \}\}/g)).toHaveLength(1);
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("ref: ${{ github.sha }}");
  expect(workflow).toContain("actions/checkout@11d5960a326750d5838078e36cf38b85af677262");
  expect(workflow).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
  expect(workflow).not.toMatch(/npm |upload-artifact|id-token:|attestations:|release create|inputs:|pull_request/);
  const guard = workflow.match(/ {8}run: \|\n([\s\S]*?) {6}- uses:/)![1].split("\n").map(line => line.replace(/^ {10}/, "")).join("\n");
  for (const sha of ["a".repeat(40), "c".repeat(40)]) {
    expect(spawnSync("/bin/bash", ["-c", guard], {
      env: { ...environment(), GITHUB_SHA: sha, GITHUB_WORKFLOW_SHA: sha },
    }).status).toBe(0);
  }
  for (const change of invalidContexts.filter(change => !("GH_TOKEN" in change) && !("GITHUB_ACTIONS" in change))) {
    expect(spawnSync("/bin/bash", ["-c", guard], { env: { ...environment(), ...change } }).status).not.toBe(0);
  }
});

it("shares checks while keeping the diagnostic import graph free of publisher and write-capable dependencies", async () => {
  const diagnostic = await readFile(new URL("../scripts/release-auth-diagnostic.mjs", import.meta.url), "utf8");
  const shared = await readFile(new URL("../scripts/release-auth-readonly.mjs", import.meta.url), "utf8");
  const publisher = await readFile(new URL("../scripts/publish-release.mjs", import.meta.url), "utf8");
  expect(diagnostic).toContain('from "./release-auth-readonly.mjs"');
  expect(publisher).toContain('from "./release-auth-readonly.mjs"');
  expect(diagnostic).not.toMatch(/from "(?:\.\/publish-release|node:child_process|node:fs)/);
  expect(shared).not.toMatch(/from "(?:node:child_process|node:fs|\.\/publish-release)/);
  expect(shared).not.toContain('"create"');
});


it("reports both a release and draft for the target rather than overwriting one observation", async () => {
  const get = transport("release"); const original = get.getMockImplementation()!;
  get.mockImplementation(async (url, options) => url.includes("/releases?")
    ? response(200, [{ tag_name: targetTag, draft: true }]) : original(url, options));
  expect(await runDiagnostic({ env: environment(), transport: get })).toMatchObject({ result: "failed",
    targetState: "draft-and-release", failure: "existing-draft-and-release", draftVisibility: "draft-returned" });
});

it.each(["error", "aborted", "redirect", "oversize"])("fails closed at the native transport boundary: %s", async failure => {
  requestMock.mockImplementation((_url, _options, handle) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
    req.destroy = error => { req.emit("error", error); };
    req.end = () => {
      if (failure === "error") { req.emit("error", new Error(`Authorization ${secret}`)); return; }
      const res = Object.assign(new EventEmitter(), { statusCode: failure === "redirect" ? 302 : 200, headers: {}, resume: vi.fn() });
      handle(res);
      if (failure === "aborted") res.emit("aborted");
      if (failure === "oversize") res.emit("data", Buffer.alloc(4 * 1024 * 1024 + 1));
    };
    return req;
  });
  const logs: string[] = [];
  expect(await diagnosticMain({ env: environment() }, text => logs.push(text))).toBe(1);
  expect(JSON.parse(logs[0]).failure).toBe(failure === "redirect" ? "redirect-refused" : failure === "oversize" ? "response-too-large" : "transport-failure");
  expect(logs[0]).not.toContain(secret);
  expect(requestMock).toHaveBeenCalledTimes(1);
});


it("accepts a new reviewed main SHA after squash merge without a hard-coded baseline", async () => {
  const sha = "c".repeat(40);
  expect(await runDiagnostic({ env: { ...environment(), GITHUB_SHA: sha, GITHUB_WORKFLOW_SHA: sha },
    transport: transport() })).toMatchObject({ context: "verified", result: "checks-passed" });
});
