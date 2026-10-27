// Shared shape of the deterministic baseline arms (PLAN §6 "Arms"). Pure.
// Every baseline emits the SAME review contract as a model reviewer (ReviewOutputSchema, <= 10 findings, head paths
// and bounds), so it flows through the identical parser-independent classifier and matcher. Deterministic baselines
// run once (repeat 1).
import { MAX_FINDINGS, ReviewOutputSchema, type HeadFileBounds, type ReviewFinding, type ReviewOutput, type ReviewStatus } from "../contract.ts";
import { compareCodeUnits } from "../../defectcorpus/order.ts";

export const BASELINE_IDS = ["approve-all", "flag-every-hunk", "diff-heuristic", "static-analysis"] as const;
export type BaselineId = (typeof BASELINE_IDS)[number];

export interface BaselineResult {
  readonly arm: BaselineId;
  readonly status: ReviewStatus;
  /** Present only when status is valid. */
  readonly review: ReviewOutput | null;
  readonly detail: string | null;
  /** Findings dropped by the 10-finding cap (reported, never silently lost). */
  readonly droppedFindings: number;
}

export function sortFindings(findings: readonly ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort(
    (x, y) => compareCodeUnits(x.path, y.path) || x.startLine - y.startLine || x.endLine - y.endLine || compareCodeUnits(x.claim, y.claim),
  );
}

/** Keep findings inside head files and bounds, sort, cap at 10, and validate the contract shape. */
export function finishBaseline(arm: BaselineId, findings: readonly ReviewFinding[], headFiles: readonly HeadFileBounds[]): BaselineResult {
  const bounds = new Map(headFiles.map((f) => [f.path, f.lineCount]));
  const inBounds = findings.filter((f) => {
    const n = bounds.get(f.path);
    return n !== undefined && f.startLine >= 1 && f.endLine >= f.startLine && f.endLine <= n;
  });
  const sorted = sortFindings(inBounds);
  const kept = sorted.slice(0, MAX_FINDINGS);
  const verdict = kept.some((f) => f.disposition === "requires_change") ? "request_changes" : "approve";
  const review = ReviewOutputSchema.parse({ verdict, findings: kept });
  const outOfBounds = findings.length - inBounds.length;
  return {
    arm,
    status: "valid",
    review,
    detail: outOfBounds > 0 ? `${outOfBounds} finding(s) outside head files ignored` : null,
    droppedFindings: sorted.length - kept.length,
  };
}

/** An infrastructure failure of a baseline is an operational failure: a non-valid slot (UNAVAILABLE), never a MISS. */
export function operationalFailure(arm: BaselineId, detail: string): BaselineResult {
  return { arm, status: "provider_error", review: null, detail: `operational failure: ${detail}`, droppedFindings: 0 };
}
