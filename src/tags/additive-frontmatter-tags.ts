import { parseFrontMatterTags } from "obsidian";

import { isSameTagIdentity } from "./tag-identity";

/** 認可済みselection用の低レベル処理。認可・source・lifetime検証は呼出側が所有する。 */
export function addSelectedFrontmatterTags(
  frontmatter: Record<string, unknown>,
  selectedTags: readonly string[],
  beforeAssignment: () => void,
): string[] {
  const existing = frontmatter.tags;
  let preserved: string[];
  if (existing === undefined) preserved = [];
  else if (Array.isArray(existing)) {
    // 対応listの既存表記・重複・順序はそのまま保持する。
    preserved = [...existing];
    if (preserved.some(name => typeof name !== "string" || !/^#?[^#\s]+$/u.test(name))) {
      throw new Error("Unsupported tags property");
    }
  } else if (typeof existing === "string") {
    // scalar解釈は公式helperに委譲し、失う可能性がある不明値を書き換えない。
    const parsed = parseFrontMatterTags(frontmatter);
    if (!parsed?.length || parsed.some(name => typeof name !== "string" || !/^#[^#\s]+$/u.test(name))) {
      throw new Error("Unsupported tags property");
    }
    preserved = parsed.map(name => name.slice(1));
  } else throw new Error("Unsupported tags property");
  const unique: string[] = [];
  for (const name of selectedTags) {
    if (!unique.some(earlier => isSameTagIdentity(earlier, name))) unique.push(name);
  }
  // callbackのcurrent frontmatterだけがstrict duplicate authority。inline観測はadvisory。
  const currentTags = preserved.map(name => name.startsWith("#") ? name : `#${name}`);
  const additions = unique.filter(name => !currentTags.some(current => isSameTagIdentity(current, name)));
  if (additions.length === 0) return additions;
  beforeAssignment();
  frontmatter.tags = [...preserved, ...additions.map(name => name.slice(1))];
  return additions;
}
