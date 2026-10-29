import { z } from "zod";
import ts from "typescript";
import path from "node:path";
import { acceptAuthorBundle, authorCellHash, authorPrompt, QualifiedAuthorSchema, QualificationEvidenceSchema, qualificationAttemptHash, seedCandidates } from "../../src/core/protocol/b.ts";
import { AuthorAuditSchema } from "../../src/core/runstate/evidence.ts";
import { WitnessReceiptSchema, Sha256Hex, RelPath } from "../../src/core/defectcorpus/schema.ts";
import { hashCanonical } from "../../src/core/defectcorpus/hashes.ts";
import { sha256Hex } from "../../src/core/hash/sha256.ts";
import { filesSha256 } from "../../src/core/sandbox/runner.ts";
import { OPERATOR_NAMES } from "../../src/core/operators/types.ts";
import { evaluateMutantAdmission } from "../../src/core/operators/admission.ts";
import { loadExecution, reconcileGenerationInventory } from "./execution.ts";
import type { VaultSession } from "./vault.ts";
export const SeedRefSchema = z.strictObject({ qualified_path: RelPath, audit_path: RelPath, witnesses_path: RelPath });
export const SeedWitnessSchema = z.strictObject({ schema: z.literal("b-seed-witnesses/v2"), task_sha256: Sha256Hex, source_sha256: Sha256Hex, suite_sha256: Sha256Hex, validator: z.string(), appointment_sha256: Sha256Hex, mock: z.boolean(), witnesses: z.array(z.strictObject({ mutation_key: Sha256Hex, compile: z.enum(["pass", "fail", "not_run"]), defect: WitnessReceiptSchema, twin: WitnessReceiptSchema })).length(2) });
export async function verifyBRecord(v: VaultSession, ref: z.infer<typeof SeedRefSchema>, mustBeLocked = false) {
  async function read(file: string) {
    RelPath.parse(file); const bytes = await v.read(file);
    if (mustBeLocked && v.lock.inputs[`vault/${file}`] !== sha256Hex(bytes)) throw new Error("B provenance input not locked");
    return JSON.parse(bytes.toString("utf8")) as unknown;
  }
  const q = QualifiedAuthorSchema.parse(await read(ref.qualified_path));
  const qualificationEvidence = QualificationEvidenceSchema.parse(await read(q.qualification_evidence_path));
  const accepted = acceptAuthorBundle(q.qualification), taskHash = hashCanonical(q.task), suiteHash = filesSha256(q.task.hidden_tests);
  if (q.generation_sha256 !== v.lock.b_generation_sha256 || q.cell_sha256 !== authorCellHash(q.task, q.author, q.generation_sha256, q.model) || q.source_sha256 !== filesSha256(q.variant.head_files) || q.prompt_sha256 !== hashCanonical(authorPrompt(q.task)) || hashCanonical(accepted.variant) !== hashCanonical(q.variant) || accepted.author !== q.author || accepted.lock_sha256 !== q.lock_sha256 || q.attempts !== accepted.attempts || q.mock !== accepted.mock || hashCanonical(q.qualification.task) !== taskHash || q.qualification.author !== q.author || q.qualification.generation_sha256 !== q.generation_sha256 || hashCanonical(q.qualification.model) !== hashCanonical(q.model)) throw new Error("qualified artifact drift");
  if (hashCanonical(qualificationEvidence) !== q.qualification_evidence_sha256 || qualificationEvidence.task_sha256 !== taskHash || qualificationEvidence.suite_sha256 !== suiteHash || qualificationEvidence.validator !== v.appointment.validator || qualificationEvidence.appointment_sha256 !== v.appointmentSha256 || qualificationEvidence.mock || qualificationEvidence.attempts.length !== q.attempts) throw new Error("qualification attestation drift");
  const execution = await loadExecution(v, path.join("runs", q.run_id), false, true);
  const history = await reconcileGenerationInventory(v, await v.json("generation-history.json"));
  const cells = history.cells.filter((c) => c.task_id === q.task.task_id && c.author === q.author), cell = cells[0];
  if (cells.length !== 1 || !cell || cell.generation_sha256 !== q.cell_sha256 || cell.attempts.length !== q.attempts || cell.attempts.at(-1)!.qualification !== "pass" || cell.attempts.at(-1)!.qualified_artifact_sha256 !== hashCanonical(q) || execution.state.lock_sha256 !== q.lock_sha256 || execution.state.plan_sha256 !== q.plan_sha256 || q.attempt_bindings.length !== q.attempts) throw new Error("actual author history drift");
  for (let i = 0; i < cell.attempts.length; i++) {
    const a = cell.attempts[i]!, b = q.attempt_bindings[i]!, recorded = q.qualification.attempts[i]!, attested = qualificationEvidence.attempts[i]!;
    if (a.qualification_evidence_sha256 !== qualificationAttemptHash(qualificationEvidence, i)) throw new Error("persisted qualification evidence drift");
    const p = execution.plan.slots.find((s) => s.id === a.slot_id), state = execution.state.slots.find((s) => s.id === a.slot_id);
    if (a.fresh !== i + 1 || a.run_id !== q.run_id || a.slot_id !== b.slot_id || b.slot_id !== recorded.slot_id || recorded.slot_id !== attested.slot_id || p?.purpose !== "author" || p.fresh_attempt !== a.fresh || p.author !== q.author || hashCanonical(p.task) !== taskHash || hashCanonical(p.lock) !== hashCanonical(q.model) || state?.state !== "settled" || hashCanonical(state.envelope) !== b.envelope_sha256 || hashCanonical(recorded.envelope) !== b.envelope_sha256 || recorded.envelope.requestSha256 !== b.request_sha256 || hashCanonical(recorded.receipts) !== b.receipts_sha256 || hashCanonical(attested.receipts) !== b.receipts_sha256 || recorded.compile !== attested.compile || recorded.source_sha256 !== attested.source_sha256) throw new Error("actual author attempt binding");
    for (const r of recorded.receipts) if (!q.task.hidden_tests.some((t) => t.path === r.test.path) || r.executor !== v.appointment.validator || r.probe_receipt_sha256 !== execution.lock.inputs[execution.lock.probe_path] || r.sandbox_image_digest !== execution.lock.sandbox_image.split("@")[1]) throw new Error("author witness provenance");
  }
  const audit = AuthorAuditSchema.parse(await read(ref.audit_path));
  if (audit.task_sha256 !== taskHash || audit.author !== q.author || audit.qualified_sha256 !== hashCanonical(q) || audit.generation_sha256 !== q.generation_sha256 || audit.source_sha256 !== q.source_sha256 || audit.suite_sha256 !== suiteHash || audit.validator !== v.appointment.validator || audit.appointment_sha256 !== v.appointmentSha256 || audit.probe_receipt_sha256 !== v.lock.inputs[v.lock.probe_path] || audit.sandbox_image !== v.lock.sandbox_image) throw new Error("blind validator audit binding");
  const evidence = SeedWitnessSchema.parse(await read(ref.witnesses_path));
  if (evidence.task_sha256 !== taskHash || evidence.source_sha256 !== q.source_sha256 || evidence.suite_sha256 !== suiteHash || evidence.validator !== v.appointment.validator || evidence.appointment_sha256 !== v.appointmentSha256 || new Set(evidence.witnesses.map((w) => w.mutation_key)).size !== 2) throw new Error("seed witness suite binding");
  const candidates = seedCandidates(q.task, q.variant, OPERATOR_NAMES, ts);
  const defects = evidence.witnesses.map((w) => {
    const candidate = candidates.find((c) => c.mutation_key === w.mutation_key);
    if (!candidate || w.defect.target_sha256 !== candidate.source_sha256 || w.twin.target_sha256 !== q.source_sha256 || w.defect.task_id !== q.task.task_id || w.twin.task_id !== q.task.task_id || !q.task.hidden_tests.some((t) => t.path === w.defect.test.path) || w.defect.test.name === "*" || !evaluateMutantAdmission({ compile: w.compile, mutationsApplied: 1, defectReceipt: w.defect, twinReceipt: w.twin }).admitted) throw new Error("seed witness does not separate exact mutant/twin");
    for (const r of [w.defect, w.twin]) if (r.executor !== v.appointment.validator || r.probe_receipt_sha256 !== v.lock.inputs[v.lock.probe_path] || r.sandbox_image_digest !== v.lock.sandbox_image.split("@")[1]) throw new Error("seed witness executor/probe binding");
    return candidate;
  });
  return { ...ref, task_id: q.task.task_id, author: q.author, task_sha256: taskHash, cell_sha256: q.cell_sha256, qualified_sha256: hashCanonical(q), clean_sha256: q.source_sha256, defects, audit_sha256: hashCanonical(audit), witnesses_sha256: hashCanonical(evidence), mock: q.mock || audit.mock || evidence.mock };
}
