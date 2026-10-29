// Written, never run in Dirty Mode. PLAN M3.4: precedence HIT -> DEFER -> WRONG-PLACE -> MISS; non-valid ->
// UNAVAILABLE; clean metrics per §6.
import { describe, expect, it } from "vitest";
import type { FileRegion } from "../../../src/core/defectcorpus/region.ts";
import {
  classifyDefectSlot,
  cleanMetrics,
  localizationMatchFraction,
  observeCleanSlot,
  type CleanSlotObservation,
} from "../../../src/core/reviewjudge/classify.ts";
import { REVIEW_STATUSES, type ReviewFinding, type ReviewOutput } from "../../../src/core/reviewjudge/contract.ts";

const PATH = "src/window.ts";
const files = [{ path: PATH, lineCount: 60 }];
const regions: FileRegion[] = [{ path: PATH, startLine: 12, endLine: 13 }];
const at = (startLine: number, disposition: ReviewFinding["disposition"] = "requires_change"): ReviewFinding => ({
  path: PATH,
  startLine,
  endLine: startLine,
  severity: "medium",
  claim: "x",
  confidence: 0.5,
  disposition,
});
const valid = (review: ReviewOutput) => ({ status: "valid" as const, review });
const outcome = (review: ReviewOutput, k = 2) => classifyDefectSlot(valid(review), regions, files, k).outcome;

describe("defect precedence", () => {
  it("HIT: valid request_changes with a localized requires_change finding", () => {
    expect(outcome({ verdict: "request_changes", findings: [at(12)] })).toBe("HIT");
    expect(outcome({ verdict: "request_changes", findings: [at(40), at(13)] })).toBe("HIT");
  });

  it("DEFER: localized finding but not a HIT (excused disposition, or approve verdict)", () => {
    expect(outcome({ verdict: "request_changes", findings: [at(12, "acceptable")] })).toBe("DEFER");
    expect(outcome({ verdict: "request_changes", findings: [at(12, "uncertain"), at(40)] })).toBe("DEFER");
    expect(outcome({ verdict: "approve", findings: [at(12)] })).toBe("DEFER");
  });

  it("WRONG-PLACE: valid request_changes, nothing localized", () => {
    expect(outcome({ verdict: "request_changes", findings: [at(40)] })).toBe("WRONG-PLACE");
    expect(outcome({ verdict: "request_changes", findings: [] })).toBe("WRONG-PLACE");
  });

  it("MISS: approve and nothing localized", () => {
    expect(outcome({ verdict: "approve", findings: [] })).toBe("MISS");
    expect(outcome({ verdict: "approve", findings: [at(40)] })).toBe("MISS");
  });

  it("UNAVAILABLE for every non-valid status (and never a HIT)", () => {
    for (const status of REVIEW_STATUSES.filter((s) => s !== "valid")) {
      const c = classifyDefectSlot({ status, review: null }, regions, files, 2);
      expect(c.outcome).toBe("UNAVAILABLE");
      expect(c.hit).toBe(false);
      expect(c.trace).toBeNull();
    }
  });

  it("k changes the outcome column, not the precedence", () => {
    const review: ReviewOutput = { verdict: "request_changes", findings: [at(15)] };
    expect(outcome(review, 0)).toBe("WRONG-PLACE");
    expect(outcome(review, 2)).toBe("HIT");
    expect(outcome(review, 5)).toBe("HIT");
  });

  it("duplicate findings give one HIT outcome", () => {
    const c = classifyDefectSlot(valid({ verdict: "request_changes", findings: [at(12), at(12)] }), regions, files, 2);
    expect(c.outcome).toBe("HIT");
    expect(c.trace!.localizedCount).toBe(2);
  });

  it("a valid reply without its review is a programming error", () => {
    expect(() => classifyDefectSlot({ status: "valid", review: null }, regions, files, 2)).toThrow();
  });
});

describe("clean metrics", () => {
  const slot = (status: CleanSlotObservation["status"], verdict: CleanSlotObservation["verdict"], tokens: number | null = 100): CleanSlotObservation => ({
    status,
    verdict,
    requiresChangeFindings: verdict === "request_changes" ? 2 : 0,
    outputTokens: tokens,
  });

  it("false rejection over valid replies; conservative non-approval and coverage over planned slots", () => {
    const m = cleanMetrics([slot("valid", "approve"), slot("valid", "request_changes"), slot("refusal", null, 5), slot("missing", null, null)]);
    expect(m.planned).toBe(4);
    expect(m.validReplies).toBe(2);
    expect(m.nonValid).toBe(2);
    expect(m.missing).toBe(1);
    expect(m.falseRejection).toEqual({ kind: "value", value: 0.5 });
    expect(m.conservativeNonApproval).toEqual({ kind: "value", value: 0.75 });
    expect(m.completionCoverage).toEqual({ kind: "value", value: 0.5 });
    expect(m.requiresChangeFindingsPerValidReply).toEqual({ kind: "value", value: 1 });
    expect(m.repliesWithUsage).toBe(3);
    expect(m.outputTokensPerReply).toEqual({ kind: "value", value: 205 / 3 });
  });

  it("no valid reply -> false rejection undefined (not 0)", () => {
    const m = cleanMetrics([slot("timeout", null), slot("schema_invalid", null)]);
    expect(m.falseRejection.kind).toBe("undefined");
    expect(m.conservativeNonApproval).toEqual({ kind: "value", value: 1 });
  });

  it("no planned slot -> everything undefined", () => {
    const m = cleanMetrics([]);
    expect(m.conservativeNonApproval.kind).toBe("undefined");
    expect(m.completionCoverage.kind).toBe("undefined");
  });

  it("observeCleanSlot counts requires_change findings of valid replies only", () => {
    const o = observeCleanSlot(valid({ verdict: "request_changes", findings: [at(3), at(4, "acceptable")] }), 50);
    expect(o).toEqual({ status: "valid", verdict: "request_changes", requiresChangeFindings: 1, outputTokens: 50 });
    expect(observeCleanSlot({ status: "refusal", review: null }, null)).toEqual({ status: "refusal", verdict: null, requiresChangeFindings: 0, outputTokens: null });
  });
});

describe("localization-match fraction", () => {
  it("is localized findings over findings in valid replies, and is labelled not factual precision", () => {
    const cs = [
      classifyDefectSlot(valid({ verdict: "request_changes", findings: [at(12), at(40)] }), regions, files, 2),
      classifyDefectSlot(valid({ verdict: "approve", findings: [at(13, "uncertain")] }), regions, files, 2),
      classifyDefectSlot({ status: "refusal", review: null }, regions, files, 2),
    ];
    const l = localizationMatchFraction(cs);
    expect(l.label).toContain("not factual precision");
    expect([l.findings, l.localized]).toEqual([3, 2]);
    expect(l.fraction).toEqual({ kind: "value", value: 2 / 3 });
    expect([l.requiresChangeFindings, l.requiresChangeLocalized]).toEqual([2, 1]);
  });
});
