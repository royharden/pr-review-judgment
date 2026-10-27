// Frozen PLAN K21 / adopted Claude §7.5. Appointments and commitments are additional evidence, never replacements.
export const GATE_MEANINGS = { G1: "rights", G2: "independence", G3: "witnesses", G4: "twins", G5: "quotas", G6: "validation", G7: "leakage", G8: "difficulty_dev_only", G9: "custody_blindness" } as const;
export function verifySummary(raw: unknown, grantSha: string | null, receiptShas: readonly (string | null)[]): void {
  if (raw === null || typeof raw !== "object") throw new Error("invalid verification summary");
  const s = raw as Record<string, unknown>;
  const grant = s.roy_grant as { sha256?: unknown } | null;
  if (s.schema !== "corpus-verify-summary/v1" || s.split !== "heldout" || !grantSha || grant?.sha256 !== grantSha || receiptShas.some((h) => h === null || h !== s.receipts_sha256)) throw new Error("verification summary grant/receipts binding mismatch");
  if (!Array.isArray(s.tasks) || s.tasks.length !== 10 || new Set(s.tasks.map((t: { task_id?: unknown }) => t.task_id)).size !== 10 || s.tasks.some((t: { task_id?: unknown; verified?: unknown }) => typeof t.task_id !== "string" || !/^H[0-9]{2}$/.test(t.task_id) || t.verified !== true)) throw new Error("verification summary must verify all ten held-out tasks");
}
