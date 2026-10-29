import { z } from "zod";
import { TaskSchema, VariantSchema, CleanVariant } from "../defectcorpus/schema.ts";
import { deriveFileIntervals } from "../defectcorpus/region.ts";
import { reviewerInput } from "../reviewjudge/projection.ts";
import { buildReviewPrompt } from "../reviewjudge/contract.ts";
import { resolveReviewResult } from "../reviewjudge/response.ts";
import { classifyDefectSlot, observeCleanSlot } from "../reviewjudge/classify.ts";
import type { AggregateInput, CleanSlotRecord, DefectSlotRecord } from "../reviewjudge/aggregate.ts";
import { LockedReviewerSchema, type ReviewEnvelope, type ReviewRequest } from "../providers/port.ts";
import { ProviderFixtureSchema, createMockProvider } from "../providers/mock.ts";
import { AUTHOR_SYSTEM, authorPrompt } from "../protocol/b.ts";
import { EnvelopeSchema } from "./evidence.ts";
import { adapterFor } from "../providers/mock.ts";
import { sha256Hex } from "../hash/sha256.ts";

export const PlannedSlotSchema = z.strictObject({ id: z.string().regex(/^[a-zA-Z0-9_.-]+$/), purpose: z.enum(["review", "author"]).default("review"), fresh_attempt: z.number().int().min(1).max(2).optional(), task: TaskSchema, variant: VariantSchema, clean_variant: CleanVariant, stratum: z.enum(["A", "B"]), arm: z.enum(["A", "B"]), author: z.enum(["A", "B"]).nullable(), defect_ordinal: z.number().int().min(1), repeat: z.number().int().min(1).max(3), lock: LockedReviewerSchema });
export type PlannedSlot = z.infer<typeof PlannedSlotSchema>;
export const RunPlanSchema = z.strictObject({ schema: z.literal("run-plan/v1"), run_id: z.string().regex(/^[a-zA-Z0-9_.-]+$/), slots: z.array(PlannedSlotSchema).min(1) });
export const ReplayBundleSchema = z.strictObject({ schema: z.literal("replay-bundle/v1"), run_id: z.string().min(1), generated_at: z.iso.datetime(), slots: z.array(PlannedSlotSchema.extend({ fixture: ProviderFixtureSchema })).min(1) });
export function requestFor(slot: PlannedSlot): ReviewRequest {
  if (slot.variant.task_id !== slot.task.task_id || slot.clean_variant.task_id !== slot.task.task_id) throw new Error("slot/task identity mismatch");
  if ((slot.stratum === "A") !== (slot.author === null)) throw new Error("slot author/stratum mismatch");
  const prompt = slot.purpose === "author" ? { system: AUTHOR_SYSTEM, user: authorPrompt(slot.task) } : buildReviewPrompt(reviewerInput(slot.variant, slot.task).projection);
  // UTF-8 byte count is a conservative token upper bound for the provider tokenizers; never an estimate used to increase caps.
  const utf8Bytes = [...(prompt.system + prompt.user)].reduce((n, c) => n + (c.codePointAt(0)! <= 0x7f ? 1 : c.codePointAt(0)! <= 0x7ff ? 2 : c.codePointAt(0)! <= 0xffff ? 3 : 4), 0);
  if (utf8Bytes > (slot.purpose === "author" ? 8000 : 12000)) throw new Error("input exceeds conservative token ceiling");
  if (slot.lock.output_cap_tokens > (slot.purpose === "author" ? 16000 : 8000)) throw new Error("output cap exceeds reservation");
  if (slot.purpose === "author" && (slot.stratum !== "B" || slot.author !== slot.arm)) throw new Error("author call must be its own B author cell");
  return { slotId: slot.id, systemPrompt: prompt.system, userPrompt: prompt.user, lock: slot.lock };
}
export function scoreRecordings(runId: string, records: readonly { slot: PlannedSlot; envelope: ReviewEnvelope | null }[]): AggregateInput {
  const defectSlots: DefectSlotRecord[] = [];
  const cleanSlots: CleanSlotRecord[] = [];
  const ids = new Set<string>();
  for (const { slot, envelope } of records) {
    if (slot.purpose === "author") throw new Error("author generation is not a review observation");
    if (ids.has(slot.id)) throw new Error("duplicate planned slot"); ids.add(slot.id);
    requestFor(slot);
    const { bounds } = reviewerInput(slot.variant, slot.task);
    if (envelope !== null) { EnvelopeSchema.parse(envelope); if (envelope.slotId !== slot.id || envelope.requestedModel !== slot.lock.model_id || envelope.provider !== slot.lock.provider || envelope.api !== slot.lock.api || envelope.requestSha256 !== sha256Hex(adapterFor(slot.lock.provider).buildRequest(requestFor(slot)).body)) throw new Error("recording identity/request mismatch"); }
    const reply = envelope === null ? { status: "unknown" as const, review: null } : resolveReviewResult(envelope, bounds);
    const common = { runId, slotId: slot.id, mock: envelope?.mock ?? false, stratum: slot.stratum, arm: slot.arm, taskId: slot.task.task_id, author: slot.author, changeId: reviewerInput(slot.variant, slot.task).projection.changeId, repeat: slot.repeat };
    const outputTokens = envelope?.usage?.outputTokens ?? null;
    if (slot.variant.kind !== "defect") cleanSlots.push({ ...common, variantKind: slot.variant.kind, ...observeCleanSlot(reply, outputTokens), status: envelope === null ? "missing" : reply.status });
    else {
      const clean = new Map(slot.clean_variant.head_files.map((f) => [f.path, f.content]));
      const regions = slot.variant.head_files.flatMap((f) => deriveFileIntervals(clean.get(f.path) ?? "", f.content).map((r) => ({ path: f.path, ...r })));
      const k0 = classifyDefectSlot(reply, regions, bounds, 0), k2 = classifyDefectSlot(reply, regions, bounds, 2), k5 = classifyDefectSlot(reply, regions, bounds, 5);
      defectSlots.push({ ...common, defectOrdinal: slot.defect_ordinal, outcomes: { k0: k0.outcome, k2: k2.outcome, k5: k5.outcome }, findingCount: reply.review?.findings.length ?? 0, localizedFindingCount: k2.trace?.findings.filter((f) => f.localized).length ?? 0, requiresChangeFindings: reply.review?.findings.filter((f) => f.disposition === "requires_change").length ?? 0, outputTokens });
    }
  }
  return { defectSlots, cleanSlots };
}
export async function replayBundle(raw: unknown): Promise<{ input: AggregateInput; generatedAt: string }> {
  const bundle = ReplayBundleSchema.parse(raw);
  const records = [];
  for (const slot of bundle.slots) {
    const provider = createMockProvider(slot.lock.provider, () => slot.fixture);
    records.push({ slot, envelope: await provider.complete(requestFor(slot)) });
  }
  return { input: scoreRecordings(bundle.run_id, records), generatedAt: bundle.generated_at };
}
