// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-14). Expected outputs were hand-traced.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { applyMutation, enumerateMutations, paddedToken } from "../../../src/core/operators/index.ts";
import type { OperatorName } from "../../../src/core/operators/index.ts";

/** Every mutant of `src` for one operator, applied, in enumeration order. */
const outputs = (src: string, op: OperatorName): string[] =>
  enumerateMutations(src, "src.ts", [op], ts).map((m) => applyMutation(src, m));

describe("BooleanLiteral", () => {
  it("swaps literals in expressions only", () => {
    expect(outputs("let ok = true;\n", "BooleanLiteral")).toEqual(["let ok = false;\n"]);
    expect(outputs("let ok: true = true;\n", "BooleanLiteral")).toEqual(["let ok: true = false;\n"]);
    expect(outputs("f(false);\n", "BooleanLiteral")).toEqual(["f(true);\n"]);
  });
});

describe("NumericBoundary", () => {
  it("emits distinct 0 / n+1 / n-1 candidates", () => {
    expect(outputs("const n = 5;\n", "NumericBoundary")).toEqual(["const n = 0;\n", "const n = 4;\n", "const n = 6;\n"]);
    expect(outputs("const z = 0;\n", "NumericBoundary")).toEqual(["const z = (-1);\n", "const z = 1;\n"]);
  });

  it("skips property names and parenthesises property-access receivers", () => {
    expect(outputs("const o = { 1: 5 };\n", "NumericBoundary")).toEqual([
      "const o = { 1: 0 };\n",
      "const o = { 1: 4 };\n",
      "const o = { 1: 6 };\n",
    ]);
    expect(outputs("const s = 1.5.toFixed();\n", "NumericBoundary")).toEqual([
      "const s = (0).toFixed();\n",
      "const s = (0.5).toFixed();\n",
      "const s = (2.5).toFixed();\n",
    ]);
  });
});

describe("Equality", () => {
  it("negates each equality operator", () => {
    expect(outputs("a === b;\n", "Equality")).toEqual(["a !== b;\n"]);
    expect(outputs("a != b;\n", "Equality")).toEqual(["a == b;\n"]);
  });
});

describe("Arithmetic", () => {
  it("swaps operators and skips string concatenation", () => {
    expect(outputs("x + y;\n", "Arithmetic")).toEqual(["x - y;\n"]);
    expect(outputs("x % y;\n", "Arithmetic")).toEqual(["x * y;\n"]);
    expect(outputs('const s = "a" + b;\n', "Arithmetic")).toEqual([]);
    expect(outputs("const s = `t${b}` + c;\n", "Arithmetic")).toEqual([]);
  });

  it("pads a replacement token that would fuse with a neighbour", () => {
    expect(outputs("const v = a-+b;\n", "Arithmetic")).toEqual(["const v = a + +b;\n"]);
    expect(paddedToken("a-b", 1, 2, "+")).toBe(" + ");
    expect(paddedToken("a - b", 2, 3, "+")).toBe("+");
  });
});

describe("Logical", () => {
  it("swaps && and || but never touches ??", () => {
    expect(outputs("a && b;\n", "Logical")).toEqual(["a || b;\n"]);
    expect(outputs("a || b;\n", "Logical")).toEqual(["a && b;\n"]);
    expect(outputs("a ?? b;\n", "Logical")).toEqual([]);
  });
});

describe("UnaryNegation", () => {
  it("removes each negation; !!x gives outer and inner mutants", () => {
    expect(outputs("const y = !x;\n", "UnaryNegation")).toEqual(["const y = (x);\n"]);
    expect(outputs("const y = !!x;\n", "UnaryNegation")).toEqual(["const y = (!x);\n", "const y = !(x);\n"]);
  });
});

describe("Conditional", () => {
  it("negates ternary conditions only", () => {
    expect(outputs("const v = c ? a : b;\n", "Conditional")).toEqual(["const v = !(c) ? a : b;\n"]);
    expect(outputs("if (c) a();\n", "Conditional")).toEqual([]);
  });
});
