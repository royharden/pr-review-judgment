// diff-heuristic baseline (PLAN §6, §0(b)). Pure.
//
// Five fixed rules over the reviewer-visible unified diff ONLY (no head files, no tests, no labels). Each change run
// (maximal run of removed/added lines inside one hunk) is checked against every rule; each rule that fires gives one
// requires_change finding at the run's head interval (added lines, or the two-line anchor of a pure removal).
//   removed-guard     a removed `if (...)` guard that returned/threw/continued/broke, not replaced by any `if`
//   removed-await     fewer `await` on the added side than on the removed side
//   flipped-operator  a removed/added line pair identical except for a comparison/logical operator, or except for
//                     a logical negation `!`
//   dropped-throw     fewer `throw` on the added side than on the removed side (dropped throw/rethrow)
//   emptied-catch     an added empty `catch {}` that was not empty before, or a removal that empties a catch body
// The rules were written from the PLAN only, before any dev review output or held-out data existed. They are frozen
// by RULESET_SHA256 (over the version, ids, descriptions and pattern sources); protocol/diff-heuristic.rules.json
// (M5) records that hash. Any change to rule logic must bump DIFF_HEURISTIC_VERSION, which changes the hash.
import { hashCanonical } from "../../defectcorpus/hashes.ts";
import type { HeadFileBounds, ReviewFinding } from "../contract.ts";
import { finishBaseline, type BaselineResult } from "./common.ts";
import { changeRuns, parseUnifiedDiff, type ChangeRun } from "./diffparse.ts";

export const DIFF_HEURISTIC_VERSION = "diff-heuristic/v1" as const;

const GUARD_IF = /\bif\s*\(/;
const GUARD_EXIT = /\b(return|throw|continue|break)\b/;
const AWAIT = /\bawait\b/g;
const THROW = /\bthrow\b/g;
const OPERATOR = /===|!==|==|!=|<=|>=|&&|\|\||\?\?|<|>/g;
const ARROW = /=>/g;
const NEGATION = /!(?!=)/g;
const EMPTY_CATCH = /\bcatch\s*(\([^)]*\))?\s*\{\s*\}/g;
const CATCH_OPEN = /\bcatch\s*(\([^)]*\))?\s*\{\s*$/;
const BLOCK_CLOSE = /^\s*\}/;

export const DIFF_HEURISTIC_RULES = [
  {
    id: "removed-guard",
    description: "a removed if-guard that exits (return/throw/continue/break) is not replaced by another if",
    patterns: [GUARD_IF.source, GUARD_EXIT.source],
  },
  { id: "removed-await", description: "the added side has fewer await than the removed side", patterns: [AWAIT.source] },
  {
    id: "flipped-operator",
    description: "a removed/added line pair differs only in a comparison or logical operator, or only in a negation",
    patterns: [OPERATOR.source, ARROW.source, NEGATION.source],
  },
  { id: "dropped-throw", description: "the added side has fewer throw than the removed side", patterns: [THROW.source] },
  {
    id: "emptied-catch",
    description: "an added empty catch block that was not empty before, or a removal that empties a catch body",
    patterns: [EMPTY_CATCH.source, CATCH_OPEN.source, BLOCK_CLOSE.source],
  },
] as const;

export type DiffHeuristicRuleId = (typeof DIFF_HEURISTIC_RULES)[number]["id"];

export const RULESET_SHA256: string = hashCanonical({
  domain: "pr-review-judgment/diff-heuristic-ruleset",
  version: DIFF_HEURISTIC_VERSION,
  rules: DIFF_HEURISTIC_RULES.map((r) => ({ id: r.id, description: r.description, patterns: [...r.patterns] })),
});

const count = (texts: readonly string[], re: RegExp): number => texts.reduce((s, t) => s + (t.match(re)?.length ?? 0), 0);

function removedGuard(run: ChangeRun): boolean {
  const removed = run.removed.map((l) => l.text);
  const hasRemovedIf = removed.some((t) => GUARD_IF.test(t));
  const exits = removed.some((t) => GUARD_EXIT.test(t));
  const addedIf = run.added.some((l) => GUARD_IF.test(l.text));
  return hasRemovedIf && exits && !addedIf;
}

function removedAwait(run: ChangeRun): boolean {
  return count(run.removed.map((l) => l.text), AWAIT) > count(run.added.map((l) => l.text), AWAIT);
}

function droppedThrow(run: ChangeRun): boolean {
  return count(run.removed.map((l) => l.text), THROW) > count(run.added.map((l) => l.text), THROW);
}

/** Operator skeleton: the line with `=>` protected and every operator replaced by one placeholder, plus the list. */
function operatorSkeleton(text: string): { skeleton: string; operators: string[] } {
  const protectedText = text.replace(ARROW, "\u0001");
  const operators = protectedText.match(OPERATOR) ?? [];
  return { skeleton: protectedText.replace(OPERATOR, "\u0000"), operators: [...operators] };
}

function flippedOperator(run: ChangeRun): boolean {
  if (run.removed.length === 0 || run.removed.length !== run.added.length) return false;
  for (let i = 0; i < run.removed.length; i++) {
    const before = run.removed[i]!.text;
    const after = run.added[i]!.text;
    if (before === after) continue;
    const a = operatorSkeleton(before);
    const b = operatorSkeleton(after);
    if (a.skeleton === b.skeleton && a.operators.join(" ") !== b.operators.join(" ")) return true;
    if (before.replace(NEGATION, "") === after.replace(NEGATION, "")) return true;
  }
  return false;
}

function emptiedCatch(run: ChangeRun): boolean {
  const addedEmpty = count(run.added.map((l) => l.text), EMPTY_CATCH);
  const removedEmpty = count(run.removed.map((l) => l.text), EMPTY_CATCH);
  if (addedEmpty > removedEmpty) return true;
  return (
    run.added.length === 0 &&
    run.removed.length > 0 &&
    run.before !== null &&
    run.after !== null &&
    CATCH_OPEN.test(run.before.text) &&
    BLOCK_CLOSE.test(run.after.text)
  );
}

const CHECKS: Readonly<Record<DiffHeuristicRuleId, (run: ChangeRun) => boolean>> = {
  "removed-guard": removedGuard,
  "removed-await": removedAwait,
  "flipped-operator": flippedOperator,
  "dropped-throw": droppedThrow,
  "emptied-catch": emptiedCatch,
};

export interface RuleFiring {
  readonly rule: DiffHeuristicRuleId;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** Every rule firing, in run order then rule order. */
export function diffHeuristicFirings(diff: string): RuleFiring[] {
  const firings: RuleFiring[] = [];
  for (const run of changeRuns(parseUnifiedDiff(diff))) {
    for (const rule of DIFF_HEURISTIC_RULES) {
      if (CHECKS[rule.id](run)) firings.push({ rule: rule.id, path: run.path, startLine: run.startLine, endLine: run.endLine });
    }
  }
  return firings;
}

export function diffHeuristic(diff: string, headFiles: readonly HeadFileBounds[]): BaselineResult {
  const descriptions = new Map<string, string>(DIFF_HEURISTIC_RULES.map((r) => [r.id, r.description]));
  const findings: ReviewFinding[] = diffHeuristicFirings(diff).map((f) => ({
    path: f.path,
    startLine: f.startLine,
    endLine: f.endLine,
    severity: "high",
    claim: `diff-heuristic ${f.rule}: ${descriptions.get(f.rule)!}`,
    confidence: 0.6,
    disposition: "requires_change",
  }));
  return finishBaseline("diff-heuristic", findings, headFiles);
}
