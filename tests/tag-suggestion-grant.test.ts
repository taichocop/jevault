import type { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { NoteSource } from "../src/note-source";
import { captureEvaluationProvenance } from "../src/tags/evaluation-provenance";
import { TagSuggestionGrantIssuer, isIssuedSuggestionGrant } from "../src/tags/tag-suggestion-grant";
import type { TagSuggestionServiceResult } from "../src/tags/tag-suggestion-service";

function harness(names = ["#aws", "#cloud"]) {
  const file = { path: "Synthetic/A.md", stat: { mtime: 2, size: 10 } } as TFile;
  const source = new NoteSource(file);
  const vault = { getFileByPath: vi.fn(() => file) };
  const outcome: TagSuggestionServiceResult = {
    status: "success", source, noteTitle: "A",
    suggestions: names.map((tagName, index) => ({ tagId: `tag_${index}`, tagName, choice: "match", matchProbability: 1 })),
  };
  const issuer = new TagSuggestionGrantIssuer(vault);
  return { file, vault, source, outcome, issuer };
}

describe("TagSuggestionGrant issuance boundary", () => {
  it("records exact source, displayed order and spelling without consulting Vault or metadata", () => {
    const h = harness(["#cloud", "#aws", "#Programming/AWS", "#日本語"]);
    const lifetime = h.issuer.issue(h.outcome)!;
    expect(lifetime.grant.source).toBe(h.source);
    expect(lifetime.grant.allowedTags).toEqual(["#cloud", "#aws", "#Programming/AWS", "#日本語"]);
    expect(lifetime.grant.allowedTags).not.toContain("#AWS");
    expect(lifetime.grant.allowedTags).not.toContain("#Programming");
    expect(isIssuedSuggestionGrant(lifetime.grant, h.vault)).toBe(true);
    expect(h.vault.getFileByPath).not.toHaveBeenCalled();
    expect(Object.keys(lifetime.grant)).toEqual(["source", "allowedTags"]);
    lifetime.dispose();
  });
  it("copies suggestions and freezes both authority object and owned array at runtime", () => {
    const h = harness(); const { grant, dispose } = h.issuer.issue(h.outcome)!;
    const suggestions = h.outcome.suggestions as Array<{ tagId: string; tagName: string; choice: "match"; matchProbability: number }>;
    suggestions[0].tagName = "#forged";
    suggestions.push({ tagId: "extra", tagName: "#extra", choice: "match", matchProbability: 1 });
    expect(grant.allowedTags).toEqual(["#aws", "#cloud"]);
    expect(Object.isFrozen(grant)).toBe(true); expect(Object.isFrozen(grant.allowedTags)).toBe(true);
    const names = grant.allowedTags as string[];
    expect(() => names.push("#forged")).toThrow(TypeError);
    expect(() => names.splice(0, 1, "#forged")).toThrow(TypeError);
    expect(() => { (grant as { source: NoteSource }).source = new NoteSource(h.file); }).toThrow(TypeError);
    expect(() => { (grant as unknown as { allowedTags: string[] }).allowedTags = ["#forged"]; }).toThrow(TypeError);
    expect(grant.source).toBe(h.source); expect(grant.allowedTags).toEqual(["#aws", "#cloud"]); dispose();
  });
  it("retains original identity across same-path replacement", () => {
    const h = harness(); const lifetime = h.issuer.issue(h.outcome)!;
    const replacement = { ...h.file } as TFile;
    expect(lifetime.grant.source.matches(h.file)).toBe(true);
    expect(lifetime.grant.source.matches(replacement)).toBe(false);
    lifetime.dispose();
  });
  it("rejects forged/copy and cross-Vault use and revokes idempotently without reactivation", () => {
    const h = harness(); const lifetime = h.issuer.issue(h.outcome)!;
    const anotherVault = { getFileByPath: h.vault.getFileByPath };
    expect(isIssuedSuggestionGrant(lifetime.grant, anotherVault)).toBe(false);
    expect(isIssuedSuggestionGrant({ ...lifetime.grant }, h.vault)).toBe(false);
    expect(isIssuedSuggestionGrant(Object.freeze({ ...lifetime.grant }), h.vault)).toBe(false);
    lifetime.dispose(); lifetime.dispose();
    expect(isIssuedSuggestionGrant(lifetime.grant, h.vault)).toBe(false);
    const next = h.issuer.issue(h.outcome)!;
    expect(next.grant).not.toBe(lifetime.grant);
    expect(isIssuedSuggestionGrant(next.grant, h.vault)).toBe(true);
    expect(isIssuedSuggestionGrant(lifetime.grant, h.vault)).toBe(false); next.dispose();
  });
  it("issues successful empty suggestions and missing provenance", () => {
    const h = harness([]); const lifetime = h.issuer.issue(h.outcome)!;
    expect(lifetime.grant.allowedTags).toEqual([]);
    expect(lifetime.grant.evaluationProvenance).toBeUndefined();
    expect(isIssuedSuggestionGrant(lifetime.grant, h.vault)).toBe(true); lifetime.dispose();
  });
  it("retains only opaque optional advisory provenance without checking current revision/content", async () => {
    const h = harness(); const evaluationProvenance = await captureEvaluationProvenance(h.source, "Synthetic private fixture body");
    expect(evaluationProvenance).toBeDefined();
    h.file.stat.mtime++;
    const lifetime = h.issuer.issue({ ...h.outcome, evaluationProvenance })!;
    expect(lifetime.grant.evaluationProvenance).toBe(evaluationProvenance);
    expect(JSON.stringify(evaluationProvenance)).toBe("{}");
    expect(Object.keys(lifetime.grant)).toEqual(["source", "allowedTags", "evaluationProvenance"]);
    expect(JSON.stringify(lifetime.grant)).not.toContain("Synthetic private fixture body");
    expect(isIssuedSuggestionGrant(lifetime.grant, h.vault)).toBe(true); lifetime.dispose();
  });
  it("does not issue for provenance from another source", async () => {
    const h = harness(); const anotherSource = new NoteSource(h.file);
    const evaluationProvenance = await captureEvaluationProvenance(anotherSource, "Synthetic fixture");
    expect(evaluationProvenance).toBeDefined();
    expect(h.issuer.issue({ ...h.outcome, evaluationProvenance })).toBeUndefined();
  });
  it.each(["failure", "source", "array", "other", "name"])("invalid runtime %s cannot manufacture authority", (invalid) => {
    const h = harness();
    const outcome = { ...h.outcome } as unknown as Record<string, unknown>;
    if (invalid === "failure") outcome.status = "failure";
    if (invalid === "source") outcome.source = { path: h.source.path };
    if (invalid === "array") outcome.suggestions = undefined;
    if (invalid === "other") outcome.suggestions = [{ ...h.outcome.suggestions[0], choice: "other" }];
    if (invalid === "name") outcome.suggestions = [{ ...h.outcome.suggestions[0], tagName: "free form" }];
    expect(h.issuer.issue(outcome as unknown as TagSuggestionServiceResult)).toBeUndefined();
  });
});
