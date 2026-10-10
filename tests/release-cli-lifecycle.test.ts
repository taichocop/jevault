import { expect, it } from "vitest";
import { annotation, tag } from "./helpers/release-publication-fixture.mjs";
import { releaseLifecycle } from "./helpers/release-cli-lifecycle.mjs";

const prefix = "/repos/taichocop/jevault/releases";
const bytes = { "main.js": Buffer.from("synthetic"), "manifest.json": Buffer.from("{}"), "styles.css": Buffer.from(".fixture {}") };
const create = { method: "POST", host: "api.github.com", url: prefix,
  body: { tag_name: tag, draft: true, prerelease: false, name: `Jevault ${tag}`, body: annotation.toString() } };
const upload = (name: string, body = bytes[name as keyof typeof bytes]) => ({ method: "POST", host: "uploads.github.com",
  url: `${prefix}/1/assets?name=${name}&label=`, bytes: body });

it("rejects unknown destinations and write routes without changing synthetic release state", async () => {
  const model = releaseLifecycle("success", bytes);
  for (const request of [
    { ...create, host: "github.com" },
    { ...create, url: "/repos/other/fixture/releases" },
    { ...create, url: "/graphql", body: { body: "mutation { createRelease }" } },
    { method: "DELETE", host: "api.github.com", url: "/repos/taichocop/jevault/git/refs/tags/1.2.3" },
  ]) expect((await model.handle(request)).status).toBe(403);
  expect(model.snapshot().state).toBe("absent");
});

it("rejects corrupted notes and upload bytes rather than reporting a successful lifecycle", async () => {
  const model = releaseLifecycle("success", bytes);
  await expect(model.handle({ ...create, body: { ...create.body, body: annotation.toString().trimEnd() } })).rejects.toThrow();
  expect(model.snapshot().state).toBe("absent");
  await model.handle(create);
  await expect(model.handle(upload("main.js", Buffer.from("changed")))).rejects.toThrow("preserve fixture bytes");
  await expect(model.handle(upload("fourth.txt", Buffer.from("extra")))).rejects.toThrow("Unknown synthetic asset");
  expect(model.snapshot().assets).toEqual([]);
});

it("does not overwrite an accepted asset when an upload response is lost and retried", async () => {
  const model = releaseLifecycle("duplicate-asset", bytes);
  await model.handle(create);
  expect((await model.handle(upload("styles.css"))).drop).toBe(true);
  expect((await model.handle(upload("styles.css"))).status).toBe(422);
  expect(model.snapshot().assets).toEqual(["styles.css"]);
  expect(model.snapshot().attempts["styles.css"]).toBe(2);
});

it("distinguishes publication that took effect from an unknown client read-back", async () => {
  const model = releaseLifecycle("publish-result-unknown", bytes);
  await model.handle(create);
  for (const name of Object.keys(bytes)) await model.handle(upload(name));
  expect((await model.handle({ method: "PATCH", host: "api.github.com", url: `${prefix}/1`, body: { draft: false } })).drop).toBe(true);
  expect((await model.handle({ method: "DELETE", host: "api.github.com", url: `${prefix}/1` })).drop).toBe(true);
  expect((await model.handle({ method: "GET", host: "api.github.com", url: `${prefix}/tags/${tag}` })).status).toBe(503);
  expect(model.snapshot()).toMatchObject({ state: "published", published: true });
});
