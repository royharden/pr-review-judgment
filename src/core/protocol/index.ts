import { z } from "zod";
import { AdmissionRecordSchema, RelPath, Sha256Hex } from "../defectcorpus/schema.ts";
import { hashCanonical } from "../defectcorpus/hashes.ts";
import { sha256Hex } from "../hash/sha256.ts";
import { LockedReviewerSchema } from "../providers/port.ts";

export const RunLockSchema = z.strictObject({ schema: z.literal("run-lock/v1"), model_lock: z.unknown(), inputs: z.record(RelPath, Sha256Hex), corpus_sha256: Sha256Hex, config_sha256: Sha256Hex, presentation_seed: z.number().int().min(0).max(0xffffffff), sandbox_qualified: z.literal(true), sandbox_image: z.string().regex(/@sha256:[0-9a-f]{64}$/), probe_path: RelPath, stage_grant_path: RelPath, dirty_mode: z.literal(false), stage: z.enum(["A", "B"]), stage_grant_sha256: Sha256Hex, b_generation_sha256: Sha256Hex.optional(), b_generation_corpus_path: RelPath.optional(), b_generation_corpus_sha256: Sha256Hex.optional() });
export type RunLock = z.infer<typeof RunLockSchema>;
export function rejectNull(value: unknown, at = "lock"): void {
  if (value === null || value === undefined) throw new Error(`${at} is unset`);
  if (Array.isArray(value)) value.forEach((v, i) => rejectNull(v, `${at}[${i}]`));
  else if (typeof value === "object") for (const [k, v] of Object.entries(value)) rejectNull(v, `${at}.${k}`);
}
export function validateLock(raw: unknown, bytes: Readonly<Record<string, string | Uint8Array>>): RunLock {
  rejectNull(raw);
  const lock = RunLockSchema.parse(raw);
  if (Object.keys(lock.inputs).length === 0) throw new Error("empty locked inputs");
  const model = z.object({ status: z.literal("locked"), requires: z.array(z.string()).length(0), reviewers: z.object({ A: LockedReviewerSchema, B: LockedReviewerSchema }) }).parse(lock.model_lock);
  if (model.reviewers.A.model_id === model.reviewers.B.model_id) throw new Error("reviewer pair must be distinct");
  for (const [p, hash] of Object.entries(lock.inputs)) if (bytes[p] === undefined || sha256Hex(bytes[p]) !== hash) throw new Error(`locked input drift: ${p}`);
  return lock;
}
export const lockHash = (lock: RunLock): string => hashCanonical(lock);
export interface Look { run_id: string; lock_sha256: string; corpus_sha256: string; config_sha256: string; purpose?: "author" | "review"; stage?: "A" | "B"; action: "authorize"; at: string }
export function authorizeLook(looks: readonly Look[], next: Look): Look[] {
  if (looks.some((l) => l.action === "authorize" && (l.lock_sha256 === next.lock_sha256 || (l.corpus_sha256 === next.corpus_sha256 && l.config_sha256 === next.config_sha256 && (!l.purpose || !next.purpose || l.purpose === next.purpose) && (!l.stage || !next.stage || l.stage === next.stage))))) throw new Error("corpus/config/stage look already authorized; a new run id cannot reset it");
  return [...looks, next];
}
export function requireAdmission(raw: unknown): void { const a = AdmissionRecordSchema.parse(raw); if (a.status !== "GO" || a.requires.length) throw new Error("admission is not usable GO"); }
export function qualifyDev(hit: number, nonValid: number, planned: number): boolean {
  return Number.isFinite(hit) && hit > 0.1 && hit < 0.9 && Number.isInteger(planned) && planned > 0 && nonValid >= 0 && nonValid <= planned && nonValid / planned <= 0.15;
}
