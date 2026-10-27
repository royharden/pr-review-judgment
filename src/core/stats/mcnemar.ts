// Exact two-sided McNemar test (PLAN §6: exploratory, within each author group, on repeat 1 of the first-seeded
// defect per task, one observation per task, never pooled over repeats). Pure.
// Design-informed by S40 `307835b` src/core/regressdiff/stats/mcnemar.ts; implemented here (PLAN K13).
//
// p = min(1, 2 * P[X <= min(b, c)]), X ~ Binomial(b + c, 1/2), where b and c are the discordant counts.
// Known answers (tests): (1, 5) = 14/64; (3, 10) = 756/8192 ~ 0.0923; (0, 0) = 1.

import { undefinedValue, value, type Value } from "./value.ts";

export const MCNEMAR_LABEL = "exact two-sided McNemar (exploratory; no p-value gate)" as const;

export function exactMcNemar(b: number, c: number): number {
  if (!Number.isSafeInteger(b) || !Number.isSafeInteger(c) || b < 0 || c < 0) {
    throw new Error(`exactMcNemar: discordant counts must be non-negative integers, got (${b}, ${c})`);
  }
  const n = b + c;
  if (n === 0) return 1;
  if (n > 1000) throw new Error("exactMcNemar: n > 1000 is outside this study's range (one observation per task)");
  // Lower tail via C(n, i) = C(n, i - 1) * (n - i + 1) / i, starting from 2^-n.
  let mass = 2 ** -n;
  let tail = mass;
  for (let i = 1; i <= Math.min(b, c); i++) {
    mass *= (n - i + 1) / i;
    tail += mass;
  }
  return Math.min(1, 2 * tail);
}

export interface PairedBinary {
  /** Unit id (task id): one observation per unit. */
  readonly unit: string;
  readonly first: boolean;
  readonly second: boolean;
}

export interface McNemarResult {
  readonly label: typeof MCNEMAR_LABEL;
  readonly n: number;
  /** first true, second false */
  readonly b: number;
  /** first false, second true */
  readonly c: number;
  readonly p: Value;
}

/** Discordant counts from one paired observation per unit; a repeated unit is refused (never pooled). */
export function mcnemarFromPairs(pairs: readonly PairedBinary[]): McNemarResult {
  const seen = new Set<string>();
  let b = 0;
  let c = 0;
  for (const pair of pairs) {
    if (seen.has(pair.unit)) throw new Error(`mcnemarFromPairs: unit ${pair.unit} appears twice; one observation per unit`);
    seen.add(pair.unit);
    if (pair.first && !pair.second) b++;
    else if (!pair.first && pair.second) c++;
  }
  return { label: MCNEMAR_LABEL, n: pairs.length, b, c, p: pairs.length === 0 ? undefinedValue("no paired task") : value(exactMcNemar(b, c)) };
}
