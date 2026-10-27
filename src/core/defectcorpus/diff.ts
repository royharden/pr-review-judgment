// Deterministic line diff (LCS) shared by region derivation (region.ts) and the reviewer-visible unified diff.
// Pure; no host APIs. Lines compare byte-exactly (whitespace is significant). Files here are small (<= 150
// executable lines, PLAN §5), so the O(n*m) table is fine.

export type DiffOp =
  | { readonly tag: "eq"; readonly aIndex: number; readonly bIndex: number }
  | { readonly tag: "del"; readonly aIndex: number }
  | { readonly tag: "ins"; readonly bIndex: number };

/**
 * Split file text into lines. `\n` and `\r\n` both terminate a line; a final terminator does not create an extra
 * empty line; the empty string has zero lines.
 */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Edit script from `a` to `b`. Tie-break (fixed, part of region/v1): a matching line is always taken as `eq`;
 * otherwise a deletion is preferred over an insertion when both keep an LCS, so within one changed run all
 * deletions precede all insertions.
 */
export function diffLines(a: readonly string[], b: readonly string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  // lcs[i * w + j] = LCS length of a[i..] and b[j..].
  const lcs = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i === n) {
      ops.push({ tag: "ins", bIndex: j++ });
    } else if (j === m) {
      ops.push({ tag: "del", aIndex: i++ });
    } else if (a[i] === b[j]) {
      ops.push({ tag: "eq", aIndex: i++, bIndex: j++ });
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      ops.push({ tag: "del", aIndex: i++ });
    } else {
      ops.push({ tag: "ins", bIndex: j++ });
    }
  }
  return ops;
}

export const DIFF_CONTEXT_LINES = 3;

/**
 * Unified diff of one file, `--- a/<path>` / `+++ b/<path>` (`/dev/null` for a new file). Hunk headers always print
 * `start,count`; an empty side uses the line number before the hunk, as GNU diff does. Returns "" when nothing changed,
 * otherwise text ending with "\n". Trailing-newline-only differences are not represented (line-based).
 */
export function unifiedDiff(path: string, base: string | null, head: string, context = DIFF_CONTEXT_LINES): string {
  const a = base === null ? [] : splitLines(base);
  const b = splitLines(head);
  const ops = diffLines(a, b);
  const changes: number[] = [];
  ops.forEach((op, idx) => {
    if (op.tag !== "eq") changes.push(idx);
  });
  if (changes.length === 0) return "";

  // Prefix counts: aBefore[k] / bBefore[k] = a / b lines consumed by ops[0..k).
  const aBefore = new Int32Array(ops.length + 1);
  const bBefore = new Int32Array(ops.length + 1);
  ops.forEach((op, k) => {
    aBefore[k + 1] = aBefore[k]! + (op.tag === "ins" ? 0 : 1);
    bBefore[k + 1] = bBefore[k]! + (op.tag === "del" ? 0 : 1);
  });

  const out: string[] = [base === null ? "--- /dev/null" : `--- a/${path}`, `+++ b/${path}`];
  let c = 0;
  while (c < changes.length) {
    const first = changes[c]!;
    let last = first;
    let k = c + 1;
    // Changes separated by at most 2*context equal lines share a hunk.
    while (k < changes.length && changes[k]! - last - 1 <= 2 * context) {
      last = changes[k]!;
      k++;
    }
    const start = Math.max(0, first - context);
    const end = Math.min(ops.length, last + 1 + context);
    const aLen = aBefore[end]! - aBefore[start]!;
    const bLen = bBefore[end]! - bBefore[start]!;
    const aStart = aLen === 0 ? aBefore[start]! : aBefore[start]! + 1;
    const bStart = bLen === 0 ? bBefore[start]! : bBefore[start]! + 1;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (let x = start; x < end; x++) {
      const op = ops[x]!;
      if (op.tag === "eq") out.push(` ${a[op.aIndex]!}`);
      else if (op.tag === "del") out.push(`-${a[op.aIndex]!}`);
      else out.push(`+${b[op.bIndex]!}`);
    }
    c = k;
  }
  return out.join("\n") + "\n";
}
