// From provider envelope to one of the 8 review statuses (PLAN §3.8, M3 acceptance 2). Pure.
//
// Precedence (first match wins):
//   1. transport/provider outcome: timeout -> timeout; transport_unknown -> unknown; provider_error -> provider_error
//      (every HTTP error, whether its billing is rejected_unbilled or unknown; billing is the ledger's concern, M4)
//   2. identity is not an exact match with the lock (mismatch or unreported) -> identity_mismatch
//   3. stop kind refusal -> refusal
//   4. stop kind truncated -> truncated
//   5. stop kind other (tool use, pause, unrecognized stop) -> provider_error
//   6. no answer text -> schema_invalid
//   7. parseReviewOutput -> valid | schema_invalid
// There is no repair step and no retry path: a non-valid status is final for its slot (the run-state machine may
// re-issue only a host-confirmed pre-send failure, M4).
import { parseReviewOutput, type HeadFileBounds, type ReviewOutput, type ReviewStatus } from "./contract.ts";
import type { ReviewEnvelope } from "../providers/port.ts";

export interface ReviewResult {
  readonly status: ReviewStatus;
  /** Present only when status is valid. */
  readonly review: ReviewOutput | null;
  readonly detail: string | null;
  readonly mock: boolean;
}

export function resolveReviewResult(envelope: ReviewEnvelope, headFiles: readonly HeadFileBounds[]): ReviewResult {
  const mock = envelope.mock;
  const fail = (status: ReviewStatus, detail: string | null): ReviewResult => ({ status, review: null, detail, mock });
  switch (envelope.outcome) {
    case "timeout":
      return fail("timeout", envelope.detail);
    case "transport_unknown":
      return fail("unknown", envelope.detail);
    case "provider_error":
      return fail("provider_error", envelope.detail);
    case "completed":
      break;
  }
  if (envelope.identity !== "match") {
    return fail("identity_mismatch", `requested ${envelope.requestedModel}, reported ${envelope.reportedModel ?? "nothing"} (${envelope.identity})`);
  }
  if (envelope.stopKind === "refusal") return fail("refusal", envelope.detail);
  if (envelope.stopKind === "truncated") return fail("truncated", envelope.stopReasonRaw);
  if (envelope.stopKind !== "complete") return fail("provider_error", `unexpected stop: ${envelope.stopReasonRaw ?? "none"}`);
  if (envelope.text === null || envelope.text.trim().length === 0) return fail("schema_invalid", "no answer text");
  const parsed = parseReviewOutput(envelope.text, headFiles);
  if (parsed.status === "valid") return { status: "valid", review: parsed.review, detail: null, mock };
  return fail("schema_invalid", parsed.errors.join("; "));
}
