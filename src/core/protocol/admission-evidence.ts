import { z } from "zod";
import { TaskSchema, VariantSchema, WitnessReceiptSchema, RelPath, Sha256Hex, type Task, type Variant } from "../defectcorpus/schema.ts";
import { reviewerInput } from "../reviewjudge/projection.ts";
import { buildReviewPrompt } from "../reviewjudge/contract.ts";
import { sha256Hex } from "../hash/sha256.ts";

const G7ReferenceSchema = z.strictObject({ path: RelPath, sha256: Sha256Hex });
/** G7 retains the validator leakage/repository-custody audit alongside the machine verification summary. */
export const G7VerificationEvidenceSchema = z.strictObject({
  schema: z.literal("g7-verification-evidence/v1"),
  verification_summary: G7ReferenceSchema,
  leakage_custody: G7ReferenceSchema,
}).refine((e) => e.verification_summary.path !== e.leakage_custody.path, {message: "G7 companions must be distinct"});

const InputCeilingRecordSchema = z.strictObject({
  task_id: z.string().regex(/^H[0-9]{2}$/),
  change_id: z.string().regex(/^c_[0-9a-f]{10}$/),
  prompt_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  utf8_bytes: z.number().int().positive().max(12000),
});
export const InputCeilingEvidenceSchema = z.strictObject({
  policy: z.literal("review-input-ceiling/v1"),
  ceiling: z.literal(12000),
  variants: z.array(InputCeilingRecordSchema).min(1),
});

/** Same rendered system/user prompt and conservative UTF-8 byte ceiling as requestFor; no model calls. */
export function reviewInputCeiling(task: Task, variant: Variant) {
  TaskSchema.parse(task); VariantSchema.parse(variant);
  const projection = reviewerInput(variant, task).projection;
  const prompt = buildReviewPrompt(projection);
  const text = prompt.system + prompt.user;
  const utf8Bytes = [...text].reduce((n, c) => n + (c.codePointAt(0)! <= 0x7f ? 1 : c.codePointAt(0)! <= 0x7ff ? 2 : c.codePointAt(0)! <= 0xffff ? 3 : 4), 0);
  if (utf8Bytes > 12000) throw new Error("input exceeds conservative token ceiling");
  return { task_id: task.task_id, change_id: projection.changeId, prompt_sha256: sha256Hex(text), utf8_bytes: utf8Bytes };
}

// Frozen PLAN K21 / adopted Claude §7.5. Appointments and commitments are additional evidence, never replacements.
export const GATE_MEANINGS = { G1: "rights", G2: "independence", G3: "witnesses", G4: "twins", G5: "quotas", G6: "validation", G7: "leakage", G8: "difficulty_dev_only", G9: "custody_blindness" } as const;
export function verifySummary(raw: unknown, grantSha: string | null, receiptShas: readonly (string | null)[], receiptTexts: readonly (string | undefined)[] = []): void {
  if (raw === null || typeof raw !== "object") throw new Error("invalid verification summary");
  const s = raw as Record<string, unknown>;
  const grant = s.roy_grant as { sha256?: unknown } | null;
  if (s.schema !== "corpus-verify-summary/v1" || s.split !== "heldout" || !grantSha || grant?.sha256 !== grantSha || receiptShas.length !== 2 || receiptShas.some((h) => h === null || h !== s.receipts_sha256)) throw new Error("verification summary grant/receipts binding mismatch");
  verifyInputCeiling(s.input_ceiling, receiptTexts);
  if (!Array.isArray(s.tasks) || s.tasks.length !== 10 || new Set(s.tasks.map((t: { task_id?: unknown }) => t.task_id)).size !== 10 || s.tasks.some((t: { task_id?: unknown; verified?: unknown }) => typeof t.task_id !== "string" || !/^H[0-9]{2}$/.test(t.task_id) || t.verified !== true)) throw new Error("verification summary must verify all ten held-out tasks");
  const evidenceTasks = new Set(InputCeilingEvidenceSchema.parse(s.input_ceiling).variants.map((v) => v.task_id));
  if (evidenceTasks.size !== s.tasks.length || s.tasks.some((t: { task_id: string }) => !evidenceTasks.has(t.task_id))) throw new Error("verification summary task/input coverage mismatch");
}

/** Admission binds this evidence to the validator summary via G7, and to every receipted change via exact coverage. */
export function verifyInputCeiling(raw: unknown, receiptTexts: readonly (string | undefined)[]): void {
  const evidence = InputCeilingEvidenceSchema.parse(raw);
  const actual = evidence.variants.map((v) => `${v.task_id}/${v.change_id}`);
  if (new Set(actual).size !== actual.length) throw new Error("duplicate input ceiling variant");
  const expected = new Set<string>();
  if (receiptTexts.length !== 2 || receiptTexts.some((text) => text === undefined)) throw new Error("input ceiling requires both receipt gates");
  for (const text of receiptTexts) for (const line of text!.split(/\r?\n/).filter((l) => l.trim() !== "")) {
    const receipt = WitnessReceiptSchema.parse(JSON.parse(line));
    expected.add(`${receipt.task_id}/${receipt.change_id}`);
  }
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) throw new Error("input ceiling receipt coverage mismatch");
}
