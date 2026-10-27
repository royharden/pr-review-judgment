// Pure planning and judging for corpus verification (PLAN M2 acceptance 4, K19). cli/corpus-verify.ts loads the
// corpus, runs every planned check twice through the WitnessRunner in seeded shuffled orders, and hands the runs back
// here to build witness receipts and per-task verdicts. Timeout, crash and compile failure never witness anything:
// a check is witnessed only if BOTH runs are the wanted status (WitnessReceiptSchema enforces the same rule).
import { unifiedDiff } from "../defectcorpus/diff.ts";
import { compareCodeUnits } from "../defectcorpus/order.ts";
import { touchedFiles, variantChangeId } from "../defectcorpus/projection.ts";
import { WitnessReceiptSchema } from "../defectcorpus/schema.ts";
import type { SourceFile, Task, TestRef, Variant, WitnessReceipt, WitnessRunStatus } from "../defectcorpus/schema.ts";
import { sha256Hex } from "../hash/sha256.ts";
import { filesSha256 } from "./runner.ts";
import type { WitnessRunResult, WitnessSelection } from "./runner.ts";

/**
 * Receipts for whole-file suite runs carry `test.name = "*"` (every test in `test.path`). The M1 receipt schema has a
 * single TestRef, so this sentinel marks a suite run; a hidden test literally named "*" is refused by planVerification.
 * Any other TestRef.name is the vitest LEAF title (`assertionResults[].title`, without describe-block ancestors), and it
 * must be unique within its file: sandbox/entry.mjs selects by exact leaf title and reports `selection_error` (never a
 * witness) unless exactly one test with that title ran (docs/CORPUS.md "Witness test naming").
 */
export const ALL_TESTS_IN_FILE = "*";

export interface VerificationCheck {
  /** Stable id: `<task>/<variant>/<expectation>/<test path>#<test name>`. */
  readonly checkId: string;
  readonly taskId: string;
  readonly variantId: string;
  readonly kind: Variant["kind"];
  /** Reviewer-visible neutral id of the variant: projection.ts `variantChangeId` (touched files only). */
  readonly changeId: string;
  readonly expectation: "fails" | "passes";
  readonly selection: WitnessSelection;
  readonly test: TestRef;
  readonly sourceFiles: readonly SourceFile[];
  readonly testFiles: readonly SourceFile[];
  readonly sourceHash: string;
  readonly testHash: string;
}

export class VerifyPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerifyPlanError";
  }
}

/**
 * The receipt change id of a variant. It is exactly the reviewer-visible id: projection.ts `variantChangeId`, called
 * once per variant, which hashes the spec plus base/head of the TOUCHED files only (head files identical to their base
 * are excluded), so a receipt joins the review records and the public manifest by id. projection.ts throws for a
 * variant of another task, a base path missing from the head, and a variant that touches nothing; those become
 * VerifyPlanError. projection.ts does NOT refuse a touched file whose unified diff is empty (only a trailing newline
 * or CRLF/LF differs, or an added empty file): that change would be invisible in the reviewer diff, so it is refused
 * here (M1 files are not edited by M2).
 */
function receiptChangeId(task: Task, variant: Variant): string {
  try {
    for (const f of touchedFiles(variant, task)) {
      if (unifiedDiff(f.path, f.base, f.head) === "") {
        throw new VerifyPlanError(`${task.task_id}/${variant.variant_id}: ${f.path} differs from its base but has an empty diff`);
      }
    }
    return variantChangeId(variant, task);
  } catch (error) {
    if (error instanceof VerifyPlanError) throw error;
    throw new VerifyPlanError(`${task.task_id}/${variant.variant_id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Checks for one task:
 * - defect: its witness test (named) must FAIL on the defect, and the same named test must PASS on the clean variant;
 * - clean: every hidden test file (whole file) must PASS;
 * - near_miss: every hidden test file (whole file, which includes the guard test) must PASS; the guard test's file
 *   must be one of the task's hidden test files.
 * Requires exactly one clean variant per task, unique variant ids (check ids embed them) and that every variant
 * belongs to the task.
 */
export function planVerification(task: Task, variants: readonly Variant[]): VerificationCheck[] {
  const own = variants.filter((v) => v.task_id === task.task_id);
  if (own.length !== variants.length) throw new VerifyPlanError(`${task.task_id}: variant from another task`);
  if (new Set(own.map((v) => v.variant_id)).size !== own.length) throw new VerifyPlanError(`${task.task_id}: duplicate variant id`);
  const changeIds = new Map<Variant, string>(own.map((v) => [v, receiptChangeId(task, v)]));
  const cleans = own.filter((v) => v.kind === "clean");
  if (cleans.length !== 1) throw new VerifyPlanError(`${task.task_id}: expected exactly one clean variant, found ${cleans.length}`);
  const clean = cleans[0]!;
  const hidden = [...task.hidden_tests].sort((a, b) => compareCodeUnits(a.path, b.path));
  const hiddenPaths = new Set(hidden.map((f) => f.path));
  const testHash = filesSha256(hidden);

  const check = (variant: Variant, expectation: "fails" | "passes", test: TestRef): VerificationCheck => {
    if (!hiddenPaths.has(test.path)) throw new VerifyPlanError(`${task.task_id}/${variant.variant_id}: ${test.path} is not a hidden test file`);
    const selection: WitnessSelection =
      test.name === ALL_TESTS_IN_FILE ? { kind: "file", path: test.path } : { kind: "named", test };
    return {
      checkId: `${task.task_id}/${variant.variant_id}/${expectation}/${test.path}#${test.name}`,
      taskId: task.task_id,
      variantId: variant.variant_id,
      kind: variant.kind,
      changeId: changeIds.get(variant)!,
      expectation,
      selection,
      test,
      sourceFiles: variant.head_files,
      testFiles: hidden,
      sourceHash: filesSha256(variant.head_files),
      testHash,
    };
  };

  const out: VerificationCheck[] = [];
  const suite = (variant: Variant) => {
    for (const f of hidden) out.push(check(variant, "passes", { path: f.path, name: ALL_TESTS_IN_FILE }));
  };
  for (const v of own) {
    if (v.kind === "defect") {
      if (v.witness_test.name === ALL_TESTS_IN_FILE) throw new VerifyPlanError(`${v.variant_id}: witness test may not be named "*"`);
      out.push(check(v, "fails", v.witness_test));
      out.push(check(clean, "passes", v.witness_test));
    } else if (v.kind === "clean") {
      suite(v);
    } else {
      if (!hiddenPaths.has(v.guard_test.path)) throw new VerifyPlanError(`${v.variant_id}: guard test file is not a hidden test file`);
      suite(v);
    }
  }
  // The clean twin's named witness runs repeat across defects that share a witness test; keep one of each.
  const unique = new Map(out.map((c) => [c.checkId, c]));
  return [...unique.values()].sort((a, b) => compareCodeUnits(a.checkId, b.checkId));
}

// ---------------------------------------------------------------------------------------------------------------
// Seeded order. A small local PRNG (mulberry32) keeps this module self-contained; M3's src/core/stats/prng may
// replace it, which would change run orders but not any verdict.
// ---------------------------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle with a seeded PRNG; returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Derived uint32 seed for (base seed, check, run number): the in-container vitest shuffle seed. */
export function runSeed(baseSeed: number, checkId: string, run: 1 | 2): number {
  return Number.parseInt(sha256Hex(`pr-review-judgment/run-seed/v1\u0000${baseSeed}\u0000${checkId}\u0000${run}`).slice(0, 8), 16) >>> 0;
}

/** Order of checks for run 1 and run 2: two different seeded shuffles of the same check list. */
export function runOrders(checks: readonly VerificationCheck[], baseSeed: number): [VerificationCheck[], VerificationCheck[]] {
  const s1 = runSeed(baseSeed, "order", 1);
  const s2 = runSeed(baseSeed, "order", 2);
  return [seededShuffle(checks, s1), seededShuffle(checks, s2)];
}

// ---------------------------------------------------------------------------------------------------------------
// Receipts and verdicts
// ---------------------------------------------------------------------------------------------------------------

export function buildReceipt(
  check: VerificationCheck,
  runs: readonly [WitnessRunResult, WitnessRunResult],
  executor: string,
  recordedAt: string,
): WitnessReceipt {
  const [a, b] = runs;
  const wanted: WitnessRunStatus = check.expectation === "fails" ? "assertion_fail" : "pass";
  const consistent = a.status === b.status;
  const qualified = a.imageDigest !== null && b.imageDigest !== null && a.probeReceiptSha256 !== null && b.probeReceiptSha256 !== null;
  return WitnessReceiptSchema.parse({
    schema: "witness-receipt/v1",
    task_id: check.taskId,
    change_id: check.changeId,
    target_sha256: check.sourceHash,
    test: check.test,
    expectation: check.expectation,
    runs: [
      { status: a.status, duration_ms: Math.max(0, Math.round(a.durationMs)), output_sha256: a.outputSha256 },
      { status: b.status, duration_ms: Math.max(0, Math.round(b.durationMs)), output_sha256: b.outputSha256 },
    ],
    consistent,
    witnessed: consistent && a.status === wanted,
    sandbox_image_digest: qualified ? a.imageDigest : null,
    probe_receipt_sha256: qualified ? a.probeReceiptSha256 : null,
    executor,
    recorded_at: recordedAt,
  });
}

export interface TaskVerdict {
  readonly taskId: string;
  readonly verified: boolean;
  /** Check ids whose receipt is missing or not witnessed. */
  readonly failing: readonly string[];
}

/** A task is verified only if every planned check has a witnessed receipt. */
export function judgeTask(taskId: string, checks: readonly VerificationCheck[], receipts: ReadonlyMap<string, WitnessReceipt>): TaskVerdict {
  const failing = checks
    .filter((c) => c.taskId === taskId)
    .filter((c) => receipts.get(c.checkId)?.witnessed !== true)
    .map((c) => c.checkId);
  return { taskId, verified: failing.length === 0, failing };
}
