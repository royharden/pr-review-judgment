// Outcome classification (PLAN §3.2, §6, M3 acceptance 4). Pure.
//
// Seeded (defect) slot, precedence first match wins:
//   non-valid status                                            -> UNAVAILABLE (also a non-HIT)
//   valid request_changes AND >= 1 localized requires_change    -> HIT ("actionable localization"; a proxy, not proof)
//   >= 1 localized finding (any disposition, any verdict)        -> DEFER
//   valid request_changes                                       -> WRONG-PLACE
//   otherwise (approve, nothing localized)                       -> MISS
// "any-localized" (>= 1 localized finding, any disposition) is reported as its own column.
//
// Clean / near-miss slots (PLAN §6), over the PLANNED slots of a cell (one observation per planned slot; a slot
// that never reached a terminal status is passed as `missing` and counts as non-valid):
//   false rejection            = valid request_changes / valid replies
//   conservative non-approval  = (valid request_changes + non-valid) / planned slots
//   completion coverage        = valid replies / planned slots
//   burden                     = requires_change findings per valid reply, and output tokens per reply with usage
// Localization-match fraction over seeded slots = localized findings / findings in valid replies. It is NEVER
// called factual precision (a finding outside the region may still be a true problem).
import type { FileRegion } from "../defectcorpus/region.ts";
import { ratio, type Value } from "../stats/value.ts";
import type { HeadFileBounds, ReviewOutput, ReviewStatus, ReviewVerdict } from "./contract.ts";
import { matchFindings, type MatchTrace } from "./matcher.ts";

export const DEFECT_OUTCOMES = ["HIT", "DEFER", "WRONG-PLACE", "MISS", "UNAVAILABLE"] as const;
export type DefectOutcome = (typeof DEFECT_OUTCOMES)[number];

/** The parts of a review result classification needs. */
export interface SlotReply {
  readonly status: ReviewStatus;
  readonly review: ReviewOutput | null;
}

export interface DefectClassification {
  readonly outcome: DefectOutcome;
  readonly hit: boolean;
  readonly anyLocalized: boolean;
  /** null for non-valid replies (nothing was matched). */
  readonly trace: MatchTrace | null;
}

function validReview(reply: SlotReply): ReviewOutput | null {
  if (reply.status !== "valid") return null;
  if (reply.review === null) throw new Error("classify: a valid reply must carry its review");
  return reply.review;
}

export function classifyDefectSlot(
  reply: SlotReply,
  regions: readonly FileRegion[],
  headFiles: readonly HeadFileBounds[],
  k: number,
): DefectClassification {
  if (regions.length === 0) throw new Error("classifyDefectSlot: a seeded change has at least one region");
  const review = validReview(reply);
  if (review === null) return { outcome: "UNAVAILABLE", hit: false, anyLocalized: false, trace: null };
  const trace = matchFindings(review.findings, regions, headFiles, k);
  const requestChanges = review.verdict === "request_changes";
  let outcome: DefectOutcome;
  if (requestChanges && trace.anyActionableLocalized) outcome = "HIT";
  else if (trace.anyLocalized) outcome = "DEFER";
  else if (requestChanges) outcome = "WRONG-PLACE";
  else outcome = "MISS";
  return { outcome, hit: outcome === "HIT", anyLocalized: trace.anyLocalized, trace };
}

/** One planned clean or near-miss slot. `missing` = planned but never terminal (counted as non-valid). */
export interface CleanSlotObservation {
  readonly status: ReviewStatus | "missing";
  /** The verdict of a valid reply; null otherwise. */
  readonly verdict: ReviewVerdict | null;
  /** requires_change findings in a valid reply; 0 otherwise. */
  readonly requiresChangeFindings: number;
  /** Output tokens from the envelope usage; null when usage was not reported (never treated as 0). */
  readonly outputTokens: number | null;
}

export function observeCleanSlot(reply: SlotReply, outputTokens: number | null): CleanSlotObservation {
  const review = validReview(reply);
  return {
    status: reply.status,
    verdict: review === null ? null : review.verdict,
    requiresChangeFindings: review === null ? 0 : review.findings.filter((f) => f.disposition === "requires_change").length,
    outputTokens,
  };
}

export interface CleanMetrics {
  readonly planned: number;
  readonly missing: number;
  readonly validReplies: number;
  readonly validRequestChanges: number;
  readonly nonValid: number;
  readonly falseRejection: Value;
  readonly conservativeNonApproval: Value;
  readonly completionCoverage: Value;
  readonly requiresChangeFindingsPerValidReply: Value;
  readonly outputTokensPerReply: Value;
  readonly repliesWithUsage: number;
}

/** Metrics over the PLANNED slots of one cell: pass one observation per planned slot (missing ones as `missing`). */
export function cleanMetrics(slots: readonly CleanSlotObservation[]): CleanMetrics {
  let validReplies = 0;
  let validRequestChanges = 0;
  let missing = 0;
  let requiresChange = 0;
  let tokens = 0;
  let repliesWithUsage = 0;
  for (const slot of slots) {
    if (slot.status === "missing") missing++;
    if (slot.status === "valid") {
      if (slot.verdict === null) throw new Error("cleanMetrics: a valid slot must carry its verdict");
      validReplies++;
      if (slot.verdict === "request_changes") validRequestChanges++;
      requiresChange += slot.requiresChangeFindings;
    }
    if (slot.outputTokens !== null) {
      tokens += slot.outputTokens;
      repliesWithUsage++;
    }
  }
  const planned = slots.length;
  const nonValid = planned - validReplies;
  return {
    planned,
    missing,
    validReplies,
    validRequestChanges,
    nonValid,
    falseRejection: ratio(validRequestChanges, validReplies, "no valid replies"),
    conservativeNonApproval: ratio(validRequestChanges + nonValid, planned, "no planned slots"),
    completionCoverage: ratio(validReplies, planned, "no planned slots"),
    requiresChangeFindingsPerValidReply: ratio(requiresChange, validReplies, "no valid replies"),
    outputTokensPerReply: ratio(tokens, repliesWithUsage, "no reply reported usage"),
    repliesWithUsage,
  };
}

export interface LocalizationMatchFraction {
  readonly label: "localization-match fraction (not factual precision)";
  readonly findings: number;
  readonly localized: number;
  readonly fraction: Value;
  readonly requiresChangeFindings: number;
  readonly requiresChangeLocalized: number;
  readonly requiresChangeFraction: Value;
}

export function localizationMatchFraction(classifications: readonly DefectClassification[]): LocalizationMatchFraction {
  let findings = 0;
  let localized = 0;
  let rc = 0;
  let rcLocalized = 0;
  for (const c of classifications) {
    if (c.trace === null) continue;
    for (const f of c.trace.findings) {
      findings++;
      if (f.localized) localized++;
      if (f.disposition === "requires_change") {
        rc++;
        if (f.localized) rcLocalized++;
      }
    }
  }
  return {
    label: "localization-match fraction (not factual precision)",
    findings,
    localized,
    fraction: ratio(localized, findings, "no findings in valid replies"),
    requiresChangeFindings: rc,
    requiresChangeLocalized: rcLocalized,
    requiresChangeFraction: ratio(rcLocalized, rc, "no requires_change findings in valid replies"),
  };
}
