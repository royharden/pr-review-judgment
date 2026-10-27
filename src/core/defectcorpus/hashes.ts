// Content hashing for corpus records. Pure: uses the pure-TS SHA-256 in src/core/hash/sha256.ts.
import { sha256Hex } from "../hash/sha256.ts";
import { compareCodeUnits } from "./order.ts";

export { sha256Hex };

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, arrays in order. Rejects undefined,
 * functions, symbols, bigint and non-finite numbers so two hosts can never disagree on the bytes being hashed.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort(compareCodeUnits);
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

/** sha256 of the canonical JSON of a value. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export const CHANGE_HASH_DOMAIN = "pr-review-judgment/change/v1" as const;

export interface ChangeFile {
  readonly path: string;
  /** null when the file is new in the head. */
  readonly base: string | null;
  readonly head: string;
}

/**
 * Content hash of one change as a reviewer would see it: the spec plus every touched file's base and head.
 * The neutral change id is derived from this (ids.ts), so the id depends only on content, never on labels.
 */
export function changeContentSha256(spec: string, files: readonly ChangeFile[]): string {
  const sorted = [...files].sort((x, y) => compareCodeUnits(x.path, y.path));
  return hashCanonical({
    domain: CHANGE_HASH_DOMAIN,
    spec,
    files: sorted.map((f) => ({ path: f.path, base: f.base, head: f.head })),
  });
}
