// Written, never run in Dirty Mode. Determinism and range properties of mulberry32 and the seeded shuffle.
import { describe, expect, it } from "vitest";
import { deriveSeed, mulberry32, seededShuffle } from "../../../src/core/stats/prng.ts";

describe("mulberry32", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = mulberry32(4102);
    const b = mulberry32(4102);
    const c = mulberry32(4103);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(xs);
  });

  it("next() is in [0, 1) and int(n) in [0, n)", () => {
    const p = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const x = p.next();
      expect(x >= 0 && x < 1).toBe(true);
      const k = p.int(10);
      expect(Number.isInteger(k) && k >= 0 && k < 10).toBe(true);
    }
  });

  it("rejects non-uint32 seeds", () => {
    expect(() => mulberry32(-1)).toThrow();
    expect(() => mulberry32(1.5)).toThrow();
    expect(() => mulberry32(2 ** 32)).toThrow();
  });
});

describe("deriveSeed and seededShuffle", () => {
  it("derived seeds depend on every label", () => {
    expect(deriveSeed(7, "x", "A", "1")).toBe(deriveSeed(7, "x", "A", "1"));
    expect(deriveSeed(7, "x", "A", "1")).not.toBe(deriveSeed(7, "x", "A", "2"));
    expect(deriveSeed(7, "x", "A", "1")).not.toBe(deriveSeed(7, "x", "B", "1"));
  });

  it("shuffle is a deterministic permutation", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    const s1 = seededShuffle(items, 42);
    expect(seededShuffle(items, 42)).toEqual(s1);
    expect([...s1].sort()).toEqual(items);
    expect(items).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
