import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createSecureContext, TLSSocket } from "node:tls";
import { fileURLToPath } from "node:url";
import { buildReleaseArguments, publishRelease, runCommand, parseApiResponse, publicationEnvironment } from "./publish-release.mjs";
import { authenticationFailures, annotation, commit, fakeGit, mockResponse, releaseFixture, rawTag, tag } from "../tests/helpers/release-publication-fixture.mjs";
import { lifecycleCases, releaseLifecycle } from "../tests/helpers/release-cli-lifecycle.mjs";

export async function validateReleaseCli(binary = "gh") {
  const root = await releaseFixture();
  const config = await mkdtemp(path.join(tmpdir(), "jevault-cli-mock-"));
  const sockets = new Set();
  const requests = [];
  let scenario = "allowed";
  const authenticationShapes = [];
  const negativeScenarios = ["draft", "release", "401", "403", "500", "repo", "visibility", "tag", "commit",
    "annotation", "malformed", "network", ...authenticationFailures, "metadata-network", "installation-network", "release-tag-network", "release-list-network"];
  let lifecycle;
  let mockFailure;
  const rejectedConnections = [];
  const mock = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    let body;
    try { body = bytes.length ? JSON.parse(bytes.toString("utf8")) : undefined; } catch { body = undefined; }
    const entry = { method: request.method, url: request.url, body, blocked: false };
    requests.push(entry);
    if ((scenario === "metadata-network" && request.url === "/repos/taichocop/jevault")
      || (scenario === "release-tag-network" && request.url === `/repos/taichocop/jevault/releases/tags/${tag}`)
      || (scenario === "installation-network" && request.url.startsWith("/installation/repositories?"))
      || (scenario === "release-list-network" && request.url.startsWith("/repos/taichocop/jevault/releases?"))) {
      response.destroy(); return;
    }
    if (scenario === "network") { response.destroy(); return; }
    if (scenario === "malformed") { response.writeHead(200); response.end("invalid JSON"); return; }
    response.setHeader("Content-Type", "application/json");
    if (!["api.github.com", "uploads.github.com"].includes(request.headers.host)) {
      entry.blocked = true; response.writeHead(403); response.end('{"message":"Mock host rejected"}'); return;
    }
    // ghの--verify-tagはPOSTで読取GraphQL queryを送る。mutationと未知のPOSTは全拒否する。
    if (request.headers.host === "api.github.com" && request.method === "POST" && request.url === "/graphql"
      && /^query RepositoryFindRef\b/.test(body?.query ?? "") && !/\bmutation\b/.test(body.query)
      && body.variables?.owner === "taichocop" && body.variables?.name === "jevault"
      && body.variables?.tagName === `refs/tags/${tag}`) {
      response.writeHead(200); response.end(JSON.stringify({ data: { repository: { ref: { id: "synthetic-ref" } } } })); return;
    }
    if (lifecycle) {
      try {
        const result = await lifecycle.handle({ method: request.method, url: request.url,
          host: request.headers.host, body, bytes });
        if (result.drop) { response.destroy(); return; }
        response.writeHead(result.status); response.end(request.method === "HEAD" ? undefined : JSON.stringify(result.body));
      } catch (error) {
        mockFailure = error;
        response.writeHead(500); response.end('{"message":"Synthetic fixture assertion failed"}');
      }
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      // 転送・Release作成・asset upload・cleanupは実装しない。最初の書込境界で止める。
      entry.blocked = true; response.writeHead(409); response.end('{"message":"Mock write boundary blocked"}'); return;
    }
    const result = mockResponse(request.url.slice(1), scenario);
    response.writeHead(result.status); response.end(request.method === "HEAD" ? undefined : JSON.stringify(result.body));
  });
  const proxy = http.createServer((_request, response) => { response.writeHead(403); response.end(); });
  const track = (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); };
  proxy.on("connection", track);
  try {
    const key = path.join(config, "synthetic-key.pem");
    const cert = path.join(config, "synthetic-cert.pem");
    const generated = await runCommand("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-subj", "/CN=api.github.com", "-addext", "subjectAltName=DNS:api.github.com,DNS:uploads.github.com", "-days", "1", "-keyout", key, "-out", cert]);
    assert.equal(generated.status, 0, "Synthetic TLS fixture generation failed");
    const context = createSecureContext({ key: await readFile(key), cert: await readFile(cert) });
    proxy.on("connect", (request, socket, head) => {
      if (!["api.github.com:443", "uploads.github.com:443"].includes(request.url) || head.length !== 0) {
        rejectedConnections.push(request.url); socket.destroy(); return;
      }
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      const secure = new TLSSocket(socket, { isServer: true, secureContext: context });
      secure.on("error", () => secure.destroy());
      track(secure);
      mock.emit("connection", secure);
    });
    await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve); });
    const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
    // 親の認証環境は継承しない。全HTTPは転送能力のないloopback proxyへ固定する。
    const env = { ...publicationEnvironment({ PATH: process.env.PATH, GH_TOKEN: "synthetic-mock-token",
      GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "taichocop/jevault",
      GITHUB_REPOSITORY_ID: "1377662458", GITHUB_REPOSITORY_OWNER_ID: "103035565",
      GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: tag, GITHUB_REF: `refs/tags/${tag}`, GITHUB_SHA: commit,
      GITHUB_WORKFLOW_REF: `taichocop/jevault/.github/workflows/release.yml@refs/tags/${tag}`,
      GITHUB_WORKFLOW_SHA: commit, GITHUB_RUN_ATTEMPT: "1" }, config),
      HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, ALL_PROXY: proxyUrl, NO_PROXY: "", SSL_CERT_FILE: cert };
    const cli = (args) => runCommand(binary, args, { cwd: root, env });
    const version = await cli(["--version"]);
    assert.equal(version.status, 0);
    assert.match(version.stdout.toString(), /^gh version 2\.102\.0 /);
    const incompatible = await cli(["release", "create", tag, "release-assets/main.js",
      "--repo", "taichocop/jevault", "--notes-from-tag"]);
    assert.notEqual(incompatible.status, 0);
    assert.match(incompatible.stderr.toString(), /using `--notes-from-tag` with `--repo` is not supported/);
    assert.equal(requests.length, 0, "Forbidden flags must fail before any request");
    const missingNotes = await cli(buildReleaseArguments(tag, path.join(root, "missing-notes.txt")));
    assert.notEqual(missingNotes.status, 0);
    assert.equal(requests.length, 0, "Missing notes must fail before any request");
    const run = (command, args) => command === "git" ? Promise.resolve(fakeGit(args)) : cli(args);
    await assert.rejects(publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run), /Release creation failed/);
    const writes = requests.filter((entry) => entry.blocked);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, "POST");
    assert.equal(writes[0].url, "/repos/taichocop/jevault/releases");
    assert.equal(writes[0].body.tag_name, tag);
    assert.equal(writes[0].body.name, `Jevault ${tag}`);
    assert.equal(writes[0].body.draft, true);
    assert.equal(writes[0].body.prerelease, false);
    assert.ok(Buffer.from(writes[0].body.body, "utf8").equals(annotation), "CLI JSON body must preserve annotation bytes");
    assert.ok(requests.some((entry) => entry.url === "/graphql" && !entry.blocked), "Real CLI tag verification must run");
    assert.deepEqual(buildReleaseArguments(tag, "/synthetic/notes.txt").slice(3, 6),
      ["release-assets/main.js", "release-assets/manifest.json", "release-assets/styles.css"]);
    for (scenario of ["owner-metadata", "installation", "missing-permissions"]) {
      requests.length = 0;
      await assert.rejects(publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run), /Release creation failed/);
      assert.equal(requests.filter(entry => entry.blocked).length, 1);
      assert.ok(requests.some(entry => entry.url.startsWith("/installation/repositories?")));
      authenticationShapes.push(scenario);
    }
    for (scenario of negativeScenarios) {
      requests.length = 0;
      await assert.rejects(publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run));
      assert.equal(requests.filter((entry) => entry.blocked).length, 0, `${scenario} must fail before any write request`);
      assert.ok(requests.length > 0, "Negative scenario must use the real CLI API client");
      if (scenario.startsWith("installation-page")) {
        assert.ok(requests.some(entry => entry.url === "/installation/repositories?per_page=100&page=2"));
      }
    }
    scenario = "allowed";
    const invalidInputs = [];
    for (const invalid of ["invalid-tag", "invalid-notes", "invalid-digest"]) {
      requests.length = 0;
      const css = path.join(root, "release-assets", "styles.css");
      const original = await readFile(css);
      if (invalid === "invalid-digest") await writeFile(css, "changed synthetic bytes");
      const invalidRun = (command, args) => command === "git"
        ? Promise.resolve(invalid === "invalid-notes" && args[0] === "cat-file"
          ? { status: 0, stdout: rawTag(Buffer.from(" \n")) } : fakeGit(args)) : cli(args);
      try {
        await assert.rejects(publishRelease({ root, tag: invalid === "invalid-tag" ? "v1.2.3" : tag,
          commit, repository: "taichocop/jevault" }, invalidRun));
        assert.equal(requests.length, 0, "Invalid local inputs must fail before any HTTP request");
        invalidInputs.push(invalid);
      } finally { await writeFile(css, original); }
    }
    const assets = Object.fromEntries(await Promise.all(["main.js", "manifest.json", "styles.css"].map(async (name) =>
      [name, await readFile(path.join(root, "release-assets", name))])));
    const results = [];
    // helperのCLI呼出しは1回でも、CLI内部のupload retryとcleanupは実際に観測する。
    for (const expected of lifecycleCases) {
      requests.length = 0;
      rejectedConnections.length = 0;
      mockFailure = undefined;
      lifecycle = releaseLifecycle(expected.name, assets);
      let succeeded = false;
      try { await publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run); succeeded = true; }
      catch (error) { assert.match(error.message, /Release creation failed/); }
      if (mockFailure) throw mockFailure;
      assert.equal(succeeded, expected.ok === true, expected.name);
      const observed = lifecycle.snapshot();
      const count = (method, host) => observed.requests.filter((entry) => entry.method === method && entry.host === host).length;
      const writes = { create: count("POST", "api.github.com"), upload: count("POST", "uploads.github.com"),
        patch: count("PATCH", "api.github.com"), delete: count("DELETE", "api.github.com") };
      assert.deepEqual(writes, { create: 1, upload: expected.uploads, patch: expected.patch, delete: expected.remove }, expected.name);
      assert.equal(observed.state, expected.state, expected.name);
      assert.equal(observed.assets.length, expected.assetCount, expected.name);
      if (expected.beforeDelete !== undefined) assert.equal(observed.assetsBeforeDelete.length, expected.beforeDelete, expected.name);
      if (expected.name.includes("exhausted")) assert.equal(observed.attempts["styles.css"], 4, "Initial upload plus three CLI retries");
      if (expected.uploads === 4) assert.equal(observed.attempts["styles.css"], 2, "Exactly one CLI upload retry");
      assert.equal(observed.published, expected.patch === 1 && expected.name !== "publish-rejected"
        && expected.name !== "publish-response-lost-before-commit", expected.name);
      assert.equal(rejectedConnections.length > 0, expected.name === "unexpected-upload-host", `${expected.name}: ${JSON.stringify(rejectedConnections)}`);
      let readBack;
      if (expected.name.startsWith("publish-response-lost") || expected.name === "publish-result-unknown"
        || expected.name === "create-response-lost") {
        const response = await cli(["api", "--include", `repos/taichocop/jevault/releases/tags/${tag}`]);
        try { readBack = parseApiResponse(response).status === 200 ? "exists" : "absent"; }
        catch { readBack = "unknown"; }
        assert.equal(readBack, expected.name === "publish-result-unknown" ? "unknown"
          : ["draft", "published"].includes(expected.state) ? "exists" : "absent");
      }
      if (mockFailure) throw mockFailure;
      results.push({ scenario: expected.name, succeeded, writes, uploadAttempts: observed.attempts,
        finalMockState: observed.state, assets: observed.assets, assetsBeforeDelete: observed.assetsBeforeDelete,
        publishWasApplied: observed.published, readBack, unexpectedHostBlocked: rejectedConnections.length > 0 });
    }
    return { cli: "2.102.0", negativeScenarios: negativeScenarios.length, authenticationShapes, runnerAuthenticationVerified: false, invalidInputs, writeRequestsBlocked: 1,
      annotationExact: true, lifecycle: results, realGitHubWrites: 0 };
  } finally {
    for (const socket of sockets) socket.destroy();
    if (proxy.listening) await new Promise((resolve) => proxy.close(resolve));
    await Promise.all([rm(root, { recursive: true, force: true }), rm(config, { recursive: true, force: true })]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await validateReleaseCli(process.argv[2]))); }
  catch { console.error("Non-publishing CLI validation failed."); process.exitCode = 1; }
}
