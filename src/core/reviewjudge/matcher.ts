// Localization matcher (PLAN §3.4, §6, K3, M3 acceptance 3). Pure.
//
// A finding is LOCALIZED to a seeded change when all of:
// - its path is a safe normalized POSIX path that equals a head-file path exactly (no case folding, no `./`);
// - its lines lie inside that file (1..lineCount, startLine <= endLine);
// - its span (endLine - startLine + 1) is at most 20 lines (a wider finding never matches: no shotgun credit);
// - it overlaps at least one region interval of that path widened by k lines on each side (clamped to the file).
// k is one of {0, 2, 5}; k = 2 is primary (K3), 0 and 5 are always reported beside it. Regions are the region/v1
// per-run intervals from src/core/defectcorpus/region.ts (deletion -> two-line anchor). A finding that fails a check
// is recorded in the trace with the first failing reason; nothing invalid can match.
import { widen, type FileRegion } from "../defectcorpus/region.ts";
import { isSafeRelPath } from "../defectcorpus/schema.ts";
import type { FindingDisposition, HeadFileBounds, ReviewFinding } from "./contract.ts";

export const K_VALUES = [0, 2, 5] as const;
export type K = (typeof K_VALUES)[number];
export const K_PRIMARY: K = 2;
export const SPAN_CAP_LINES = 20;
export const MATCHER_POLICY = "matcher/v1 (exact path, span<=20, region/v1 widened by k)" as const;

export type NoMatchReason = "unknown_path" | "line_out_of_bounds" | "span_over_cap" | "no_overlap";

export interface FindingTrace {
  readonly index: number;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly disposition: FindingDisposition;
  readonly spanLines: number;
  readonly localized: boolean;
  /** Indices into the region list that the finding overlaps (after widening). */
  readonly matchedRegions: readonly number[];
  readonly reason: NoMatchReason | null;
}

export interface MatchTrace {
  readonly policy: typeof MATCHER_POLICY;
  readonly k: K;
  readonly findings: readonly FindingTrace[];
  /** >= 1 localized finding (any disposition). */
  readonly anyLocalized: boolean;
  /** >= 1 localized finding with disposition requires_change. */
  readonly anyActionableLocalized: boolean;
  readonly localizedCount: number;
  readonly actionableLocalizedCount: number;
}

export function assertK(k: number): asserts k is K {
  if (!(K_VALUES as readonly number[]).includes(k)) throw new Error(`matcher: k must be one of ${K_VALUES.join(", ")}, got ${k}`);
}

function validateRegions(regions: readonly FileRegion[], bounds: ReadonlyMap<string, number>): void {
  regions.forEach((r, i) => {
    const lineCount = bounds.get(r.path);
    if (lineCount === undefined) throw new Error(`matcher: region ${i} path ${r.path} is not a head file`);
    if (!(r.startLine >= 1 && r.endLine >= r.startLine && r.endLine <= lineCount)) {
      throw new Error(`matcher: region ${i} ${r.path}:${r.startLine}-${r.endLine} outside 1-${lineCount}`);
    }
  });
}

export function matchFindings(
  findings: readonly ReviewFinding[],
  regions: readonly FileRegion[],
  headFiles: readonly HeadFileBounds[],
  k: number,
): MatchTrace {
  assertK(k);
  const bounds = new Map(headFiles.map((f) => [f.path, f.lineCount]));
  validateRegions(regions, bounds);
  const traces: FindingTrace[] = findings.map((f, index) => {
    const spanLines = f.endLine - f.startLine + 1;
    const base = { index, path: f.path, startLine: f.startLine, endLine: f.endLine, disposition: f.disposition, spanLines };
    const lineCount = isSafeRelPath(f.path) ? bounds.get(f.path) : undefined;
    if (lineCount === undefined) return { ...base, localized: false, matchedRegions: [], reason: "unknown_path" as const };
    const inBounds =
      Number.isInteger(f.startLine) && Number.isInteger(f.endLine) && f.startLine >= 1 && f.endLine >= f.startLine && f.endLine <= lineCount;
    if (!inBounds) return { ...base, localized: false, matchedRegions: [], reason: "line_out_of_bounds" as const };
    if (spanLines > SPAN_CAP_LINES) return { ...base, localized: false, matchedRegions: [], reason: "span_over_cap" as const };
    const matched: number[] = [];
    regions.forEach((r, i) => {
      if (r.path !== f.path) return;
      const w = widen(r, k, lineCount);
      if (f.startLine <= w.endLine && f.endLine >= w.startLine) matched.push(i);
    });
    return matched.length > 0
      ? { ...base, localized: true, matchedRegions: matched, reason: null }
      : { ...base, localized: false, matchedRegions: [], reason: "no_overlap" as const };
  });
  const localized = traces.filter((t) => t.localized);
  const actionable = localized.filter((t) => t.disposition === "requires_change");
  return {
    policy: MATCHER_POLICY,
    k,
    findings: traces,
    anyLocalized: localized.length > 0,
    anyActionableLocalized: actionable.length > 0,
    localizedCount: localized.length,
    actionableLocalizedCount: actionable.length,
  };
}

/** The matcher at every reported k. */
export function matchAllK(
  findings: readonly ReviewFinding[],
  regions: readonly FileRegion[],
  headFiles: readonly HeadFileBounds[],
): Readonly<Record<`k${K}`, MatchTrace>> {
  return {
    k0: matchFindings(findings, regions, headFiles, 0),
    k2: matchFindings(findings, regions, headFiles, 2),
    k5: matchFindings(findings, regions, headFiles, 5),
  };
}
