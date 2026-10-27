// Wilson score interval (PLAN §6: labelled "descriptive; ignores clustering"). Pure.
// Design-informed by S40 `307835b` src/core/regressdiff/stats/wilson.ts; implemented here (PLAN K13, not vendored).
// Known answer (tests): Wilson(5, 10) at 95 % = [0.2366, 0.7634].

/** Two-sided 95 % normal quantile, Phi^-1(0.975). */
export const WILSON_Z_95 = 1.959963984540054;

export const WILSON_LABEL = "Wilson 95% (descriptive; ignores clustering)" as const;

export type WilsonInterval =
  | {
      readonly kind: "value";
      readonly label: typeof WILSON_LABEL;
      readonly successes: number;
      readonly n: number;
      readonly estimate: number;
      readonly lower: number;
      readonly upper: number;
    }
  | {
      readonly kind: "undefined";
      readonly label: typeof WILSON_LABEL;
      readonly successes: number;
      readonly n: number;
      readonly reason: string;
    };

export function wilson(successes: number, n: number, z = WILSON_Z_95): WilsonInterval {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(n) || successes < 0 || n < 0 || successes > n) {
    throw new Error(`wilson: invalid counts ${successes}/${n}`);
  }
  if (!(z > 0) || !Number.isFinite(z)) throw new Error(`wilson: invalid z ${z}`);
  if (n === 0) return { kind: "undefined", label: WILSON_LABEL, successes, n, reason: "zero denominator" };
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return {
    kind: "value",
    label: WILSON_LABEL,
    successes,
    n,
    estimate: p,
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
  };
}
