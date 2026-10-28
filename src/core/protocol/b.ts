import { z } from "zod";
import { CleanVariant, SourceFile, TaskSchema, WitnessReceiptSchema, Sha256Hex, RelPath, TaskId, PublicManifestRecordSchema } from "../defectcorpus/schema.ts";
import { hashCanonical } from "../defectcorpus/hashes.ts";
import { enumerateMutations, applyMutation } from "../operators/enumerate.ts";
import type { OperatorName, TsApi } from "../operators/types.ts";
import { deriveFileIntervals } from "../defectcorpus/region.ts";
import { filesSha256 } from "../sandbox/runner.ts";
import { EnvelopeSchema, GenerationHistorySchema, type GenerationHistory } from "../runstate/evidence.ts";
import { LockedReviewerSchema } from "../providers/port.ts";
import { sha256Hex } from "../hash/sha256.ts";
import type { RunLock } from "./index.ts";
import type { PlannedSlot } from "../runstate/recordings.ts";

export const AUTHOR_SYSTEM = "Implement the task specification. Return only JSON {files:[{path,content}]}. Do not include tests or commentary.";
export class AuthorQualificationFailed extends Error {}
export const AuthorOutputSchema = z.strictObject({ files: z.array(SourceFile).min(1).max(2) });
export const AuthorAttemptSchema = z.strictObject({ attempt: z.number().int().min(1).max(2), slot_id: z.string(), envelope: EnvelopeSchema, source_sha256: Sha256Hex, receipts: z.array(WitnessReceiptSchema).min(1), compile: z.enum(["pass", "fail", "not_run"]) });
export const AuthorBundleSchema = z.strictObject({ schema: z.literal("author-b-recordings/v2"), task: TaskSchema, author: z.enum(["A", "B"]), model: LockedReviewerSchema, lock_sha256: Sha256Hex, generation_sha256: Sha256Hex, attempts: z.array(AuthorAttemptSchema).min(1).max(2) });
/** Written and locked BEFORE generation. These are admitted inputs, never generated B heads/neutral IDs. */
export const BGenerationCorpusSchema = z.strictObject({ schema: z.literal("b-generation-corpus/v1"), admission_sha256: Sha256Hex, admitted_manifest_path: RelPath, admitted_manifest_sha256: Sha256Hex, config_sha256: Sha256Hex, authors: z.strictObject({ A: LockedReviewerSchema, B: LockedReviewerSchema }), system_sha256: Sha256Hex, tasks: z.array(z.strictObject({ task_id: TaskId, task_path: RelPath, task_sha256: Sha256Hex, suite_sha256: Sha256Hex, prompt_sha256: Sha256Hex })).min(1) });
export type BGenerationCorpus = z.infer<typeof BGenerationCorpusSchema>;
/** The final review manifest is independently bound by lock.corpus_sha256 and may only be derived later. */
export function bGenerationHash(lock: { b_generation_corpus_sha256?: string; config_sha256: string; model_lock: unknown }): string {
  const authors = z.object({ authors: z.object({ A: LockedReviewerSchema, B: LockedReviewerSchema }) }).parse(lock.model_lock).authors;
  return hashCanonical({ schema: "b-generation-lock/v2", generation_corpus_sha256: Sha256Hex.parse(lock.b_generation_corpus_sha256), config_sha256: lock.config_sha256, authors, system_sha256: sha256Hex(AUTHOR_SYSTEM) });
}
/** Resolve every task/suite from exact locked bytes, rather than trusting a caller's opaque descriptor hash. */
export function validateBGenerationCorpus(lock: RunLock, bytes: Readonly<Record<string, Uint8Array>>, decodeUtf8: (bytes: Uint8Array) => string): BGenerationCorpus {
  const read = (key: string, hash: string): unknown => {
    if (!bytes[key] || lock.inputs[key] !== hash || sha256Hex(bytes[key]) !== hash) throw new Error("B generation input drift");
    return JSON.parse(decodeUtf8(bytes[key]));
  };
  if (lock.stage !== "B" || !lock.b_generation_corpus_path?.startsWith("vault/") || !lock.b_generation_corpus_sha256 || lock.b_generation_sha256 !== bGenerationHash(lock)) throw new Error("B generation descriptor missing/drift");
  const corpus = BGenerationCorpusSchema.parse(read(lock.b_generation_corpus_path, lock.b_generation_corpus_sha256));
  const authors = z.object({ authors: z.object({ A: LockedReviewerSchema, B: LockedReviewerSchema }) }).parse(lock.model_lock).authors;
  if (corpus.admission_sha256 !== lock.inputs["corpus/ADMISSION.json"] || corpus.config_sha256 !== lock.config_sha256 || hashCanonical(corpus.authors) !== hashCanonical(authors) || corpus.system_sha256 !== sha256Hex(AUTHOR_SYSTEM) || !corpus.admitted_manifest_path.startsWith("vault/")) throw new Error("B admitted corpus/config/model/prompt drift");
  const manifest = z.object({ schema: z.literal("public-manifest/v1"), pending_activation: z.literal(false), manifest_sha256: Sha256Hex, records: z.array(PublicManifestRecordSchema).min(1) }).parse(read(corpus.admitted_manifest_path, corpus.admitted_manifest_sha256));
  if (manifest.records.some((r) => r.manifestHash !== manifest.manifest_sha256) || new Set(manifest.records.map((r) => r.id)).size !== manifest.records.length || hashCanonical([...manifest.records].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(({ manifestHash: _hash, ...r }) => { void _hash; return r; })) !== manifest.manifest_sha256) throw new Error("B admitted manifest commitment");
  const config = z.object({ quotas: z.object({ stratum_b: z.object({ heldout_tasks: z.number().int().positive() }) }) }).parse(read("protocol/preregistration.json", lock.config_sha256));
  if (corpus.tasks.length !== config.quotas.stratum_b.heldout_tasks || new Set(corpus.tasks.map((t) => t.task_id)).size !== corpus.tasks.length || new Set(corpus.tasks.map((t) => t.task_path)).size !== corpus.tasks.length) throw new Error("B admitted task inventory");
  for (const entry of corpus.tasks) {
    if (!entry.task_path.startsWith("vault/") || !lock.inputs[entry.task_path]) throw new Error("B task must be locked in custody");
    const task = TaskSchema.parse(read(entry.task_path, lock.inputs[entry.task_path]!));
    if (task.split !== "heldout" || task.task_id !== entry.task_id || !manifest.records.some((r) => r.taskId === task.task_id) || hashCanonical(task) !== entry.task_sha256 || filesSha256(task.hidden_tests) !== entry.suite_sha256 || hashCanonical(authorPrompt(task)) !== entry.prompt_sha256) throw new Error("B admitted task/suite/prompt substitution");
  }
  return corpus;
}
export function bindBGenerationPlan(corpus: BGenerationCorpus, slots: readonly PlannedSlot[], corpusSha256: string): void {
  if (new Set(slots.map((s) => s.task.task_id)).size !== corpus.tasks.length || corpus.tasks.some((t) => !slots.some((s) => s.task.task_id === t.task_id))) throw new Error("B plan task inventory differs from admitted corpus");
  for (const slot of slots) {
    const task = corpus.tasks.find((t) => t.task_id === slot.task.task_id);
    if (!task || hashCanonical(slot.task) !== task.task_sha256 || filesSha256(slot.task.hidden_tests) !== task.suite_sha256 || hashCanonical(authorPrompt(slot.task)) !== task.prompt_sha256 || (slot.purpose === "author" && (corpusSha256 !== corpus.admitted_manifest_sha256 || hashCanonical(slot.lock) !== hashCanonical(corpus.authors[slot.arm])))) throw new Error("B plan task/config/model/suite substitution");
  }
}
export function authorCellHash(task: z.infer<typeof TaskSchema>, author: "A" | "B", generationSha: string, model: z.infer<typeof LockedReviewerSchema>): string { return hashCanonical({ generation_sha256: generationSha, task_sha256: hashCanonical(task), author, model, prompt_sha256: hashCanonical(authorPrompt(task)) }); }
export function scheduleAuthorGeneration(raw: GenerationHistory, next: { task_id: string; author: "A" | "B"; cell_sha256: string; run_id: string; slot_id: string; fresh: number }): { history: GenerationHistory; decision: "issue" | "wait" | "cancel" } {
  const history = GenerationHistorySchema.parse(raw);
  if (next.fresh !== 1 && next.fresh !== 2) throw new Error("maximum two fresh generations");
  let cell = history.cells.find((c) => c.task_id === next.task_id && c.author === next.author);
  if (cell && (cell.generation_sha256 !== next.cell_sha256 || cell.attempts.some((a) => a.run_id !== next.run_id))) throw new Error("generation history forbids config/run reset");
  if (!cell) { if (next.fresh !== 1) throw new Error("missing first generation"); cell = { task_id: next.task_id, author: next.author, generation_sha256: next.cell_sha256, attempts: [] }; history.cells.push(cell); }
  if (next.fresh === 2) { const first = cell.attempts[0]; if (!first || first.qualification === "pending") return { history, decision: "wait" }; if (first.qualification === "pass") return { history, decision: "cancel" }; }
  const existing = cell.attempts.find((a) => a.fresh === next.fresh);
  if (existing && (existing.slot_id !== next.slot_id || existing.qualification !== "pending")) throw new Error("fresh generation already issued/qualified");
  if (!existing) { if (cell.attempts.length !== next.fresh - 1) throw new Error("generation history order/limit"); cell.attempts.push({ fresh: next.fresh, run_id: next.run_id, slot_id: next.slot_id, qualification: "pending", qualification_evidence_sha256: null, qualified_artifact_sha256: null }); }
  return { history: GenerationHistorySchema.parse(history), decision: "issue" };
}
export const QualificationEvidenceSchema = z.strictObject({ schema: z.literal("author-b-evidence/v2"), task_sha256: Sha256Hex, suite_sha256: Sha256Hex, validator: z.string(), appointment_sha256: Sha256Hex, mock: z.boolean(), attempts: z.array(z.strictObject({ slot_id: z.string(), source_sha256: Sha256Hex, compile: z.enum(["pass", "fail", "not_run"]), receipts: z.array(WitnessReceiptSchema).min(1) })).min(1).max(2) });
export function qualificationAttemptHash(evidence: z.infer<typeof QualificationEvidenceSchema>, index: number): string { const { attempts, ...binding } = evidence; if (!attempts[index]) throw new Error("missing qualification attempt"); return hashCanonical({ ...binding, attempt: attempts[index] }); }
export const QualifiedAuthorSchema = z.strictObject({ schema: z.literal("b-author-qualified/v2"), task: TaskSchema, variant: CleanVariant, author: z.enum(["A", "B"]), model: LockedReviewerSchema, lock_sha256: Sha256Hex, generation_sha256: Sha256Hex, cell_sha256: Sha256Hex, run_id: z.string(), plan_sha256: Sha256Hex, qualification: AuthorBundleSchema, qualification_evidence_path: z.string(), qualification_evidence_sha256: Sha256Hex, attempts: z.number().int().min(1).max(2), attempt_bindings: z.array(z.strictObject({ slot_id: z.string(), envelope_sha256: Sha256Hex, request_sha256: Sha256Hex, receipts_sha256: Sha256Hex })).min(1).max(2), source_sha256: Sha256Hex, prompt_sha256: Sha256Hex, mock: z.boolean() });
/** Two fresh attempts, always the identical spec/base prompt: no hidden-failure feedback can enter it. */
export function authorPrompt(task: z.infer<typeof TaskSchema>): string { return JSON.stringify({ spec: task.spec, base_files: task.base_files }); }
export function acceptAuthorBundle(raw: unknown): { variant: z.infer<typeof CleanVariant>; author: "A" | "B"; lock_sha256: string; attempts: number; mock: boolean } {
  const bundle = AuthorBundleSchema.parse(raw);
  const expectedTests = bundle.task.hidden_tests.map((f) => f.path);
  for (let i = 0; i < bundle.attempts.length; i++) {
    const attempt = bundle.attempts[i]!;
    if (attempt.attempt !== i + 1) throw new Error("author attempts must be fresh sequential attempts, maximum two");
    const e = attempt.envelope;
    if (e.slotId !== attempt.slot_id || e.requestedModel !== bundle.model.model_id || e.provider !== bundle.model.provider || e.api !== bundle.model.api || e.identity !== "match" || e.outcome !== "completed" || e.stopKind !== "complete" || e.text === null) continue;
    let output: z.infer<typeof AuthorOutputSchema>; try { output = AuthorOutputSchema.parse(JSON.parse(e.text)); } catch { continue; }
    if (new Set(output.files.map((f) => f.path)).size !== output.files.length || output.files.length !== bundle.task.base_files.length || bundle.task.base_files.some((f) => !output.files.some((h) => h.path === f.path))) throw new Error("unexpected author output path set");
    if (output.files.reduce((n, f) => n + f.content.split(/\r?\n/).filter((line) => line.trim().length > 0).length, 0) > 150) continue;
    const sourceHash = filesSha256(output.files);
    if (sourceHash !== attempt.source_sha256 || attempt.compile !== "pass") continue;
    if (attempt.receipts.some((r) => r.target_sha256 !== sourceHash || r.task_id !== bundle.task.task_id || r.expectation !== "passes" || !r.witnessed)) continue;
    if (expectedTests.some((p) => !attempt.receipts.some((r) => r.test.path === p && r.test.name === "*"))) continue;
    if (i !== bundle.attempts.length - 1) throw new Error("unexpected author outputs after first accepted attempt");
    return { variant: CleanVariant.parse({ variant_id: `b-${bundle.author}-clean`, task_id: bundle.task.task_id, head_files: output.files, kind: "clean", labels_authority: bundle.task.labels_authority }), author: bundle.author, lock_sha256: bundle.lock_sha256, attempts: i + 1, mock: bundle.attempts.some((a) => a.envelope.mock || a.envelope.synthetic) };
  }
  throw new AuthorQualificationFailed("author failed qualification after at most two fresh attempts");
}
export interface SeedCandidate { path: string; operator: OperatorName; source_sha256: string; head_files: z.infer<typeof SourceFile>[]; mutation_key: string }
/** Enumerate only mutations entirely within a changed run of the clean substrate vs task base. */
export function seedCandidates(task: z.infer<typeof TaskSchema>, clean: z.infer<typeof CleanVariant>, operators: readonly OperatorName[], ts: TsApi): SeedCandidate[] {
  if (task.task_id !== clean.task_id) throw new Error("B task mismatch");
  const base = new Map(task.base_files.map((f) => [f.path, f.content])); const out: SeedCandidate[] = [];
  for (const file of clean.head_files) {
    const intervals = deriveFileIntervals(base.get(file.path) ?? "", file.content);
    for (const mutation of enumerateMutations(file.content, file.path, operators, ts)) {
      const start = file.content.slice(0, mutation.range[0]).split("\n").length, end = file.content.slice(0, Math.max(mutation.range[0], mutation.range[1] - 1)).split("\n").length;
      if (!intervals.some((r) => start >= r.startLine && end <= r.endLine)) continue;
      const heads = clean.head_files.map((f) => f.path === file.path ? { ...f, content: applyMutation(f.content, mutation) } : f);
      out.push({ path: file.path, operator: mutation.operator, source_sha256: filesSha256(heads), head_files: heads, mutation_key: hashCanonical({ path: file.path, mutation }) });
    }
  }
  return out;
}
export const BPinRecordSchema = z.strictObject({ task_id: z.string(), author: z.enum(["A", "B"]), task_sha256: Sha256Hex, cell_sha256: Sha256Hex, qualified_path: z.string(), audit_path: z.string(), witnesses_path: z.string(), qualified_sha256: Sha256Hex, clean_sha256: Sha256Hex, defects: z.array(z.strictObject({ path: z.string(), operator: z.string(), source_sha256: Sha256Hex, head_files: z.array(SourceFile), mutation_key: Sha256Hex })).length(2), audit_sha256: Sha256Hex, witnesses_sha256: Sha256Hex, mock: z.boolean() });
export const BPinSchema = z.strictObject({ schema: z.literal("b-pin/v2"), generation_sha256: Sha256Hex, records: z.array(BPinRecordSchema).min(2), sha256: Sha256Hex, mock: z.boolean() });
export function makeBPin(records: readonly z.infer<typeof BPinRecordSchema>[], generationSha256: string) {
  if (!records.length || new Set(records.map((r) => `${r.task_id}/${r.author}`)).size !== records.length) throw new Error("empty or duplicate B pin records");
  for (const r of records) if (r.defects.length !== 2 || new Set(r.defects.map((d) => d.source_sha256)).size !== 2) throw new Error("B needs exactly two distinct witnessed defects per author/task");
  for (const id of new Set(records.map((r) => r.task_id))) { const pair = records.filter((r) => r.task_id === id); if (pair.length !== 2 || new Set(pair.map((r) => r.author)).size !== 2 || pair[0]!.task_sha256 !== pair[1]!.task_sha256) throw new Error("B requires complete paired author cells"); }
  const sorted = [...records].sort((a, b) => `${a.task_id}/${a.author}` < `${b.task_id}/${b.author}` ? -1 : 1);
  const body = { schema: "b-pin/v2" as const, generation_sha256: generationSha256, records: sorted, mock: sorted.some((r) => r.mock) };
  return { ...body, sha256: hashCanonical(body) };
}
export function verifyBPin(raw: unknown, generationSha256: string) { const pin = BPinSchema.parse(raw); const expected = makeBPin(pin.records, generationSha256); if (hashCanonical(pin) !== hashCanonical(expected)) throw new Error("B pin provenance/hash drift"); for (const r of pin.records) for (const d of r.defects) if (filesSha256(d.head_files) !== d.source_sha256) throw new Error("B pin head hash"); return pin; }
