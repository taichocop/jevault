import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import {
  isProtectedRuleset, parseRulesetPages, readRulesetApi, requireProtectedReleaseTags,
  type RulesetApi,
} from "../scripts/require-protected-release-tags.mjs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

function ruleset(id = 17) {
  return {
    id, target: "tag", enforcement: "active",
    conditions: { ref_name: { include: ["~ALL"], exclude: [] as string[] } },
    rules: [{ type: "update" }, { type: "deletion" }],
  };
}

function fakeApi(pages: unknown, details: Record<number, unknown>) {
  return vi.fn<RulesetApi>((endpoint, paginate) => {
    if (paginate) return JSON.stringify(pages);
    const id = Number(endpoint.split("/").at(-1));
    if (!Object.prototype.hasOwnProperty.call(details, id)) throw new Error("Synthetic API failure");
    return JSON.stringify(details[id]);
  });
}

it("discovers protection by semantics across pages, without a fixed ID", () => {
  const disabled = { ...ruleset(91), enforcement: "disabled" };
  const api = fakeApi([[{ id: 91, target: "tag" }], [], [{ id: 203, target: "tag" }]], {
    91: disabled, 203: ruleset(203),
  });
  expect(requireProtectedReleaseTags(api)).toEqual([203]);
  expect(api.mock.calls).toEqual([
    ["repos/taichocop/jevault/rulesets?targets=tag&per_page=100", true],
    ["repos/taichocop/jevault/rulesets/91"],
    ["repos/taichocop/jevault/rulesets/203"],
  ]);
});

it("accepts documented summaries without target but requires tag in details", () => {
  expect(requireProtectedReleaseTags(fakeApi([[{ id: 17 }]], { 17: ruleset() }))).toEqual([17]);
  const api = fakeApi([[{ id: 17 }]], { 17: { ...ruleset(), target: "branch" } });
  expect(() => requireProtectedReleaseTags(api)).toThrow("Malformed");
});

it.each(["disabled", "evaluate"])("rejects %s protection", (enforcement) => {
  const api = fakeApi([[{ id: 17, target: "tag" }]], { 17: { ...ruleset(), enforcement } });
  expect(() => requireProtectedReleaseTags(api)).toThrow("Active all-tag");
});

it.each(["update", "deletion"])("rejects missing %s restriction", (missing) => {
  const value = ruleset();
  value.rules = value.rules.filter((rule) => rule.type !== missing);
  expect(isProtectedRuleset(value, 17)).toBe(false);
});

it("rejects a ref exclusion even with all-tag coverage", () => {
  const value = ruleset();
  value.conditions.ref_name.exclude = ["refs/tags/0.5.0"];
  expect(isProtectedRuleset(value, 17)).toBe(false);
});

it("rejects partial coverage", () => {
  const value = ruleset();
  value.conditions.ref_name.include = ["refs/tags/0.*"];
  expect(isProtectedRuleset(value, 17)).toBe(false);
});

it("fails closed when no tag ruleset exists", () => {
  expect(() => requireProtectedReleaseTags(fakeApi([[]], {}))).toThrow("Active all-tag");
});

it.each([
  null, {}, [], [null], [[null]], [[{}]], [[{ id: "17", target: "tag" }]],
  [[{ id: 0, target: "tag" }]], [[{ id: -1, target: "tag" }]],
  [[{ id: 1.5, target: "tag" }]], [[{ id: Number.MAX_SAFE_INTEGER + 1, target: "tag" }]],
  [[{ id: 17, target: "tag" }], [{ id: 17, target: "tag" }]],
])("fails closed on malformed page structure: %j", (pages) => {
  expect(() => parseRulesetPages(JSON.stringify(pages))).toThrow("Malformed");
});

it.each([
  null, [], {}, { ...ruleset(), id: 18 }, { ...ruleset(), target: "branch" },
  { ...ruleset(), enforcement: "unknown" }, { ...ruleset(), conditions: {} },
  { ...ruleset(), conditions: { ref_name: { include: ["~ALL"] } } },
  { ...ruleset(), conditions: { ref_name: { include: "~ALL", exclude: [] } } },
  { ...ruleset(), conditions: { ref_name: { include: ["~ALL"], exclude: [null] } } },
  { ...ruleset(), rules: null }, { ...ruleset(), rules: [null] },
  { ...ruleset(), rules: [{ type: 1 }] },
])("fails closed on malformed detail response: %j", (value) => {
  expect(() => isProtectedRuleset(value, 17)).toThrow("Malformed");
});

it("rejects malformed JSON for both listing and details", () => {
  expect(() => parseRulesetPages("[broken")).toThrow("Malformed");
  expect(() => requireProtectedReleaseTags((endpoint, paginate) => paginate
    ? JSON.stringify([[{ id: 17, target: "tag" }]]) : "[broken")).toThrow("Malformed");
});

it("does not ignore a later malformed response after finding protection", () => {
  const pages = [[{ id: 17, target: "tag" }], [{ id: 18, target: "tag" }]];
  expect(() => requireProtectedReleaseTags(fakeApi(pages, { 17: ruleset(), 18: {} }))).toThrow("Malformed");
  expect(() => requireProtectedReleaseTags(fakeApi(pages, { 17: ruleset() }))).toThrow("Synthetic API failure");
});

it("uses supported GET pagination flags and preserves API failures", () => {
  const exec = vi.mocked(execFileSync);
  exec.mockReturnValueOnce("[[{\"id\":17,\"target\":\"tag\"}]]");
  expect(readRulesetApi("repos/taichocop/jevault/rulesets?targets=tag&per_page=100", true)).toContain("17");
  expect(exec.mock.lastCall?.slice(0, 2)).toEqual([
    "gh", ["api", "--method", "GET", "--paginate", "--slurp",
      "repos/taichocop/jevault/rulesets?targets=tag&per_page=100"],
  ]);
  exec.mockImplementationOnce(() => { throw new Error("Synthetic API failure"); });
  expect(() => readRulesetApi("repos/taichocop/jevault/rulesets/17")).toThrow("API request failed");
});

it("keeps validation read-only and leaves publication exclusive to tag push", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const [validation, release] = workflow.split("  release:\n");
  expect(validation).toContain("permissions:\n  contents: read");
  expect(validation).toContain("if: github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch'");
  expect(validation).toContain("node scripts/require-protected-release-tags.mjs");
  expect(validation).not.toMatch(/: write|actions\/attest@|gh release|git push|upload-artifact|inputs:/);
  expect(release).toContain("if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/')");
  expect(release).toContain("node scripts/require-protected-release-tags.mjs");
  expect(release).not.toMatch(/workflow_dispatch|inputs\./);
  expect(workflow).not.toMatch(/--slurp[^\n]*--jq|recovery:/);
});
