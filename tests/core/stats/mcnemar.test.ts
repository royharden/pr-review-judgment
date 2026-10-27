// Written, never run in Dirty Mode. Known answers (PLAN M3.6), recomputed outside the repo:
//   (1, 5): n = 6,  P[X <= 1] = (1 + 6) / 64 = 7/64,               p = 14/64 = 0.21875
//   (3, 10): n = 13, P[X <= 3] = (1 + 13 + 78 + 286) / 8192 = 378/8192, p = 756/8192 = 0.09228515625
//   (0, 0): p = 1
import { describe, expect, it } from "vitest";
import { exactMcNemar, mcnemarFromPairs } from "../../../src/core/stats/mcnemar.ts";

describe("exactMcNemar", () => {
  it("(1, 5) = 14/64", () => {
    expect(exactMcNemar(1, 5)).toBe(14 / 64);
    expect(exactMcNemar(5, 1)).toBe(14 / 64);
  });

  it("(3, 10) ~ 0.0923", () => {
    expect(exactMcNemar(3, 10)).toBeCloseTo(756 / 8192, 12);
    expect(exactMcNemar(3, 10)).toBeCloseTo(0.0923, 4);
  });

  it("(0, 0) = 1 and balanced counts cap at 1", () => {
    expect(exactMcNemar(0, 0)).toBe(1);
    expect(exactMcNemar(4, 4)).toBe(1);
  });

  it("(0, 6) = 2/64", () => {
    expect(exactMcNemar(0, 6)).toBe(2 / 64);
  });

  it("rejects non-integer or negative counts", () => {
    expect(() => exactMcNemar(-1, 2)).toThrow();
    expect(() => exactMcNemar(0.5, 2)).toThrow();
  });
});

describe("mcnemarFromPairs", () => {
  it("counts discordant pairs: b = first only, c = second only", () => {
    const r = mcnemarFromPairs([
      { unit: "T01", first: true, second: false },
      { unit: "T02", first: false, second: true },
      { unit: "T03", first: false, second: true },
      { unit: "T04", first: true, second: true },
      { unit: "T05", first: false, second: false },
    ]);
    expect([r.n, r.b, r.c]).toEqual([5, 1, 2]);
    expect(r.p).toBe(exactMcNemar(1, 2));
  });

  it("refuses two observations of one unit (never pooled over repeats)", () => {
    expect(() =>
      mcnemarFromPairs([
        { unit: "T01", first: true, second: false },
        { unit: "T01", first: false, second: true },
      ]),
    ).toThrow(/twice/);
  });
});
