// Written, never run in Dirty Mode. PLAN M3.7 baselines: approve-all, flag-every-hunk, diff-heuristic (rule ids +
// rule-set hash), static-analysis (diagnostics adapter; sandbox required; infra error = operational failure).
// Diffs are produced with M1's unifiedDiff so the parser reads exactly the reviewer-visible format.
import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../../../src/core/defectcorpus/diff.ts";
import { approveAll } from "../../../src/core/reviewjudge/baselines/approveAll.ts";
import { BASELINE_IDS } from "../../../src/core/reviewjudge/baselines/common.ts";
import { DIFF_HEURISTIC_RULES, RULESET_SHA256, diffHeuristic, diffHeuristicFirings } from "../../../src/core/reviewjudge/baselines/diffHeuristic.ts";
import { changeRuns, parseUnifiedDiff } from "../../../src/core/reviewjudge/baselines/diffparse.ts";
import { flagEveryHunk, hunkWindows } from "../../../src/core/reviewjudge/baselines/flagEveryHunk.ts";
import {
  findingsFromDiagnostics,
  staticAnalysis,
  staticAnalysisFromReport,
  truncateClaim,
} from "../../../src/core/reviewjudge/baselines/staticAnalysis.ts";
import { CLAIM_MAX_CHARS, ReviewOutputSchema, charCount } from "../../../src/core/reviewjudge/contract.ts";

const PATH = "src/calc.ts";
const text = (...lines: string[]): string => lines.map((l) => `${l}\n`).join("");
const diffOf = (base: string, head: string): string => unifiedDiff(PATH, base, head);
const rulesFired = (base: string, head: string): string[] => diffHeuristicFirings(diffOf(base, head)).map((f) => f.rule);
const bounds = (lineCount: number) => [{ path: PATH, lineCount }];

describe("arms", () => {
  it("lists the four preregistered baselines", () => {
    expect([...BASELINE_IDS]).toEqual(["approve-all", "flag-every-hunk", "diff-heuristic", "static-analysis"]);
  });
});

describe("approve-all", () => {
  it("approves with no findings", () => {
    const r = approveAll(bounds(10));
    expect(r.status).toBe("valid");
    expect(r.review).toEqual({ verdict: "approve", findings: [] });
  });
});

describe("diff parser", () => {
  it("numbers head lines and finds the deletion anchor", () => {
    const base = text("a", "b", "guard", "c", "d");
    const head = text("a", "b", "c", "d");
    const files = parseUnifiedDiff(diffOf(base, head));
    expect(files[0]!.path).toBe(PATH);
    const runs = changeRuns(files);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.removed.map((l) => l.text)).toEqual(["guard"]);
    // Removed between head lines 2 ("b") and 3 ("c"): two-line anchor [2, 3] (region/v1 convention).
    expect([runs[0]!.startLine, runs[0]!.endLine]).toEqual([2, 3]);
  });

  it("an added run points at the added head lines", () => {
    const runs = changeRuns(parseUnifiedDiff(diffOf(text("a", "b", "c"), text("a", "X", "Y", "c"))));
    expect([runs[0]!.startLine, runs[0]!.endLine]).toEqual([2, 3]);
  });
});

describe("flag-every-hunk", () => {
  it("splits a hunk's head range into <= 20-line windows", () => {
    expect(hunkWindows(1, 45)).toEqual([
      { startLine: 1, endLine: 20 },
      { startLine: 21, endLine: 40 },
      { startLine: 41, endLine: 45 },
    ]);
    expect(hunkWindows(5, 0)).toEqual([{ startLine: 5, endLine: 5 }]);
  });

  it("flags the whole head-side hunk (context included) as requires_change", () => {
    const base = text(...Array.from({ length: 30 }, (_, i) => `line ${i + 1}`));
    const head = base.replace("line 10\n", "line ten\n");
    const r = flagEveryHunk(diffOf(base, head), bounds(30));
    expect(r.review!.verdict).toBe("request_changes");
    expect(r.review!.findings.map((f) => [f.startLine, f.endLine, f.disposition])).toEqual([[7, 13, "requires_change"]]);
    expect(ReviewOutputSchema.safeParse(r.review).success).toBe(true);
  });
});

describe("diff-heuristic", () => {
  it("rule ids and rule-set hash are fixed", () => {
    expect(DIFF_HEURISTIC_RULES.map((r) => r.id)).toEqual(["removed-guard", "removed-await", "flipped-operator", "dropped-throw", "emptied-catch"]);
    expect(RULESET_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("removed guard", () => {
    const base = text("export function f(x: number | null): number {", "  if (x === null) return 0;", "  return x * 2;", "}");
    const head = text("export function f(x: number | null): number {", "  return x * 2;", "}");
    expect(rulesFired(base, head)).toEqual(["removed-guard"]);
    const firing = diffHeuristicFirings(diffOf(base, head))[0]!;
    expect([firing.startLine, firing.endLine]).toEqual([1, 2]);
  });

  it("a replaced guard is not a removed guard, but a flipped comparison is caught", () => {
    const base = text("function f(x) {", "  if (x === null) return 0;", "  return x;", "}");
    const head = text("function f(x) {", "  if (x == null) return 0;", "  return x;", "}");
    expect(rulesFired(base, head)).toEqual(["flipped-operator"]);
  });

  it("removed await", () => {
    const base = text("async function g(id) {", "  const v = await load(id);", "  return v;", "}");
    const head = text("async function g(id) {", "  const v = load(id);", "  return v;", "}");
    expect(rulesFired(base, head)).toEqual(["removed-await"]);
  });

  it("flipped relational operator, and arrows are not operators", () => {
    expect(rulesFired(text("for (let i = 0; i < n; i++) {", "}"), text("for (let i = 0; i <= n; i++) {", "}"))).toEqual(["flipped-operator"]);
    expect(rulesFired(text("const g = (a) => a > 1;"), text("const g = (a) => a >= 1;"))).toEqual(["flipped-operator"]);
    expect(rulesFired(text("const ok = a && b;"), text("const ok = a || b;"))).toEqual(["flipped-operator"]);
  });

  it("flipped negation", () => {
    expect(rulesFired(text("function h(ok) {", "  if (!ok) return;", "  go();", "}"), text("function h(ok) {", "  if (ok) return;", "  go();", "}"))).toEqual([
      "flipped-operator",
    ]);
  });

  it("dropped throw", () => {
    const base = text("function c(x) {", "  if (x < 0) {", "    throw new Error(\"negative\");", "  }", "}");
    const head = text("function c(x) {", "  if (x < 0) {", "    return;", "  }", "}");
    expect(rulesFired(base, head)).toEqual(["dropped-throw"]);
  });

  it("emptied catch (multi-line body removed, rethrow dropped)", () => {
    const base = text("try {", "  run();", "} catch (e) {", "  log(e);", "  throw e;", "}");
    const head = text("try {", "  run();", "} catch (e) {", "}");
    expect(rulesFired(base, head)).toEqual(["dropped-throw", "emptied-catch"]);
  });

  it("emptied catch (single line)", () => {
    expect(rulesFired(text("try { run(); } catch (e) { log(e); }"), text("try { run(); } catch (e) {}"))).toEqual(["emptied-catch"]);
  });

  it("an unrelated edit fires nothing and the arm approves", () => {
    const base = text("const a = 1;", "const b = 2;");
    const head = text("const a = 3;", "const b = 2;");
    expect(rulesFired(base, head)).toEqual([]);
    expect(diffHeuristic(diffOf(base, head), bounds(2)).review).toEqual({ verdict: "approve", findings: [] });
  });

  it("firings become requires_change findings with the rule id in the claim", () => {
    const r = diffHeuristic(diffOf(text("if (a < b) {", "}"), text("if (a > b) {", "}")), bounds(2));
    expect(r.review!.verdict).toBe("request_changes");
    expect(r.review!.findings[0]!.claim).toContain("flipped-operator");
  });
});

describe("static-analysis", () => {
  const report = (over: object = {}): string =>
    JSON.stringify({
      schema: "static-diagnostics/v1",
      status: "ok",
      detail: null,
      tool_versions: { typescript: "5.9.3", eslint: "9.39.0" },
      tsc: [{ file: "/work/src/calc.ts", line: 4, end_line: 4, code: 2322, category: "error", message: "Type 'string' is not assignable to type 'number'." }],
      eslint: [
        {
          filePath: "/work/src/calc.ts",
          messages: [
            { ruleId: "@typescript-eslint/no-floating-promises", severity: 2, message: "Promises must be awaited.", line: 7, endLine: 7 },
            { ruleId: "no-unused-vars", severity: 1, message: "unused", line: 2 },
          ],
        },
      ],
      ...over,
    });

  it("turns diagnostics into findings (errors requires_change, warnings uncertain), paths relative to /work", () => {
    const r = staticAnalysisFromReport(report(), bounds(10));
    expect(r.status).toBe("valid");
    expect(r.review!.verdict).toBe("request_changes");
    expect(r.review!.findings.map((f) => [f.path, f.startLine, f.disposition])).toEqual([
      [PATH, 2, "uncertain"],
      [PATH, 4, "requires_change"],
      [PATH, 7, "requires_change"],
    ]);
    expect(r.review!.findings[2]!.claim).toContain("no-floating-promises");
  });

  it("truncates a long claim to 600 code points (charCount), never splitting a surrogate pair", () => {
    const emoji = "\u{1F600}";
    const [f] = findingsFromDiagnostics([{ tool: "eslint", path: PATH, startLine: 1, endLine: 1, rule: "r", severity: "error", message: emoji.repeat(700) }]);
    expect(charCount(f!.claim)).toBe(CLAIM_MAX_CHARS);
    expect(f!.claim.startsWith("eslint r: ")).toBe(true);
    expect(f!.claim.endsWith(emoji)).toBe(true);
    expect(truncateClaim("short")).toBe("short");
    const r = staticAnalysisFromReport(
      report({ tsc: [{ file: "/work/src/calc.ts", line: 4, end_line: 4, code: 2322, category: "error", message: emoji.repeat(700) }], eslint: [] }),
      bounds(10),
    );
    expect(r.status).toBe("valid");
    expect(charCount(r.review!.findings[0]!.claim)).toBe(CLAIM_MAX_CHARS);
  });

  it("ignores diagnostics outside the touched head files", () => {
    const r = staticAnalysisFromReport(report({ tsc: [{ file: "/work/lib/other.ts", line: 1, end_line: 1, code: 1, category: "error", message: "x" }], eslint: [] }), bounds(10));
    expect(r.review).toEqual({ verdict: "approve", findings: [] });
  });

  it("infra error, timeout, unqualified sandbox and malformed reports are operational failures (non-valid)", () => {
    expect(staticAnalysisFromReport(report({ status: "infra_error", detail: "docker unavailable" }), bounds(10)).status).toBe("provider_error");
    expect(staticAnalysisFromReport(report({ status: "timeout" }), bounds(10)).status).toBe("provider_error");
    expect(staticAnalysisFromReport(report({ status: "sandbox_unqualified" }), bounds(10)).status).toBe("provider_error");
    expect(staticAnalysisFromReport("{not json", bounds(10)).status).toBe("provider_error");
    expect(staticAnalysisFromReport(JSON.stringify({ schema: "other" }), bounds(10)).status).toBe("provider_error");
  });

  it("requires a sandbox runner; without one the slot is an operational failure", async () => {
    const r = await staticAnalysis(null, [], bounds(10));
    expect(r.status).toBe("provider_error");
    expect(r.detail).toContain("sandbox_unqualified");
  });

  it("a throwing runner is an operational failure", async () => {
    const r = await staticAnalysis({ run: async () => Promise.reject(new Error("container crashed")) }, [], bounds(10));
    expect(r.status).toBe("provider_error");
    expect(r.detail).toContain("container crashed");
  });
});
