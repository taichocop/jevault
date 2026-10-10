import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import console from "node:console";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createSecureContext, TLSSocket } from "node:tls";
import { fileURLToPath } from "node:url";
import { buildReleaseArguments, publishRelease, runCommand } from "./publish-release.mjs";
import { annotation, commit, fakeGit, mockResponse, releaseFixture, tag } from "../tests/helpers/release-publication-fixture.mjs";

export async function validateReleaseCli(binary = "gh") {
  const root = await releaseFixture();
  const config = await mkdtemp(path.join(tmpdir(), "jevault-cli-mock-"));
  const sockets = new Set();
  const requests = [];
  let scenario = "allowed";
  const mock = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    let body;
    try { body = bytes.length ? JSON.parse(bytes.toString("utf8")) : undefined; } catch { body = undefined; }
    const entry = { method: request.method, url: request.url, body, blocked: false };
    requests.push(entry);
    if (scenario === "network") { response.destroy(); return; }
    if (scenario === "malformed") { response.writeHead(200); response.end("invalid JSON"); return; }
    response.setHeader("Content-Type", "application/json");
    if (request.headers.host !== "api.github.com") {
      entry.blocked = true; response.writeHead(403); response.end('{"message":"Mock host rejected"}'); return;
    }
    // ghの--verify-tagはPOSTで読取GraphQL queryを送る。mutationと未知のPOSTは全拒否する。
    if (request.method === "POST" && request.url === "/graphql"
      && /^query RepositoryFindRef\b/.test(body?.query ?? "") && !/\bmutation\b/.test(body.query)
      && body.variables?.owner === "taichocop" && body.variables?.name === "jevault"
      && body.variables?.tagName === `refs/tags/${tag}`) {
      response.writeHead(200); response.end(JSON.stringify({ data: { repository: { ref: { id: "synthetic-ref" } } } })); return;
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
      "-subj", "/CN=api.github.com", "-addext", "subjectAltName=DNS:api.github.com", "-days", "1", "-keyout", key, "-out", cert]);
    assert.equal(generated.status, 0, "Synthetic TLS fixture generation failed");
    const context = createSecureContext({ key: await readFile(key), cert: await readFile(cert) });
    proxy.on("connect", (request, socket, head) => {
      if (request.url !== "api.github.com:443" || head.length !== 0) { socket.destroy(); return; }
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      const secure = new TLSSocket(socket, { isServer: true, secureContext: context });
      secure.on("error", () => secure.destroy());
      track(secure);
      mock.emit("connection", secure);
    });
    await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve); });
    const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
    // 親の認証環境は継承しない。全HTTPは転送能力のないloopback proxyへ固定する。
    const env = { PATH: process.env.PATH, GH_TOKEN: "synthetic-mock-token", GH_CONFIG_DIR: config,
      GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
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
    for (scenario of ["draft", "release", "401", "403", "500", "repo", "visibility", "tag", "commit", "annotation", "malformed", "network"]) {
      requests.length = 0;
      await assert.rejects(publishRelease({ root, tag, commit, repository: "taichocop/jevault" }, run));
      assert.equal(requests.filter((entry) => entry.blocked).length, 0, `${scenario} must fail before any write request`);
      assert.ok(requests.length > 0, "Negative scenario must use the real CLI API client");
    }
    return { cli: "2.102.0", negativeScenarios: 12, writeRequestsBlocked: 1,
      annotationExact: true, releaseDraftAssetTagAttestationCreated: 0 };
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
