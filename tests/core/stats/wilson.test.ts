// Written, never run in Dirty Mode (DEFERRED-VALIDATION, M3 stats row). Known answers recomputed by hand and with a
// throwaway Python one-liner outside the repo: Wilson(5, 10) = [0.236593, 0.763407].
import { describe, expect, it } from "vitest";
import { WILSON_LABEL, wilson } from "../../../src/core/stats/wilson.ts";

describe("wilson", () => {
  it("Wilson(5, 10) = [0.2366, 0.7634] (PLAN M3.6)", () => {
    const w = wilson(5, 10);
    expect(w.kind).toBe("value");
    if (w.kind !== "value") return;
    expect(w.estimate).toBe(0.5);
    expect(w.lower).toBeCloseTo(0.2366, 4);
    expect(w.upper).toBeCloseTo(0.7634, 4);
    expect(w.label).toBe(WILSON_LABEL);
    expect(w.label).toContain("ignores clustering");
  });

  it("clamps to [0, 1] at the extremes", () => {
    const zero = wilson(0, 10);
    const all = wilson(10, 10);
    if (zero.kind !== "value" || all.kind !== "value") throw new Error("expected values");
    expect(zero.lower).toBe(0);
    expect(zero.upper).toBeCloseTo(0.2775, 4);
    expect(all.upper).toBeLessThanOrEqual(1);
    expect(all.lower).toBeCloseTo(0.7225, 4);
  });

  it("zero denominator -> undefined with a reason, never NaN", () => {
    const w = wilson(0, 0);
    expect(w.kind).toBe("undefined");
    if (w.kind === "undefined") expect(w.reason).toBe("zero denominator");
  });

  it("rejects invalid counts", () => {
    expect(() => wilson(3, 2)).toThrow();
    expect(() => wilson(-1, 2)).toThrow();
    expect(() => wilson(1.5, 2)).toThrow();
  });
});
