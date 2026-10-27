// Leak scan of reviewer-visible bytes (PLAN §3.5). Pure.
//
// The forbidden words must never appear in anything a reviewer sees: specs, diffs, head files, paths, change ids.
// Matching is ASCII case-insensitive and word-bounded, where a boundary is any non-alphanumeric character (so `_`,
// `-`, `/`, `.` separate words: `group_id`, `src/seed-data.ts`), a lower->upper camelCase transition (`isClean`,
// `cleanHead`), an acronym->word transition (`XMLGroup`), or a letter<->digit transition (`seed42`). Plural `s`/`es`
// is also caught (`groups`, `witnesses`). Two derived spellings of near-miss are scanned as well (`near miss`,
// `nearmiss` which also catches `nearMiss`). Non-ASCII homoglyph evasion is out of scope (docs/LIMITATIONS, M6).
import type { ReviewerProjection } from "./projection.ts";

/** PLAN §3.5, verbatim. */
export const FORBIDDEN_WORDS = [
  "clean",
  "defect",
  "near-miss",
  "near_miss",
  "group",
  "tag",
  "seed",
  "mutant",
  "twin",
  "witness",
] as const;

/** Additional spellings scanned alongside FORBIDDEN_WORDS. */
export const DERIVED_FORMS = ["near miss", "nearmiss"] as const;

export const SCANNED_TERMS: readonly string[] = [...FORBIDDEN_WORDS, ...DERIVED_FORMS];

export interface LeakHit {
  /** Which reviewer-visible field, e.g. `spec`, `diff`, `files[0].path`, or `text` for a bare string. */
  readonly field: string;
  /** The scanned term that matched (lowercase). */
  readonly term: string;
  /** The exact matched text, including any plural suffix. */
  readonly match: string;
  /** 0-based UTF-16 offset in the field. */
  readonly index: number;
  /** 1-based line and column in the field. */
  readonly line: number;
  readonly column: number;
}

const isUpper = (ch: string | undefined): boolean => ch !== undefined && ch >= "A" && ch <= "Z";
const isLower = (ch: string | undefined): boolean => ch !== undefined && ch >= "a" && ch <= "z";
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";
const isLetter = (ch: string | undefined): boolean => isUpper(ch) || isLower(ch);
const isAlnum = (ch: string | undefined): boolean => isLetter(ch) || isDigit(ch);

/** ASCII-only lowercasing; keeps string length (and therefore offsets) unchanged. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/** Is there a word boundary between text[pos - 1] and text[pos]? */
function isBoundary(text: string, pos: number): boolean {
  if (pos <= 0 || pos >= text.length) return true;
  const prev = text[pos - 1];
  const cur = text[pos];
  if (!isAlnum(prev) || !isAlnum(cur)) return true;
  if ((isLower(prev) || isDigit(prev)) && isUpper(cur)) return true; // fooBar, v2Bar
  if (isUpper(prev) && isUpper(cur) && isLower(text[pos + 1])) return true; // XMLGroup: boundary before G
  if (isLetter(prev) && isDigit(cur)) return true; // seed42
  if (isDigit(prev) && isLetter(cur)) return true; // 2seed
  return false;
}

/** Scan one reviewer-visible string. Hits are ordered by index, then term. */
export function scanText(text: string, field = "text"): LeakHit[] {
  const lower = asciiLower(text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const hits: LeakHit[] = [];
  for (const term of SCANNED_TERMS) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at === -1) break;
      from = at + 1;
      if (!isBoundary(text, at)) continue;
      const end = at + term.length;
      let matchEnd = -1;
      if (isBoundary(text, end)) matchEnd = end;
      else if (lower.startsWith("es", end) && isBoundary(text, end + 2)) matchEnd = end + 2;
      else if (lower[end] === "s" && isBoundary(text, end + 1)) matchEnd = end + 1;
      if (matchEnd === -1) continue;
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= at) line++;
      hits.push({ field, term, match: text.slice(at, matchEnd), index: at, line: line + 1, column: at - lineStarts[line]! + 1 });
    }
  }
  hits.sort((x, y) => x.index - y.index || (x.term < y.term ? -1 : x.term > y.term ? 1 : 0));
  return hits;
}

/**
 * Scan everything a reviewer would see. Accepts a bare string (e.g. a fully rendered prompt) or a reviewer
 * projection, in which case the change id, spec, diff, every file path and every numbered head are scanned.
 * An empty result means no forbidden word was found; any hit must block the change (admission) or the request.
 */
export function scanReviewerVisible(input: string | ReviewerProjection): LeakHit[] {
  if (typeof input === "string") return scanText(input, "text");
  const hits: LeakHit[] = [...scanText(input.changeId, "changeId"), ...scanText(input.spec, "spec"), ...scanText(input.diff, "diff")];
  input.files.forEach((file, i) => {
    hits.push(...scanText(file.path, `files[${i}].path`), ...scanText(file.numberedHead, `files[${i}].numberedHead`));
  });
  return hits;
}
