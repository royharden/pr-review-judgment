// Percentile quantiles for bootstrap intervals. Pure.
// Definition: Hyndman-Fan type 7 (linear interpolation between order statistics; the R default):
//   h = (n - 1) p; q = x[floor(h)] + (h - floor(h)) * (x[floor(h) + 1] - x[floor(h)]), x sorted ascending, 0-based.
// Design-informed by S36 `9e281d0` src/core/judgestats (type-7 quantiles); implemented here (PLAN K13).

export const QUANTILE_METHOD = "type-7" as const;

export function quantileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error("quantileSorted: empty sample");
  if (!(p >= 0 && p <= 1)) throw new Error(`quantileSorted: p must be in [0, 1], got ${p}`);
  for (let i = 1; i < sorted.length; i++) {
    if (!(sorted[i - 1]! <= sorted[i]!)) throw new Error("quantileSorted: sample is not sorted ascending");
  }
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const x = sorted[lo]!;
  return x + (h - lo) * (sorted[hi]! - x);
}

export function quantile(values: readonly number[], p: number): number {
  return quantileSorted([...values].sort((a, b) => a - b), p);
}
