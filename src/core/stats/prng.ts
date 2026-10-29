// Seeded pseudo-random numbers (PLAN §6 statistics, §3.5 per-(reviewer, repeat) shuffle). Pure.
//
// Algorithm: mulberry32 (a 32-bit generator by Tommy Ettinger): state += 0x6D2B79F5, then two
// xor-shift-multiply rounds; output / 2^32 lies in [0, 1). It is the same generator as src/core/sandbox/verifyplan.ts
// (M2), so a seed means the same stream everywhere in this repo. Quality is adequate for resampling indices and
// shuffles; it is not cryptographic. `int(n)` is floor(next() * n) (bias below n / 2^32, negligible for n <= 1e4).
// Sub-seeds are derived from a base seed and labels via SHA-256 (deriveSeed) so independent streams never share
// draws by accident.
import { sha256Hex } from "../hash/sha256.ts";

export const PRNG_ALGORITHM = "mulberry32/v1" as const;

export interface Prng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
}

export function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`seed must be a uint32, got ${seed}`);
}

export function mulberry32(seed: number): Prng {
  assertSeed(seed);
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(n: number): number {
      if (!Number.isInteger(n) || n < 1) throw new Error(`int: n must be a positive integer, got ${n}`);
      return Math.floor(next() * n);
    },
  };
}

/** uint32 sub-seed: the first 8 hex of sha256("pr-review-judgment/seed/v1" NUL base NUL label ...). */
export function deriveSeed(baseSeed: number, ...labels: readonly string[]): number {
  assertSeed(baseSeed);
  const text = ["pr-review-judgment/seed/v1", String(baseSeed), ...labels].join("\u0000");
  return Number.parseInt(sha256Hex(text).slice(0, 8), 16) >>> 0;
}

/** Fisher-Yates shuffle (from the end) driven by mulberry32(seed); returns a new array. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const prng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = prng.int(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
