// Unified diff parser for the deterministic baselines. Pure. Reads the exact format written by
// src/core/defectcorpus/diff.ts unifiedDiff (`--- a/<path>` or `--- /dev/null`, `+++ b/<path>`, `@@ -s,n +s,n @@`,
// then ` `/`-`/`+` lines). Baselines see the same reviewer-visible diff a model sees and nothing else.

export interface DiffLine {
  readonly kind: " " | "-" | "+";
  readonly text: string;
  /** 1-based line in the base file (null for an added line). */
  readonly oldLine: number | null;
  /** 1-based line in the head file (null for a removed line). */
  readonly newLine: number | null;
}

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLength: number;
  readonly newStart: number;
  readonly newLength: number;
  readonly lines: readonly DiffLine[];
}

export interface DiffFile {
  readonly path: string;
  readonly hunks: readonly DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/;

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const lines = diff.length === 0 ? [] : diff.replace(/\n$/, "").split("\n");
  const files: { path: string; hunks: DiffHunk[] }[] = [];
  let i = 0;
  while (i < lines.length) {
    const minus = lines[i]!;
    const plus = lines[i + 1];
    if (!minus.startsWith("--- ") || plus === undefined || !plus.startsWith("+++ b/")) {
      throw new Error(`parseUnifiedDiff: expected a file header at line ${i + 1}`);
    }
    const file = { path: plus.slice("+++ b/".length), hunks: [] as DiffHunk[] };
    files.push(file);
    i += 2;
    while (i < lines.length && lines[i]!.startsWith("@@ ")) {
      const m = HUNK_HEADER.exec(lines[i]!);
      if (m === null) throw new Error(`parseUnifiedDiff: bad hunk header at line ${i + 1}`);
      const oldStart = Number(m[1]);
      const oldLength = Number(m[2]);
      const newStart = Number(m[3]);
      const newLength = Number(m[4]);
      i++;
      // An empty side's start is the line BEFORE the hunk (GNU convention), so numbering starts one later.
      let oldLine = oldLength === 0 ? oldStart + 1 : oldStart;
      let newLine = newLength === 0 ? newStart + 1 : newStart;
      const hunkLines: DiffLine[] = [];
      let seenOld = 0;
      let seenNew = 0;
      while (i < lines.length && (seenOld < oldLength || seenNew < newLength)) {
        const line = lines[i]!;
        const kind = line[0];
        const text = line.slice(1);
        if (kind === " ") {
          hunkLines.push({ kind, text, oldLine: oldLine++, newLine: newLine++ });
          seenOld++;
          seenNew++;
        } else if (kind === "-") {
          hunkLines.push({ kind, text, oldLine: oldLine++, newLine: null });
          seenOld++;
        } else if (kind === "+") {
          hunkLines.push({ kind, text, oldLine: null, newLine: newLine++ });
          seenNew++;
        } else {
          throw new Error(`parseUnifiedDiff: unexpected line at ${i + 1}`);
        }
        i++;
      }
      if (seenOld !== oldLength || seenNew !== newLength) throw new Error("parseUnifiedDiff: hunk shorter than its header");
      file.hunks.push({ oldStart, oldLength, newStart, newLength, lines: hunkLines });
    }
  }
  return files;
}

/** A maximal run of non-context lines inside one hunk, with the head lines around it. */
export interface ChangeRun {
  readonly path: string;
  readonly removed: readonly DiffLine[];
  readonly added: readonly DiffLine[];
  /** Context line just before the run (null at hunk start). */
  readonly before: DiffLine | null;
  /** Context line just after the run (null at hunk end). */
  readonly after: DiffLine | null;
  /**
   * Head-line interval a finding about this run points at: the added lines' span, or for a pure removal the
   * two-line anchor (head line before, head line after; region/v1 convention), clamped to >= 1.
   */
  readonly startLine: number;
  readonly endLine: number;
}

export function changeRuns(files: readonly DiffFile[]): ChangeRun[] {
  const runs: ChangeRun[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      let j = 0;
      while (j < hunk.lines.length) {
        if (hunk.lines[j]!.kind === " ") {
          j++;
          continue;
        }
        const start = j;
        while (j < hunk.lines.length && hunk.lines[j]!.kind !== " ") j++;
        const slice = hunk.lines.slice(start, j);
        const removed = slice.filter((l) => l.kind === "-");
        const added = slice.filter((l) => l.kind === "+");
        const before = start > 0 ? hunk.lines[start - 1]! : null;
        const after = j < hunk.lines.length ? hunk.lines[j]! : null;
        let startLine: number;
        let endLine: number;
        if (added.length > 0) {
          startLine = added[0]!.newLine!;
          endLine = added[added.length - 1]!.newLine!;
        } else {
          // Head line before the removal = the next head line minus one.
          const nextHead = after?.newLine ?? (before?.newLine ?? 0) + 1;
          startLine = Math.max(1, nextHead - 1);
          endLine = Math.max(startLine, after?.newLine ?? startLine);
        }
        runs.push({ path: file.path, removed, added, before, after, startLine, endLine });
      }
    }
  }
  return runs;
}
