// Written, never run in Dirty Mode. Type-7 values hand-computed: for [1, 2, 3, 4], h = 3p.
import { describe, expect, it } from "vitest";
import { quantile, quantileSorted } from "../../../src/core/stats/quantile.ts";

describe("quantile (type 7)", () => {
  it("interpolates between order statistics", () => {
    expect(quantileSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(quantileSorted([1, 2, 3, 4], 1)).toBe(4);
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
  });

  it("a single value is every quantile", () => {
    expect(quantileSorted([7], 0.025)).toBe(7);
    expect(quantileSorted([7], 0.975)).toBe(7);
  });

  it("quantile sorts a copy and leaves the input alone", () => {
    const xs = [4, 1, 3, 2];
    expect(quantile(xs, 0.5)).toBe(2.5);
    expect(xs).toEqual([4, 1, 3, 2]);
  });

  it("refuses empty or unsorted input and p outside [0, 1]", () => {
    expect(() => quantileSorted([], 0.5)).toThrow();
    expect(() => quantileSorted([2, 1], 0.5)).toThrow();
    expect(() => quantileSorted([1, 2], 1.5)).toThrow();
  });
});
