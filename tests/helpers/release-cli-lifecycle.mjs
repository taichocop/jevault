import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { URL } from "node:url";
import { annotation, mockResponse, tag } from "./release-publication-fixture.mjs";

const prefix = "/repos/taichocop/jevault/releases";
const releasePath = `${prefix}/1`;
const uploadPath = `${releasePath}/assets`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

// 実API clientではない。固定routeの応答と状態をメモリ内だけで再現する。
export function releaseLifecycle(scenario, assets) {
  let release;
  let deleted = false;
  let published = false;
  let assetsBeforeDelete = [];
  let siblingUploads;
  const siblings = new Promise((resolve) => { siblingUploads = resolve; });
  const attempts = {};
  const requests = [];
  const respond = (status, body = {}) => ({ status, body });
  const drop = () => ({ drop: true });
  const releaseBody = () => ({ id: 1, tag_name: tag, draft: release.draft, immutable: release.immutable,
    url: `https://api.github.com${releasePath}`,
    html_url: `https://github.com/taichocop/jevault/releases/tag/${tag}`,
    upload_url: `https://${scenario === "unexpected-upload-host" ? "blocked.invalid" : "uploads.github.com"}${uploadPath}{?name,label}`,
    assets: release.assets });
  const snapshot = () => ({ state: release ? (release.draft ? "draft" : "published") : (deleted ? "deleted" : "absent"),
    assets: release?.assets.map((asset) => asset.name).sort() ?? [], assetsBeforeDelete, published,
    attempts: { ...attempts }, requests: requests.map((entry) => ({ ...entry })) });

  async function handle({ method, url, host, body, bytes }) {
    const entry = { method, host, url, status: undefined, dropped: false };
    requests.push(entry);
    const finish = (result) => { entry.status = result.status; entry.dropped = result.drop === true; return result; };
    if (!["api.github.com", "uploads.github.com"].includes(host)) return finish(respond(403));
    const parsed = new URL(url, `https://${host}`);
    if (host === "uploads.github.com") {
      if (method !== "POST" || parsed.pathname !== uploadPath || !release) return finish(respond(403));
      const name = parsed.searchParams.get("name");
      assert.ok(Object.hasOwn(assets, name), "Unknown synthetic asset");
      assert.equal(parsed.searchParams.get("label"), "");
      assert.equal(digest(bytes), digest(assets[name]), "CLI upload must preserve fixture bytes");
      attempts[name] = (attempts[name] ?? 0) + 1;
      const attempt = attempts[name];
      const failingAsset = name === "styles.css";
      if (failingAsset && ["partial-upload-failure", "cleanup-failure"].includes(scenario)) {
        // 並行uploadの順序は仮定せず、2資産成功後の失敗を確実に再現する。
        await siblings;
        return finish(respond(422, { message: "Synthetic upload rejection" }));
      }
      if (failingAsset && scenario === "upload-5xx-once" && attempt === 1) return finish(respond(500));
      if (failingAsset && scenario === "upload-network-once" && attempt === 1) return finish(drop());
      if (failingAsset && scenario === "upload-5xx-exhausted") return finish(respond(500));
      if (failingAsset && scenario === "upload-network-exhausted") return finish(drop());
      if (release.assets.some((asset) => asset.name === name)) {
        return finish(respond(422, { message: "Validation Failed", errors: [{ code: "already_exists" }] }));
      }
      const asset = { id: release.assets.length + 10, name, size: bytes.length, digest: `sha256:${digest(bytes)}` };
      release.assets.push(asset);
      if (release.assets.filter((item) => item.name !== "styles.css").length === 2) siblingUploads();
      // 受理済みuploadの応答喪失は、再送時に重複として拒否する。上書きしない。
      if (failingAsset && scenario === "duplicate-asset" && attempt === 1) return finish(drop());
      return finish(respond(201, asset));
    }
    if (method === "POST" && url === prefix) {
      assert.equal(body.tag_name, tag);
      assert.equal(body.draft, true);
      assert.equal(body.prerelease, false);
      assert.equal(body.name, `Jevault ${tag}`);
      assert.ok(Buffer.from(body.body).equals(annotation), "Exact annotation required");
      if (release) return finish(respond(422));
      if (scenario === "create-rejected") return finish(respond(500));
      release = { draft: true, immutable: false, assets: [] };
      if (scenario === "create-response-lost") return finish(drop());
      return finish(respond(201, releaseBody()));
    }
    if (method === "PATCH" && url === releasePath && release) {
      assert.equal(body.draft, false);
      assert.equal(release.assets.length, 3);
      if (scenario === "publish-rejected") return finish(respond(500));
      if (scenario === "publish-response-lost-before-commit") return finish(drop());
      release.draft = false;
      release.immutable = scenario !== "publish-response-lost-mutable";
      published = true;
      if (scenario.startsWith("publish-response-lost") || scenario === "publish-result-unknown") return finish(drop());
      return finish(respond(200, releaseBody()));
    }
    if (method === "DELETE" && url === releasePath && release) {
      assetsBeforeDelete = release.assets.map((asset) => asset.name).sort();
      if (scenario === "cleanup-failure") return finish(respond(500));
      if (scenario === "publish-result-unknown") return finish(drop());
      if (release.immutable) return finish(respond(403, { message: "Synthetic immutable release" }));
      release = undefined;
      deleted = true;
      return finish(respond(204));
    }
    if (["GET", "HEAD"].includes(method)) {
      if (url === `${prefix}/tags/${tag}` && release) {
        return finish(scenario === "publish-result-unknown" ? respond(503) : respond(200, releaseBody()));
      }
      if (url.startsWith(`${prefix}?`) && release) return finish(respond(200, [releaseBody()]));
      return finish(mockResponse(url.slice(1)));
    }
    return finish(respond(403, { message: "Unexpected mock write route" }));
  }
  return { handle, snapshot };
}

// 期待するHTTP回数はCLIの実行結果と独立に固定する。全件loopback内の合成状態。
export const lifecycleCases = [
  { name: "success", ok: true, uploads: 3, patch: 1, remove: 0, state: "published", assetCount: 3 },
  { name: "create-rejected", uploads: 0, patch: 0, remove: 0, state: "absent", assetCount: 0 },
  { name: "create-response-lost", uploads: 0, patch: 0, remove: 0, state: "draft", assetCount: 0 },
  { name: "upload-5xx-once", ok: true, uploads: 4, patch: 1, remove: 0, state: "published", assetCount: 3 },
  { name: "upload-network-once", ok: true, uploads: 4, patch: 1, remove: 0, state: "published", assetCount: 3 },
  { name: "upload-5xx-exhausted", uploads: 6, patch: 0, remove: 1, state: "deleted", assetCount: 0, beforeDelete: 2 },
  { name: "upload-network-exhausted", uploads: 6, patch: 0, remove: 1, state: "deleted", assetCount: 0, beforeDelete: 2 },
  { name: "partial-upload-failure", uploads: 3, patch: 0, remove: 1, state: "deleted", assetCount: 0, beforeDelete: 2 },
  { name: "cleanup-failure", uploads: 3, patch: 0, remove: 1, state: "draft", assetCount: 2, beforeDelete: 2 },
  { name: "duplicate-asset", uploads: 4, patch: 0, remove: 1, state: "deleted", assetCount: 0, beforeDelete: 3 },
  { name: "publish-rejected", uploads: 3, patch: 1, remove: 1, state: "deleted", assetCount: 0, beforeDelete: 3 },
  { name: "publish-response-lost-before-commit", uploads: 3, patch: 1, remove: 1, state: "deleted", assetCount: 0, beforeDelete: 3 },
  { name: "publish-response-lost", uploads: 3, patch: 1, remove: 1, state: "published", assetCount: 3, beforeDelete: 3 },
  { name: "publish-response-lost-mutable", uploads: 3, patch: 1, remove: 1, state: "deleted", assetCount: 0, beforeDelete: 3 },
  { name: "publish-result-unknown", uploads: 3, patch: 1, remove: 1, state: "published", assetCount: 3, beforeDelete: 3 },
  { name: "unexpected-upload-host", uploads: 0, patch: 0, remove: 1, state: "deleted", assetCount: 0, beforeDelete: 0 },
];
