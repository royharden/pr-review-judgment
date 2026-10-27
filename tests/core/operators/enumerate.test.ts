// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-14). Expected offsets were hand-traced.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  MutationError,
  OPERATOR_NAMES,
  OPERATORS,
  applyMutation,
  enumerateMutations,
  mutationKey,
} from "../../../src/core/operators/index.ts";
import type { Mutation, OperatorName } from "../../../src/core/operators/index.ts";

const all = (src: string, file = "src.ts"): Mutation[] => enumerateMutations(src, file, OPERATOR_NAMES, ts);

describe("operator set", () => {
  it("has exactly the twelve PLAN operators, each documented", () => {
    expect(OPERATOR_NAMES).toEqual([
      "BooleanLiteral",
      "NumericBoundary",
      "Equality",
      "Relational",
      "Arithmetic",
      "Logical",
      "UnaryNegation",
      "Conditional",
      "RemoveAwait",
      "RemoveOptionalChainOrNullish",
      "RemoveGuardStatement",
      "EmptyCatchBody",
    ]);
    expect(OPERATORS.map((o) => o.name)).toEqual([...OPERATOR_NAMES]);
    for (const op of OPERATORS) expect(op.sites.length).toBeGreaterThan(40);
  });
});

describe("Relational: a < b", () => {
  it("yields exactly one mutant, a <= b, across all twelve operators", () => {
    const src = "const r = a < b;\n";
    const mutants = all(src);
    expect(mutants).toEqual([{ range: [12, 13], operator: "Relational", original: "<", replacement: "<=" }]);
    expect(applyMutation(src, mutants[0]!)).toBe("const r = a <= b;\n");
  });

  it("bare expression `a < b` with only Relational gives the same single flip", () => {
    const mutants = enumerateMutations("a < b", "src.ts", ["Relational"], ts);
    expect(mutants).toHaveLength(1);
    expect(applyMutation("a < b", mutants[0]!)).toBe("a <= b");
  });

  it("flips each relational operator exactly once", () => {
    const src = "f(a <= b, c > d, e >= g);\n";
    const out = enumerateMutations(src, "src.ts", ["Relational"], ts).map((m) => applyMutation(src, m));
    expect(out).toEqual(["f(a < b, c > d, e >= g);\n", "f(a <= b, c >= d, e >= g);\n", "f(a <= b, c > d, e > g);\n"]);
  });
});

describe("determinism and ordering", () => {
  const src = "const x = !flag ? 1 : 2;\n";

  it("sorts by range start, then operator name, then end, then replacement", () => {
    expect(all(src)).toEqual([
      { range: [10, 15], operator: "Conditional", original: "!flag", replacement: "!(!flag)" },
      { range: [10, 15], operator: "UnaryNegation", original: "!flag", replacement: "(flag)" },
      { range: [18, 19], operator: "NumericBoundary", original: "1", replacement: "0" },
      { range: [18, 19], operator: "NumericBoundary", original: "1", replacement: "2" },
      { range: [22, 23], operator: "NumericBoundary", original: "2", replacement: "0" },
      { range: [22, 23], operator: "NumericBoundary", original: "2", replacement: "1" },
      { range: [22, 23], operator: "NumericBoundary", original: "2", replacement: "3" },
    ]);
  });

  it("is identical across calls and independent of the order operators are listed in", () => {
    const reversed = [...OPERATOR_NAMES].reverse() as OperatorName[];
    expect(all(src)).toEqual(all(src));
    expect(enumerateMutations(src, "src.ts", reversed, ts)).toEqual(all(src));
  });

  it("never mutates type-only syntax", () => {
    expect(all("interface I { a: 1; b: true }\ntype T = 2 | 3;\n")).toEqual([]);
    expect(all("let n: 5 = 5;\n").map((m) => m.range)).toEqual([[11, 12], [11, 12], [11, 12]]);
    expect(all("declare const k: number;\nimport type { X } from \"./x.ts\";\n")).toEqual([]);
  });
});

describe("refusals", () => {
  it("throws a parse MutationError on syntax errors", () => {
    expect(() => all("const = ;")).toThrow(MutationError);
  });

  it("rejects unknown and duplicate operators", () => {
    expect(() => enumerateMutations("a < b", "src.ts", ["Nope" as OperatorName], ts)).toThrow(MutationError);
    expect(() => enumerateMutations("a < b", "src.ts", ["Relational", "Relational"], ts)).toThrow(MutationError);
  });

  it("applyMutation refuses a stale original or an out-of-range mutation", () => {
    const m: Mutation = { range: [2, 3], operator: "Relational", original: "<", replacement: "<=" };
    expect(applyMutation("a < b", m)).toBe("a <= b");
    expect(() => applyMutation("a > b", m)).toThrow(MutationError);
    expect(() => applyMutation("a", m)).toThrow(MutationError);
  });

  it("mutationKey is a stable 64-hex content key", () => {
    const m: Mutation = { range: [2, 3], operator: "Relational", original: "<", replacement: "<=" };
    const k = mutationKey("src.ts", "a".repeat(64), m);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(mutationKey("src.ts", "a".repeat(64), m)).toBe(k);
    expect(mutationKey("src.ts", "a".repeat(64), { ...m, replacement: "<" })).not.toBe(k);
  });
});
