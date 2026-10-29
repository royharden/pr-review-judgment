// Known-output cases for the four operators added for this study (PLAN M2 acceptance 1).
// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-14). Expected outputs were hand-traced.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { applyMutation, enumerateMutations } from "../../../src/core/operators/index.ts";
import type { OperatorName } from "../../../src/core/operators/index.ts";

const outputs = (src: string, op: OperatorName): string[] =>
  enumerateMutations(src, "src.ts", [op], ts).map((m) => applyMutation(src, m));

describe("RemoveAwait", () => {
  it("replaces `await expr` with `expr` (known output)", () => {
    const src = "async function f() { return await g(); }\n";
    expect(enumerateMutations(src, "src.ts", ["RemoveAwait"], ts)).toEqual([
      { range: [28, 37], operator: "RemoveAwait", original: "await g()", replacement: "g()" },
    ]);
    expect(outputs(src, "RemoveAwait")).toEqual(["async function f() { return g(); }\n"]);
  });

  it("keeps parenthesised receivers and skips `for await`", () => {
    expect(outputs("async function f() { return (await p).v; }\n", "RemoveAwait")).toEqual([
      "async function f() { return (p).v; }\n",
    ]);
    expect(outputs("async function f(xs: AsyncIterable<number>) { for await (const x of xs) { void x; } }\n", "RemoveAwait")).toEqual([]);
  });
});

describe("RemoveOptionalChainOrNullish", () => {
  it("removes the fallback of ?? and the ?. of an optional link (known output)", () => {
    const src = "const v = a?.b ?? c;\n";
    expect(enumerateMutations(src, "src.ts", ["RemoveOptionalChainOrNullish"], ts)).toEqual([
      { range: [10, 19], operator: "RemoveOptionalChainOrNullish", original: "a?.b ?? c", replacement: "a?.b" },
      { range: [11, 13], operator: "RemoveOptionalChainOrNullish", original: "?.", replacement: "." },
    ]);
    expect(outputs(src, "RemoveOptionalChainOrNullish")).toEqual(["const v = a?.b;\n", "const v = a.b ?? c;\n"]);
  });

  it("handles optional element access and optional calls", () => {
    expect(outputs("const v = a?.[0];\n", "RemoveOptionalChainOrNullish")).toEqual(["const v = a[0];\n"]);
    expect(outputs("f?.(x);\n", "RemoveOptionalChainOrNullish")).toEqual(["f(x);\n"]);
    expect(outputs("x ??= y;\n", "RemoveOptionalChainOrNullish")).toEqual([]);
  });
});

describe("RemoveGuardStatement", () => {
  it("deletes an early-exit guard with no else (known output)", () => {
    const src = "function f(x: number | null) {\n  if (x === null) return 0;\n  return x + 1;\n}\n";
    expect(outputs(src, "RemoveGuardStatement")).toEqual(["function f(x: number | null) {\n  \n  return x + 1;\n}\n"]);
  });

  it("accepts a block with exactly one exit statement, and uses `;` when the guard is another statement's body", () => {
    expect(outputs('function g(ok: boolean) {\n  if (!ok) { throw new Error("no"); }\n}\n', "RemoveGuardStatement")).toEqual([
      "function g(ok: boolean) {\n  \n}\n",
    ]);
    expect(outputs("function h(a: boolean, b: boolean) { if (a) {} else if (b) return; }\n", "RemoveGuardStatement")).toEqual([
      "function h(a: boolean, b: boolean) { if (a) {} else ; }\n",
    ]);
  });

  it("does not touch guards with else, multi-statement bodies, or non-exit bodies", () => {
    expect(outputs("function k(x: boolean) { if (x) return 1; else return 2; }\n", "RemoveGuardStatement")).toEqual([]);
    expect(outputs("function k(x: boolean) { if (x) { a(); return; } }\n", "RemoveGuardStatement")).toEqual([]);
    expect(outputs("function k(x: boolean) { if (x) a(); }\n", "RemoveGuardStatement")).toEqual([]);
  });
});

describe("EmptyCatchBody", () => {
  it("empties a non-empty catch block (known output)", () => {
    const src = "try { g(); } catch (e) { log(e); }\n";
    expect(enumerateMutations(src, "src.ts", ["EmptyCatchBody"], ts)).toEqual([
      { range: [23, 34], operator: "EmptyCatchBody", original: "{ log(e); }", replacement: "{}" },
    ]);
    expect(outputs(src, "EmptyCatchBody")).toEqual(["try { g(); } catch (e) {}\n"]);
  });

  it("skips already-empty catch blocks and finally blocks", () => {
    expect(outputs("try { g(); } catch {} finally { h(); }\n", "EmptyCatchBody")).toEqual([]);
  });
});
