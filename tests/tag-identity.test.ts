import { describe, expect, it } from "vitest";

import { isSameTagIdentity } from "../src/tags/tag-identity";

describe("Tag identity comparison boundary", () => {
  it.each([
    ["#AWS", "#aws"],
    ["#Programming/AWS", "#programming/aws"],
    ["#日本語/AWS", "#日本語/aws"],
  ])("recognizes documented ASCII case variants %s / %s", (a, b) => {
    expect(isSameTagIdentity(a, b)).toBe(true);
    expect(isSameTagIdentity(b, a)).toBe(true);
  });

  it.each([
    ["#aws", "#aws2"], ["#aws", "#cloud"],
    ["#programming", "#programming/aws"],
    ["#é", "#e\u0301"], ["#É", "#é"],
    ["#İ", "#i"], ["#ß", "#ss"],
  ])("does not invent hierarchy, Unicode or locale equivalence for %s / %s", (a, b) => {
    expect(isSameTagIdentity(a, b)).toBe(false);
    expect(isSameTagIdentity(b, a)).toBe(false);
  });
});
