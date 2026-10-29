// Admission requirements for operator-seeded defects. A candidate from enumerateMutations is NOT a defect: it is
// admitted only with evidence that it compiles and that an executable witness separates it from its clean twin.
// Neither check can run here (pure core, and Dirty Mode); they are encoded as requirements over evidence that the
// sandbox produces later (DEFERRED-VALIDATION DV-15 compile, DV-16 witness receipts).
import type { WitnessReceipt } from "../defectcorpus/schema.ts";

export const MUTANT_ADMISSION_REQUIREMENTS = [
  {
    id: "MA1",
    requirement: "The mutation applies cleanly: the source slice at its range equals `original` (applyMutation).",
    checked: "by applyMutation at seeding time",
  },
  {
    id: "MA2",
    requirement: "The mutated task files type-check: `tsc --noEmit` under the strict task tsconfig passes inside the qualified sandbox.",
    checked: "deferred (DEFERRED-VALIDATION DV-15); evidence = compile: pass",
  },
  {
    id: "MA3",
    requirement:
      "A named hidden witness test fails (assertion_fail) on the mutant in both runs, and the same test passes on the clean twin in both runs (two witness receipts, both witnessed).",
    checked: "deferred (corpus-verify, DEFERRED-VALIDATION DV-16)",
  },
  {
    id: "MA4",
    requirement: "The defect is one change: exactly one mutation applied to one file of the clean twin.",
    checked: "by the seeding pipeline (M4 seed-b, dev corpus M5)",
  },
] as const;

export type MutantRequirementId = (typeof MUTANT_ADMISSION_REQUIREMENTS)[number]["id"];

export interface MutantAdmissionEvidence {
  /** Result of `tsc --noEmit` on the mutated task files inside the sandbox; `not_run` until DV-15 runs. */
  readonly compile: "pass" | "fail" | "not_run";
  /** Number of mutations applied to produce this variant from its clean twin. */
  readonly mutationsApplied: number;
  readonly defectReceipt: WitnessReceipt | null;
  readonly twinReceipt: WitnessReceipt | null;
}

export interface MutantAdmissionResult {
  readonly admitted: boolean;
  readonly unmet: readonly MutantRequirementId[];
}

/** Pure check of the evidence. Missing evidence is unmet, never assumed. */
export function evaluateMutantAdmission(e: MutantAdmissionEvidence): MutantAdmissionResult {
  const unmet: MutantRequirementId[] = [];
  if (e.compile !== "pass") unmet.push("MA2");
  const d = e.defectReceipt;
  const t = e.twinReceipt;
  const witnessOk =
    d !== null &&
    t !== null &&
    d.expectation === "fails" &&
    d.witnessed &&
    t.expectation === "passes" &&
    t.witnessed &&
    d.task_id === t.task_id &&
    d.test.path === t.test.path &&
    d.test.name === t.test.name &&
    d.target_sha256 !== t.target_sha256;
  if (!witnessOk) unmet.push("MA3");
  if (e.mutationsApplied !== 1) unmet.push("MA4");
  return { admitted: unmet.length === 0, unmet };
}
