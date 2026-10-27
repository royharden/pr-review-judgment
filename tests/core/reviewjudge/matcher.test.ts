// Written, never run in Dirty Mode. PLAN M3.3 matcher traps: right-file-wrong-function, whole-file, > 20-line span,
// deletion anchor, duplicates, bad path/line; k in {0, 2, 5}.
import { describe, expect, it } from "vitest";
import type { FileRegion } from "../../../src/core/defectcorpus/region.ts";
import type { ReviewFinding } from "../../../src/core/reviewjudge/contract.ts";
import { K_PRIMARY, SPAN_CAP_LINES, matchAllK, matchFindings } from "../../../src/core/reviewjudge/matcher.ts";

const PATH = "src/window.ts";
const files = [
  { path: PATH, lineCount: 60 },
  { path: "src/other.ts", lineCount: 40 },
];
const region: FileRegion[] = [{ path: PATH, startLine: 12, endLine: 13 }];
const f = (startLine: number, endLine: number, extra: Partial<ReviewFinding> = {}): ReviewFinding => ({
  path: PATH,
  startLine,
  endLine,
  severity: "high",
  claim: "x",
  confidence: 0.5,
  disposition: "requires_change",
  ...extra,
});
const localizedAt = (finding: ReviewFinding, regions: FileRegion[] = region): [boolean, boolean, boolean] => {
  const all = matchAllK([finding], regions, files);
  return [all.k0.anyLocalized, all.k2.anyLocalized, all.k5.anyLocalized];
};

describe("constants", () => {
  it("primary k is 2 and the span cap is 20 (PLAN K3, §6)", () => {
    expect(K_PRIMARY).toBe(2);
    expect(SPAN_CAP_LINES).toBe(20);
  });
});

describe("k widening", () => {
  it("exact overlap matches at every k", () => {
    expect(localizedAt(f(12, 12))).toEqual([true, true, true]);
    expect(localizedAt(f(10, 14))).toEqual([true, true, true]);
  });

  it("two lines off matches at k=2 and k=5 only", () => {
    expect(localizedAt(f(15, 15))).toEqual([false, true, true]);
    expect(localizedAt(f(10, 10))).toEqual([false, true, true]);
  });

  it("four lines off matches at k=5 only", () => {
    expect(localizedAt(f(17, 18))).toEqual([false, false, true]);
  });

  it("refuses k outside {0, 2, 5}", () => {
    expect(() => matchFindings([f(12, 12)], region, files, 1)).toThrow();
    expect(() => matchFindings([f(12, 12)], region, files, 3)).toThrow();
  });

  it("widening clamps at the file start", () => {
    expect(localizedAt(f(1, 1), [{ path: PATH, startLine: 2, endLine: 2 }])).toEqual([false, true, true]);
  });
});

describe("traps", () => {
  it("right file, wrong function: never matches", () => {
    expect(localizedAt(f(40, 45))).toEqual([false, false, false]);
    expect(matchFindings([f(40, 45)], region, files, 2).findings[0]!.reason).toBe("no_overlap");
  });

  it("whole-file finding: span over the cap, never matches", () => {
    expect(localizedAt(f(1, 60))).toEqual([false, false, false]);
    expect(matchFindings([f(1, 60)], region, files, 5).findings[0]!.reason).toBe("span_over_cap");
  });

  it("21-line span covering the region never matches; 20-line span does", () => {
    expect(localizedAt(f(3, 23))).toEqual([false, false, false]);
    expect(localizedAt(f(3, 22))).toEqual([true, true, true]);
  });

  it("deletion anchor (two-line anchor around removed lines) matches either anchor line", () => {
    const anchor: FileRegion[] = [{ path: PATH, startLine: 30, endLine: 31 }];
    expect(localizedAt(f(31, 31), anchor)).toEqual([true, true, true]);
    expect(localizedAt(f(30, 30), anchor)).toEqual([true, true, true]);
    expect(localizedAt(f(28, 28), anchor)).toEqual([false, true, true]);
  });

  it("duplicates: both findings are traced and localized; the trace counts both", () => {
    const t = matchFindings([f(12, 13), f(12, 13)], region, files, 2);
    expect(t.findings).toHaveLength(2);
    expect(t.localizedCount).toBe(2);
    expect(t.anyActionableLocalized).toBe(true);
  });

  it("bad paths never match: other file, case change, ./ prefix, absolute, unknown file", () => {
    for (const path of ["src/other.ts", "src/Window.ts", "./src/window.ts", "/src/window.ts", "src/missing.ts", "src\\window.ts"]) {
      const t = matchFindings([f(12, 13, { path })], region, files, 5);
      expect(t.anyLocalized).toBe(false);
    }
    expect(matchFindings([f(12, 13, { path: "./src/window.ts" })], region, files, 2).findings[0]!.reason).toBe("unknown_path");
    expect(matchFindings([f(12, 13, { path: "src/other.ts" })], region, files, 2).findings[0]!.reason).toBe("no_overlap");
  });

  it("bad lines never match: beyond the file, zero, reversed", () => {
    expect(matchFindings([f(59, 61)], [{ path: PATH, startLine: 59, endLine: 60 }], files, 5).findings[0]!.reason).toBe("line_out_of_bounds");
    expect(matchFindings([f(0, 12)], region, files, 5).findings[0]!.reason).toBe("line_out_of_bounds");
    expect(matchFindings([f(13, 12)], region, files, 5).findings[0]!.reason).toBe("line_out_of_bounds");
  });

  it("multi-run regions: a finding records which region it overlaps", () => {
    const runs: FileRegion[] = [
      { path: PATH, startLine: 5, endLine: 5 },
      { path: PATH, startLine: 50, endLine: 50 },
    ];
    expect(matchFindings([f(50, 50)], runs, files, 0).findings[0]!.matchedRegions).toEqual([1]);
  });

  it("only requires_change findings count as actionable", () => {
    const t = matchFindings([f(12, 12, { disposition: "uncertain" })], region, files, 2);
    expect(t.anyLocalized).toBe(true);
    expect(t.anyActionableLocalized).toBe(false);
  });

  it("refuses regions outside the head files (corpus inconsistency)", () => {
    expect(() => matchFindings([], [{ path: "src/nope.ts", startLine: 1, endLine: 1 }], files, 2)).toThrow();
    expect(() => matchFindings([], [{ path: PATH, startLine: 60, endLine: 61 }], files, 2)).toThrow();
  });
});
