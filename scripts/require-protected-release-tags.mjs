import { execFileSync } from "node:child_process";
import console from "node:console";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repository = "taichocop/jevault";
const malformed = () => new Error("Malformed GitHub tag ruleset response.");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isId = (value) => Number.isSafeInteger(value) && value > 0;
const isStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw malformed();
  }
}

export function parseRulesetPages(text) {
  const pages = parseJson(text);
  if (!Array.isArray(pages) || pages.length === 0 || pages.some((page) => !Array.isArray(page))) {
    throw malformed();
  }
  const ids = [];
  for (const page of pages) {
    for (const entry of page) {
      if (!isObject(entry) || !isId(entry.id) || entry.target !== "tag" || ids.includes(entry.id)) {
        throw malformed();
      }
      ids.push(entry.id);
    }
  }
  return ids;
}

export function isProtectedRuleset(value, expectedId) {
  if (!isObject(value) || value.id !== expectedId || !isId(value.id) || value.target !== "tag"
    || !["active", "disabled", "evaluate"].includes(value.enforcement)
    || !isObject(value.conditions) || !isObject(value.conditions.ref_name)
    || !isStrings(value.conditions.ref_name.include) || !isStrings(value.conditions.ref_name.exclude)
    || !Array.isArray(value.rules)
    || value.rules.some((rule) => !isObject(rule) || typeof rule.type !== "string")) {
    throw malformed();
  }
  return value.enforcement === "active"
    && value.conditions.ref_name.include.includes("~ALL")
    && value.conditions.ref_name.exclude.length === 0
    && value.rules.some((rule) => rule.type === "update")
    && value.rules.some((rule) => rule.type === "deletion");
}

export function readRulesetApi(endpoint, paginate = false) {
  // --slurp は JSON のページ構造を維持する。非対応の --jq とは併用しない。
  const args = ["api", "--method", "GET", ...(paginate ? ["--paginate", "--slurp"] : []), endpoint];
  try {
    return execFileSync("gh", args, {
      encoding: "utf8", timeout: 60_000, maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("GitHub tag ruleset API request failed.");
  }
}

export function requireProtectedReleaseTags(api = readRulesetApi) {
  const ids = parseRulesetPages(api(`repos/${repository}/rulesets?targets=tag&per_page=100`, true));
  const protectedIds = [];
  // 有効な設定が先に見つかっても、後続ページ・API の異常を成功扱いしない。
  for (const id of ids) {
    if (isProtectedRuleset(parseJson(api(`repos/${repository}/rulesets/${id}`)), id)) {
      protectedIds.push(id);
    }
  }
  if (protectedIds.length === 0) {
    throw new Error("Active all-tag ruleset must restrict updates and deletions before release.");
  }
  return protectedIds;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const ids = requireProtectedReleaseTags();
    console.log(`Verified active all-tag update/deletion protection: ${ids.join(", ")}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
