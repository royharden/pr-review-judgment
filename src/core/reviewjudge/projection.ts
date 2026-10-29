// Reviewer input (PLAN §3.5, M3 acceptance 1). Pure.
// The reviewer projection itself is M1's (src/core/defectcorpus/projection.ts): neutral id, spec, unified diff and
// line-numbered full heads of the touched files, nothing else. This module adds what the review engine needs on top:
// - the head-file bounds the output parser and matcher check against;
// - the per-(reviewer, repeat) seeded presentation order of changes, with its seed recorded.
// File order inside one prompt is NOT shuffled: it is path-sorted (M1), so the same change yields byte-identical
// prompts for both reviewers and every repeat; only the order in which changes are sent varies.
import { compareCodeUnits } from "../defectcorpus/order.ts";
import { toReviewerProjection, type ReviewerProjection } from "../defectcorpus/projection.ts";
import type { Task, Variant } from "../defectcorpus/schema.ts";
import { deriveSeed, seededShuffle } from "../stats/prng.ts";
import type { HeadFileBounds } from "./contract.ts";

export { toReviewerProjection };
export type { ReviewerProjection };

export function headFileBounds(projection: ReviewerProjection): HeadFileBounds[] {
  return projection.files.map((f) => ({ path: f.path, lineCount: f.lineCount }));
}

/** Projection of a variant plus its bounds. */
export function reviewerInput(variant: Variant, task: Task): { projection: ReviewerProjection; bounds: HeadFileBounds[] } {
  const projection = toReviewerProjection(variant, task);
  return { projection, bounds: headFileBounds(projection) };
}

export const PRESENTATION_ORDER_POLICY = "presentation-order/v1" as const;

export interface PresentationOrder {
  readonly policy: typeof PRESENTATION_ORDER_POLICY;
  readonly baseSeed: number;
  readonly reviewer: string;
  readonly repeat: number;
  /** deriveSeed(baseSeed, "presentation-order", reviewer, repeat): recorded with the run. */
  readonly seed: number;
  readonly changeIds: readonly string[];
}

/**
 * The order in which one reviewer sees the changes in one repeat. The input set is first sorted (so the caller's
 * order cannot influence the result), then shuffled with a seed derived from (baseSeed, reviewer, repeat).
 * Duplicate ids are refused.
 */
export function presentationOrder(changeIds: readonly string[], baseSeed: number, reviewer: string, repeat: number): PresentationOrder {
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`presentationOrder: repeat must be a positive integer, got ${repeat}`);
  if (reviewer.length === 0) throw new Error("presentationOrder: reviewer id required");
  const sorted = [...changeIds].sort(compareCodeUnits);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) throw new Error(`presentationOrder: duplicate change id ${sorted[i]}`);
  }
  const seed = deriveSeed(baseSeed, "presentation-order", reviewer, String(repeat));
  return { policy: PRESENTATION_ORDER_POLICY, baseSeed, reviewer, repeat, seed, changeIds: seededShuffle(sorted, seed) };
}
