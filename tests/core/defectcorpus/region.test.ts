// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-06). Expected values hand-traced against diff.ts's
// tie-break (match -> eq; else prefer deletion when it keeps an LCS).
import { describe, expect, it } from "vitest";
import { deriveFileIntervals, deriveRegions, REGION_POLICY, widen } from "../../../src/core/defectcorpus/region.ts";
import { diffLines, splitLines } from "../../../src/core/defectcorpus/diff.ts";

const text = (...lines: string[]): string => lines.map((l) => `${l}\n`).join("");

describe("splitLines", () => {
  it("handles empty text, trailing newline and CRLF", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitLines("a\n\nb\n")).toEqual(["a", "", "b"]);
  });
});

describe("diffLines tie-break", () => {
  it("puts deletions before insertions inside a replaced run", () => {
    expect(diffLines(["A", "B", "C"], ["A", "Y", "C"]).map((op) => op.tag)).toEqual(["eq", "del", "ins", "eq"]);
  });
});

describe("deriveFileIntervals (region/v1)", () => {
  it("policy id is versioned", () => {
    expect(REGION_POLICY).toBe("region/v1");
  });

  it("identical files have no region", () => {
    expect(deriveFileIntervals(text("A", "B"), text("A", "B"))).toEqual([]);
  });

  it("insert: the inserted line", () => {
    expect(deriveFileIntervals(text("A", "B", "C"), text("A", "X", "B", "C"))).toEqual([{ startLine: 2, endLine: 2 }]);
  });

  it("insert of several adjacent lines is one run", () => {
    expect(deriveFileIntervals(text("A", "B"), text("A", "X", "Y", "B"))).toEqual([{ startLine: 2, endLine: 3 }]);
  });

  it("replace: the replacement line in defective-head numbering", () => {
    expect(deriveFileIntervals(text("A", "B", "C"), text("A", "Y", "C"))).toEqual([{ startLine: 2, endLine: 2 }]);
  });

  it("replace one line by two: both new lines", () => {
    expect(deriveFileIntervals(text("A", "B", "C"), text("A", "Y1", "Y2", "C"))).toEqual([{ startLine: 2, endLine: 3 }]);
  });

  it("pure deletion in the middle: two-line anchor (surviving line before, surviving line after)", () => {
    // clean A B C D -> defective A C D: B deleted between defective lines 1 (A) and 2 (C).
    expect(deriveFileIntervals(text("A", "B", "C", "D"), text("A", "C", "D"))).toEqual([{ startLine: 1, endLine: 2 }]);
  });

  it("pure deletion of several lines is one anchor", () => {
    expect(deriveFileIntervals(text("A", "B", "C", "D"), text("A", "D"))).toEqual([{ startLine: 1, endLine: 2 }]);
  });

  it("pure deletion at the top clamps to [1, 1]", () => {
    expect(deriveFileIntervals(text("A", "B"), text("B"))).toEqual([{ startLine: 1, endLine: 1 }]);
  });

  it("pure deletion at the bottom clamps to [n, n]", () => {
    expect(deriveFileIntervals(text("A", "B", "C"), text("A", "B"))).toEqual([{ startLine: 2, endLine: 2 }]);
  });

  it("deleting every line has no anchor and is rejected", () => {
    expect(() => deriveFileIntervals(text("A"), "")).toThrow(/no lines/);
  });

  it("multi-run: one interval per changed run, never a bounding interval", () => {
    // clean A B C D E -> defective A X C D Y: runs {B->X} and {E->Y}.
    expect(deriveFileIntervals(text("A", "B", "C", "D", "E"), text("A", "X", "C", "D", "Y"))).toEqual([
      { startLine: 2, endLine: 2 },
      { startLine: 5, endLine: 5 },
    ]);
  });

  it("multi-run mixing an insertion and a pure deletion", () => {
    // clean A B C D E -> defective A X B C E: insert X after A (line 2); delete D between C (4) and E (5).
    expect(deriveFileIntervals(text("A", "B", "C", "D", "E"), text("A", "X", "B", "C", "E"))).toEqual([
      { startLine: 2, endLine: 2 },
      { startLine: 4, endLine: 5 },
    ]);
  });

  it("is deterministic", () => {
    const clean = text("a", "b", "a", "b", "a");
    const defective = text("b", "a", "b", "a", "b");
    expect(deriveFileIntervals(clean, defective)).toEqual(deriveFileIntervals(clean, defective));
  });
});

describe("deriveRegions across files", () => {
  it("sorts by path and tags each interval with its path", () => {
    const clean = [
      { path: "src/z.ts", content: text("1", "2") },
      { path: "src/a.ts", content: text("x") },
    ];
    const defective = [
      { path: "src/z.ts", content: text("1", "3") },
      { path: "src/a.ts", content: text("x") },
    ];
    expect(deriveRegions(clean, defective)).toEqual([{ path: "src/z.ts", startLine: 2, endLine: 2 }]);
  });

  it("an added file is one interval over the whole file", () => {
    expect(deriveRegions([], [{ path: "src/new.ts", content: text("a", "b", "c") }])).toEqual([
      { path: "src/new.ts", startLine: 1, endLine: 3 },
    ]);
  });

  it("a deleted file is rejected", () => {
    expect(() => deriveRegions([{ path: "src/a.ts", content: text("a") }], [])).toThrow(/unsupported/);
  });
});

describe("widen", () => {
  it("widens by k and clamps to file bounds", () => {
    expect(widen({ startLine: 5, endLine: 6 }, 2, 100)).toEqual({ startLine: 3, endLine: 8 });
    expect(widen({ startLine: 1, endLine: 2 }, 5, 4)).toEqual({ startLine: 1, endLine: 4 });
    expect(widen({ startLine: 3, endLine: 3 }, 0, 10)).toEqual({ startLine: 3, endLine: 3 });
  });

  it("rejects negative or fractional k and empty files", () => {
    expect(() => widen({ startLine: 1, endLine: 1 }, -1, 10)).toThrow();
    expect(() => widen({ startLine: 1, endLine: 1 }, 1.5, 10)).toThrow();
    expect(() => widen({ startLine: 1, endLine: 1 }, 2, 0)).toThrow();
  });
});
