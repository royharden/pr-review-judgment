// flag-every-hunk baseline (PLAN §6): one requires_change finding per <= 20-line window of every diff hunk's
// head-side range (context lines included, as the hunk is shown), verdict request_changes. It is the shotgun
// reference: the 20-line span cap and the 10-finding cap are the same as for model reviewers. A hunk with an
// empty head side (pure deletion at end of file) is flagged at its anchor line. Pure.
import { SPAN_CAP_LINES } from "../matcher.ts";
import type { HeadFileBounds, ReviewFinding } from "../contract.ts";
import { finishBaseline, type BaselineResult } from "./common.ts";
import { parseUnifiedDiff } from "./diffparse.ts";

export function hunkWindows(start: number, length: number, windowLines = SPAN_CAP_LINES): { startLine: number; endLine: number }[] {
  if (length === 0) {
    const anchor = Math.max(1, start);
    return [{ startLine: anchor, endLine: anchor }];
  }
  const out: { startLine: number; endLine: number }[] = [];
  for (let s = start; s < start + length; s += windowLines) out.push({ startLine: s, endLine: Math.min(start + length - 1, s + windowLines - 1) });
  return out;
}

export function flagEveryHunk(diff: string, headFiles: readonly HeadFileBounds[]): BaselineResult {
  const findings: ReviewFinding[] = [];
  for (const file of parseUnifiedDiff(diff)) {
    for (const hunk of file.hunks) {
      for (const w of hunkWindows(hunk.newStart, hunk.newLength)) {
        findings.push({
          path: file.path,
          startLine: w.startLine,
          endLine: w.endLine,
          severity: "medium",
          claim: `flag-every-hunk: changed lines ${w.startLine}-${w.endLine}`,
          confidence: 0.5,
          disposition: "requires_change",
        });
      }
    }
  }
  return finishBaseline("flag-every-hunk", findings, headFiles);
}
