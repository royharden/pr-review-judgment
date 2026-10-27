// Region derivation, policy region/v1 (PLAN §3.4, K18 [X] refinement). Pure.
//
// A defect's region is a mechanical line diff of its head against its clean counterpart's head, file by file:
// - one interval per changed run (a maximal run of non-equal diff ops); never one bounding interval;
// - a run that inserts or replaces lines -> the inserted lines' span in defective-head line numbers;
// - a pure deletion run -> a two-line anchor: the surviving line before and the surviving line after, clamped to
//   the file bounds (deletion at the top -> [1, 1]; at the bottom -> [n, n]).
// Lines are 1-based and inclusive. The diff tie-break is fixed in diff.ts, so the output is deterministic.
import { diffLines, splitLines } from "./diff.ts";
import { compareCodeUnits } from "./order.ts";

export const REGION_POLICY = "region/v1" as const;

export interface LineInterval {
  readonly startLine: number;
  readonly endLine: number;
}

export interface FileRegion extends LineInterval {
  readonly path: string;
}

/** Changed-run intervals of one file, in defective-head line numbers, ordered by position. Identical files -> []. */
export function deriveFileIntervals(cleanHead: string, defectiveHead: string): LineInterval[] {
  const a = splitLines(cleanHead);
  const b = splitLines(defectiveHead);
  const ops = diffLines(a, b);
  const nB = b.length;
  const intervals: LineInterval[] = [];
  let bConsumed = 0; // defective-head lines before the current op
  let k = 0;
  while (k < ops.length) {
    const op = ops[k]!;
    if (op.tag === "eq") {
      bConsumed++;
      k++;
      continue;
    }
    // Start of a changed run.
    const runStartB = bConsumed;
    let firstIns = -1;
    let lastIns = -1;
    while (k < ops.length && ops[k]!.tag !== "eq") {
      const runOp = ops[k]!;
      if (runOp.tag === "ins") {
        if (firstIns === -1) firstIns = runOp.bIndex;
        lastIns = runOp.bIndex;
        bConsumed++;
      }
      k++;
    }
    if (firstIns !== -1) {
      intervals.push({ startLine: firstIns + 1, endLine: lastIns + 1 });
    } else {
      // Pure deletion between defective-head lines runStartB (before, 1-based) and runStartB + 1 (after).
      if (nB === 0) throw new Error(`${REGION_POLICY}: defective head has no lines; deletion anchor undefined`);
      intervals.push({ startLine: Math.max(1, runStartB), endLine: Math.min(nB, runStartB + 1) });
    }
  }
  return intervals;
}

export interface HeadFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Regions of one variant vs its clean counterpart, across files, sorted by path then line. A path only in the
 * defective head is treated as added (clean content ""); a path only in the clean head is a deleted file, which
 * region/v1 does not support (no surviving line to anchor) and rejects.
 */
export function deriveRegions(cleanFiles: readonly HeadFile[], defectiveFiles: readonly HeadFile[]): FileRegion[] {
  const clean = new Map(cleanFiles.map((f) => [f.path, f.content]));
  const defective = new Map(defectiveFiles.map((f) => [f.path, f.content]));
  for (const path of clean.keys()) {
    if (!defective.has(path)) throw new Error(`${REGION_POLICY}: file ${path} deleted in defective head is unsupported`);
  }
  const paths = [...defective.keys()].sort(compareCodeUnits);
  const regions: FileRegion[] = [];
  for (const path of paths) {
    for (const interval of deriveFileIntervals(clean.get(path) ?? "", defective.get(path)!)) {
      regions.push({ path, ...interval });
    }
  }
  return regions;
}

/** Widen an interval by k lines on each side, clamped to [1, fileLineCount] (matcher tolerance, PLAN §6). */
export function widen(interval: LineInterval, k: number, fileLineCount: number): LineInterval {
  if (!Number.isInteger(k) || k < 0) throw new Error(`widen: k must be a non-negative integer, got ${k}`);
  if (!Number.isInteger(fileLineCount) || fileLineCount < 1) {
    throw new Error(`widen: fileLineCount must be a positive integer, got ${fileLineCount}`);
  }
  return {
    startLine: Math.max(1, interval.startLine - k),
    endLine: Math.min(fileLineCount, interval.endLine + k),
  };
}
