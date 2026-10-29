// Offline verification of the actual authorized run, every attempt and its raw transport recording.
import { readFile, readdir, open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canonicalJson, hashCanonical } from "../../src/core/defectcorpus/hashes.ts";
import { sha256Hex } from "../../src/core/hash/sha256.ts";
import { RunPlanSchema, requestFor } from "../../src/core/runstate/recordings.ts";
import { AttemptSchema, EnvelopeSchema, SnapshotSchema, TransportRecordSchema, GenerationHistorySchema } from "../../src/core/runstate/evidence.ts";
import { RunLockSchema, validateLock, type RunLock } from "../../src/core/protocol/index.ts";
import { bGenerationHash, authorCellHash, validateBGenerationCorpus, bindBGenerationPlan } from "../../src/core/protocol/b.ts";
import { RelPath, Sha256Hex } from "../../src/core/defectcorpus/schema.ts";
import { createProvider, TransportError } from "../../src/core/providers/port.ts";
import { adapterFor } from "../../src/core/providers/mock.ts";
import { settle } from "../../src/core/ledger/index.ts";
import { contained, StageGrantSchema, type VaultSession } from "./vault.ts";

const LookSchema = z.strictObject({ run_id: z.string(), lock_sha256: z.string(), corpus_sha256: z.string(), config_sha256: z.string(), purpose: z.enum(["author", "review"]), stage: z.enum(["A", "B"]), action: z.literal("authorize"), at: z.iso.datetime() });
export const InputSnapshotSchema = z.strictObject({ schema: z.literal("run-input-snapshot/v1"), lock_sha256: Sha256Hex, inputs: z.record(RelPath, z.strictObject({ path: RelPath, sha256: Sha256Hex })) });
type SnapshotRef = Pick<z.infer<typeof SnapshotSchema>["execution"], "input_snapshot_path" | "input_snapshot_sha256">;
/** Exclusive exact-byte copies are bound into execution BEFORE collection can reserve/send. */
export async function snapshotExecutionInputs(v: VaultSession, directory: string, lock: RunLock, bytes: Readonly<Record<string, Uint8Array>>): Promise<SnapshotRef> {
  validateLock(lock, bytes);
  const dir = await contained(v.vault, path.resolve(v.vault, directory));
  await v.directory(path.join(dir, "inputs"));
  const inputs: z.infer<typeof InputSnapshotSchema>["inputs"] = {}, copied = new Set<string>();
  async function create(file: string, content: Uint8Array | string): Promise<void> { const h = await open(await v.destination(file), "wx"); try { await h.writeFile(content); await h.sync(); } finally { await h.close(); } }
  for (const [key, hash] of Object.entries(lock.inputs)) {
    const relative = `inputs/${hash}.bin`;
    if (!copied.has(hash)) { await create(path.join(dir, relative), bytes[key]!); copied.add(hash); }
    inputs[key] = { path: relative, sha256: hash };
  }
  const text = canonicalJson({ schema: "run-input-snapshot/v1", lock_sha256: hashCanonical(lock), inputs }) + "\n";
  const file = path.join(dir, "INPUTS.json"); await create(file, text);
  return { input_snapshot_path: path.relative(v.vault, file).split(path.sep).join("/"), input_snapshot_sha256: sha256Hex(text) };
}
/** Historical inputs come from bound copies; current installed executable code must STILL match its lock. */
export async function readExecutionInputs(v: VaultSession, directory: string, execution: SnapshotRef, lock: RunLock): Promise<Record<string, Uint8Array>> {
  const dir = await contained(v.vault, path.resolve(v.vault, directory));
  if (await contained(v.vault, path.resolve(v.vault, execution.input_snapshot_path)) !== path.join(dir, "INPUTS.json")) throw new Error("snapshot belongs to another run");
  const raw = await v.read(execution.input_snapshot_path);
  if (sha256Hex(raw) !== execution.input_snapshot_sha256) throw new Error("input snapshot map drift");
  const snapshot = InputSnapshotSchema.parse(JSON.parse(raw.toString("utf8")));
  if (snapshot.lock_sha256 !== hashCanonical(lock) || hashCanonical(Object.keys(snapshot.inputs).sort()) !== hashCanonical(Object.keys(lock.inputs).sort())) throw new Error("snapshot input inventory drift");
  const bytes: Record<string, Uint8Array> = {};
  for (const [key, hash] of Object.entries(lock.inputs)) {
    const entry = snapshot.inputs[key]!;
    if (entry.sha256 !== hash || entry.path !== `inputs/${hash}.bin`) throw new Error("snapshot input reference drift");
    bytes[key] = await v.read(path.join(dir, entry.path));
  }
  validateLock(lock, bytes);
  const installed = new Set<string>();
  const checkInstalled = async (relative: string): Promise<void> => {
    const entries = await readdir(await contained(v.root, path.join(v.root, relative)), { withFileTypes: true });
    for (const entry of entries) {
      const key = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("redirected installed source");
      if (entry.isDirectory()) await checkInstalled(key);
      else if (entry.isFile() && entry.name.endsWith(".ts")) { installed.add(key); if (!lock.inputs[key] || sha256Hex(await v.readKey(key)) !== lock.inputs[key]) throw new Error("installed executable source differs from historical lock"); }
    }
  };
  await checkInstalled("src/core"); await checkInstalled("cli");
  if (Object.keys(lock.inputs).some((key) => /^(src\/core|cli)\/.+\.ts$/.test(key) && !installed.has(key))) throw new Error("missing installed executable source");
  return bytes;
}
/** Reconcile against ALL persisted author runs, so omitting a cell/file cannot start a fresh two-item history. */
export async function reconcileGenerationInventory(v: VaultSession, raw: unknown) {
  const history = GenerationHistorySchema.parse(raw), seen = new Set<string>();
  const runs = await contained(v.vault, path.join(v.vault, "runs"));
  for (const name of await readdir(runs)) {
    const dir = await contained(v.vault, path.join(runs, name));
    const plan = RunPlanSchema.parse(await v.json(path.join(dir, "plan.json"))), state = SnapshotSchema.parse(await v.json(path.join(dir, "slots.json"))), lock = RunLockSchema.parse(await v.json(path.join(dir, "LOCK.json")));
    if (plan.run_id !== name || state.run_id !== name || state.plan_sha256 !== hashCanonical(plan) || state.lock_sha256 !== hashCanonical(lock)) throw new Error("generation inventory run drift");
    for (const p of plan.slots.filter((s) => s.purpose === "author")) {
      const slot = state.slots.find((s) => s.id === p.id);
      const cell = history.cells.find((c) => c.task_id === p.task.task_id && c.author === p.author), attempt = cell?.attempts.find((a) => a.run_id === plan.run_id && a.slot_id === p.id);
      if (slot?.attempts && !attempt) throw new Error("persisted generation omitted from history");
      if (attempt) {
        const key = `${attempt.run_id}/${attempt.slot_id}`; if (seen.has(key) || !p.author || !lock.b_generation_sha256 || attempt.fresh !== p.fresh_attempt || cell!.generation_sha256 !== authorCellHash(p.task, p.author, lock.b_generation_sha256, p.lock)) throw new Error("generation history provenance drift");
        seen.add(key);
      }
    }
  }
  if (history.cells.some((c) => c.attempts.some((a) => !seen.has(`${a.run_id}/${a.slot_id}`)))) throw new Error("history refers to missing author recording");
  return history;
}
export async function loadExecution(v: VaultSession, directory: string, terminal = true, generationSource = false) {
  const dir = await contained(v.vault, path.resolve(v.vault, directory));
  const plan = RunPlanSchema.parse(await v.json(path.join(dir, "plan.json")));
  const state = SnapshotSchema.parse(await v.json(path.join(dir, "slots.json")));
  const lock = RunLockSchema.parse(await v.json(path.join(dir, "LOCK.json")));
  if ((!generationSource && hashCanonical(lock) !== hashCanonical(v.lock)) || (generationSource && (lock.b_generation_sha256 !== v.lock.b_generation_sha256 || lock.b_generation_sha256 !== bGenerationHash(lock))) || state.lock_sha256 !== hashCanonical(lock) || state.plan_sha256 !== hashCanonical(plan) || state.run_id !== plan.run_id || path.basename(dir) !== plan.run_id) throw new Error("persisted execution drift");
  const locked = await readExecutionInputs(v, dir, state.execution, lock);
  if (!generationSource) { const current: Record<string, Uint8Array> = {}; for (const key of Object.keys(lock.inputs)) current[key] = await v.readKey(key); validateLock(lock, current); }
  if (lock.inputs["corpus/ADMISSION.json"] !== state.execution.admission_sha256 || lock.inputs["corpus/manifest.public.json"] !== lock.corpus_sha256 || lock.inputs["protocol/preregistration.json"] !== lock.config_sha256 || !locked["protocol/model-lock.json"] || hashCanonical(JSON.parse(new TextDecoder().decode(locked["protocol/model-lock.json"]))) !== hashCanonical(lock.model_lock)) throw new Error("source admission/corpus/config/model commitment");
  if (lock.stage === "B") bindBGenerationPlan(validateBGenerationCorpus(lock, locked, (bytes) => new TextDecoder().decode(bytes)), plan.slots, lock.corpus_sha256);
  const lockedPlan = locked[state.execution.plan_input_path];
  if (!lockedPlan || hashCanonical(RunPlanSchema.parse(JSON.parse(new TextDecoder().decode(lockedPlan)))) !== state.plan_sha256 || new Set(plan.slots.map((s) => s.purpose)).size !== 1) throw new Error("plan is not the authorized locked input");
  const stage = StageGrantSchema.parse(JSON.parse(new TextDecoder().decode(locked[lock.stage_grant_path])));
  if (stage.stage !== lock.stage || stage.config_sha256 !== lock.config_sha256 || lock.inputs[lock.stage_grant_path] !== lock.stage_grant_sha256) throw new Error("source stage authorization drift");
  if (terminal && state.status === "collecting") throw new Error("run still collecting");
  if (state.execution.mode !== "live" || state.execution.admission_sha256 !== v.admissionSha256 || state.execution.appointment_sha256 !== v.appointmentSha256 || state.execution.stage_grant_sha256 !== lock.stage_grant_sha256) throw new Error("unauthorized measured execution");
  const looks = (await readFile(await contained(v.root, path.join(v.root, "runs/LOOKS.jsonl")), "utf8")).split("\n").filter(Boolean).map((line) => LookSchema.parse(JSON.parse(line)));
  const matching = looks.filter((l) => l.run_id === plan.run_id && l.lock_sha256 === state.lock_sha256 && l.config_sha256 === lock.config_sha256 && l.corpus_sha256 === lock.corpus_sha256 && l.stage === lock.stage && l.purpose === plan.slots[0]!.purpose);
  if (matching.length !== 1 || hashCanonical(matching[0]) !== state.execution.look_sha256) throw new Error("authorized look mismatch");
  const runtime = path.resolve(v.root, "..", ".runtime");
  const global = z.array(AttemptSchema).parse(JSON.parse(await readFile(await contained(runtime, path.join(runtime, "ledger.json")), "utf8")));
  if (new Set(global.map((a) => a.id)).size !== global.length || new Set(state.ledger.map((a) => a.id)).size !== state.ledger.length) throw new Error("duplicate ledger");
  if (state.slots.length !== plan.slots.length || state.slots.some((s, i) => s.id !== plan.slots[i]?.id) || new Set(state.slots.map((s) => s.id)).size !== state.slots.length) throw new Error("slot inventory mismatch");
  const prices = z.object({ models: z.record(z.string(), z.object({ input_usd_per_mtok: z.number().nonnegative(), output_usd_per_mtok: z.number().nonnegative(), cached_input_usd_per_mtok: z.number().nonnegative().optional(), cache_write_usd_per_mtok: z.number().nonnegative().optional() })) }).parse(JSON.parse(new TextDecoder().decode(locked["protocol/prices.json"])));
  const expectedArtifacts = new Set<string>();
  const model = z.object({ reviewers: z.record(z.string(), z.unknown()), authors: z.record(z.string(), z.unknown()).optional() }).parse(lock.model_lock);
  for (let i = 0; i < plan.slots.length; i++) {
    const p = plan.slots[i]!, slot = state.slots[i]!; const request = requestFor(p);
    if (p.task.split !== "heldout" || p.stratum !== lock.stage || hashCanonical((p.purpose === "author" ? model.authors : model.reviewers)?.[p.arm]) !== hashCanonical(p.lock)) throw new Error("slot differs from authorized stage/model");
    if (terminal && !["settled", "unknown", "cancelled"].includes(slot.state)) throw new Error("nonterminal slot");
    if (state.status === "terminal_complete" && slot.state === "unknown") throw new Error("complete run has unknown slot");
    if (state.status === "terminal_complete" && p.purpose === "review" && slot.state === "cancelled") throw new Error("complete review has cancelled slot");
    if (slot.attempts === 0 && (slot.envelope !== null || !["planned", "cancelled"].includes(slot.state))) throw new Error("unissued slot invariant");
    if (slot.state === "cancelled" && slot.attempts > 0) throw new Error("issued slot cannot disappear");
    const rows = state.ledger.filter((a) => a.slot_id === slot.id);
    if (rows.length !== slot.attempts) throw new Error("attempt inventory mismatch");
    for (let n = 1; n <= slot.attempts; n++) {
      const id = `${plan.run_id}.${slot.id}.${n}`; const row = rows.find((a) => a.id === id);
      if (!row || !global.some((a) => a.id === id && canonicalJson(a) === canonicalJson(row))) throw new Error("app ledger mismatch");
      const name = `${slot.id}.${n}.json`, transportName = `${slot.id}.${n}.transport.json`;
      expectedArtifacts.add(name); expectedArtifacts.add(transportName);
      const envelope = EnvelopeSchema.parse(await v.json(path.join(dir, "artifacts", name)));
      const wire = TransportRecordSchema.parse(await v.json(path.join(dir, "artifacts", transportName)));
      const requestHash = sha256Hex(adapterFor(p.lock.provider).buildRequest(request).body);
      if (wire.mode !== state.execution.mode || wire.request_sha256 !== requestHash || envelope.requestSha256 !== requestHash || envelope.mock || envelope.synthetic) throw new Error("transport/request/MOCK lineage");
      const reconstructed = await createProvider(adapterFor(p.lock.provider), async () => {
        if (wire.error) throw new TransportError(wire.error.phase, wire.error.message);
        return wire.response!;
      }).complete(request);
      if (canonicalJson(reconstructed) !== canonicalJson(envelope)) throw new Error("envelope differs from raw response");
      if (n === slot.attempts && canonicalJson(envelope) !== canonicalJson(slot.envelope)) throw new Error("state envelope differs from artifact");
      const settled = settle({ ...row, state: "reserved", actual_usd: null }, envelope, prices.models[p.arm]!);
      if (canonicalJson(settled) !== canonicalJson(row)) throw new Error("settlement drift");
      if (n < slot.attempts && !(envelope.preSendFailure && envelope.billing === "not_sent") && !(envelope.rateLimited && envelope.billing === "rejected_unbilled")) throw new Error("unexpected retry generation");
    }
  }
  if (terminal && (state.events.at(-1)?.state !== state.status || (state.status === "terminal_partial" && state.stop_reason === null))) throw new Error("terminal recording invariant");
  if (state.ledger.some((a) => !state.slots.some((s) => s.id === a.slot_id)) || global.filter((a) => a.id.startsWith(`${plan.run_id}.`)).length !== state.ledger.length) throw new Error("omitted execution attempts");
  const artifacts = await contained(v.vault, path.join(dir, "artifacts"));
  const names = await readdir(artifacts);
  if (names.length !== expectedArtifacts.size || names.some((n) => !expectedArtifacts.has(n))) throw new Error("unexpected/missing persisted artifact");
  return { dir, plan, state, lock };
}
