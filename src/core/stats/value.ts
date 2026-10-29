// A number that may be undefined for a stated reason (PLAN §6: "Undefined denominators render `undefined` with
// reason"). Pure. Every statistic in src/core/stats and src/core/reviewjudge returns this instead of NaN.

export type Value =
  | { readonly kind: "value"; readonly value: number }
  | { readonly kind: "undefined"; readonly reason: string };

export function value(v: number): Value {
  if (!Number.isFinite(v)) throw new Error(`value: non-finite number ${v}`);
  return { kind: "value", value: v };
}

export function undefinedValue(reason: string): Value {
  if (reason.length === 0) throw new Error("undefinedValue: a reason is required");
  return { kind: "undefined", reason };
}

export function isDefined(v: Value): v is { readonly kind: "value"; readonly value: number } {
  return v.kind === "value";
}

/** num / den; a zero denominator is undefined (never 0, never NaN). */
export function ratio(num: number, den: number, reason = "zero denominator"): Value {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den < 0) throw new Error(`ratio: invalid ${num}/${den}`);
  return den === 0 ? undefinedValue(reason) : value(num / den);
}

/** Arithmetic mean; an empty list is undefined. */
export function mean(values: readonly number[], reason = "no observations"): Value {
  if (values.length === 0) return undefinedValue(reason);
  let sum = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) throw new Error(`mean: non-finite input ${v}`);
    sum += v;
  }
  return value(sum / values.length);
}

/** a - b; undefined if either side is. */
export function subtract(a: Value, b: Value): Value {
  if (a.kind === "undefined") return a;
  if (b.kind === "undefined") return b;
  return value(a.value - b.value);
}

export function negate(a: Value): Value {
  return a.kind === "undefined" ? a : value(-a.value);
}

/** Render for reports: fixed decimals, or `undefined (reason)`. */
export function formatValue(v: Value, decimals = 4): string {
  return v.kind === "value" ? v.value.toFixed(decimals) : `undefined (${v.reason})`;
}
