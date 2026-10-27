// Neutral change ids shown to reviewers (PLAN §3.5): `c_` + the first 10 hex of the change content hash.
// The id carries no kind, task-internal order or label information.

const SHA256_HEX = /^[0-9a-f]{64}$/;

export const NEUTRAL_ID_HEX_LENGTH = 10;

export function neutralChangeId(contentHash: string): string {
  if (!SHA256_HEX.test(contentHash)) throw new Error("neutralChangeId: expected a 64-char lowercase hex sha256");
  return `c_${contentHash.slice(0, NEUTRAL_ID_HEX_LENGTH)}`;
}

/**
 * Throws if two distinct content hashes share a neutral id (a 40-bit prefix collision), so a corpus can never
 * silently merge two changes under one reviewer-visible id. Identical hashes are the same change and allowed.
 */
export function assertUniqueNeutralIds(contentHashes: readonly string[]): void {
  const byId = new Map<string, string>();
  for (const hash of contentHashes) {
    const id = neutralChangeId(hash);
    const prior = byId.get(id);
    if (prior !== undefined && prior !== hash) throw new Error(`neutral id collision on ${id}`);
    byId.set(id, hash);
  }
}
