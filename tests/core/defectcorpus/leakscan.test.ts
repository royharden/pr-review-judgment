// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-07).
import { describe, expect, it } from "vitest";
import { FORBIDDEN_WORDS, scanReviewerVisible, scanText } from "../../../src/core/defectcorpus/leakscan.ts";
import type { ReviewerProjection } from "../../../src/core/defectcorpus/projection.ts";

const terms = (text: string): string[] => scanText(text).map((h) => h.term);

describe("forbidden word list", () => {
  it("is exactly PLAN §3.5", () => {
    expect([...FORBIDDEN_WORDS]).toEqual([
      "clean",
      "defect",
      "near-miss",
      "near_miss",
      "group",
      "tag",
      "seed",
      "mutant",
      "twin",
      "witness",
    ]);
  });
});

describe("scanText: positive cases", () => {
  it("finds every forbidden word case-insensitively", () => {
    for (const word of FORBIDDEN_WORDS) {
      expect(terms(`see ${word.toUpperCase()} here`)).toContain(word);
    }
  });

  it("treats _ - / . as boundaries (paths and snake_case)", () => {
    expect(terms("src/seed-data.ts")).toEqual(["seed"]);
    expect(terms("const group_id = 1;")).toEqual(["group"]);
    expect(terms("fixtures/clean.ts")).toEqual(["clean"]);
  });

  it("catches camelCase, acronym and digit boundaries", () => {
    expect(terms("isClean(x)")).toEqual(["clean"]);
    expect(terms("cleanHead")).toEqual(["clean"]);
    expect(terms("XMLGroup")).toEqual(["group"]);
    expect(terms("seed42")).toEqual(["seed"]);
    expect(terms("isNearMiss")).toEqual(["nearmiss"]);
  });

  it("catches plurals", () => {
    expect(terms("Tags and groups")).toEqual(["tag", "group"]);
    expect(terms("two witnesses")).toEqual(["witness"]);
    expect(scanText("near-misses")[0]?.match).toBe("near-misses");
  });

  it("reports 1-based line and column", () => {
    const [hit] = scanText("ok line\n  the twin");
    expect(hit).toMatchObject({ term: "twin", line: 2, column: 7, index: 14, match: "twin" });
  });
});

describe("scanText: negative cases", () => {
  it("ignores words that merely contain a forbidden word", () => {
    expect(scanText("cleanup cleanse stage untagged groupie seedling twine defective mutants_x")).toEqual([
      // `mutants_x`: plural + `_` boundary, so it IS a hit; everything else is not.
      expect.objectContaining({ term: "mutant", match: "mutants" }),
    ]);
    expect(scanText("export function parseQuery(input: string): number[] { return []; }")).toEqual([]);
    expect(scanText("STAGE PTAG")).toEqual([]);
  });

  it("change ids (c_ + hex) can never spell a forbidden word", () => {
    expect(scanText("c_0123456789 c_abcdefabcd")).toEqual([]);
  });
});

describe("scanReviewerVisible", () => {
  const projection: ReviewerProjection = {
    changeId: "c_0123456789",
    spec: "Parse a duration string.",
    diff: "--- a/src/parse.ts\n+++ b/src/parse.ts\n@@ -1,1 +1,1 @@\n-x\n+y\n",
    files: [{ path: "src/parse.ts", lineCount: 1, numberedHead: "1 | y" }],
  };

  it("passes a projection with no forbidden word", () => {
    expect(scanReviewerVisible(projection)).toEqual([]);
  });

  it("flags a forbidden word in any field, including file paths", () => {
    const leaky: ReviewerProjection = {
      ...projection,
      spec: "The clean version parses durations.",
      files: [{ path: "src/twin/parse.ts", lineCount: 1, numberedHead: "1 | const seed = 4;" }],
    };
    const hits = scanReviewerVisible(leaky);
    expect(hits.map((h) => [h.field, h.term])).toEqual([
      ["spec", "clean"],
      ["files[0].path", "twin"],
      ["files[0].numberedHead", "seed"],
    ]);
  });

  it("scans a bare rendered string", () => {
    expect(scanReviewerVisible("review this defect").map((h) => h.term)).toEqual(["defect"]);
  });
});
