// DEFERRED, NEVER RUN during construction. All code/tasks/labels/appointments here are MOCK builder data
// in OS-temp roots. openVault is mocked; synthetic live-shaped recordings exercise offline reconstruction
// only and provide NO real admission, independent witness, provider origin or held-out execution evidence.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { mkdtemp, realpath, mkdir, readFile, writeFile, appendFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import * as vaultPolicy from "../../cli/lib/vault.ts";
import type { VaultSession } from "../../cli/lib/vault.ts";
import { snapshotExecutionInputs, loadExecution, readExecutionInputs } from "../../cli/lib/execution.ts";
import { runAuthorB } from "../../cli/author-b.ts";
import { runSeedB } from "../../cli/seed-b.ts";
import { verifyBRecord } from "../../cli/lib/b-evidence.ts";
import { freezeRun, frozenReport, verifyRunFreeze } from "../../cli/lib/freeze.ts";
import { bindExportToRun, bindExportToManifest, exportRows, runExportS45 } from "../../cli/export-s45.ts";
import { exclusive } from "../../cli/run.ts";
import { AUTHOR_SYSTEM, BGenerationCorpusSchema, QualifiedAuthorSchema, authorPrompt, authorCellHash, bGenerationHash, bindBGenerationPlan, scheduleAuthorGeneration, seedCandidates, validateBGenerationCorpus, verifyBPin } from "../../src/core/protocol/b.ts";
import { RunLockSchema, type RunLock } from "../../src/core/protocol/index.ts";
import { RunPlanSchema, requestFor, type PlannedSlot } from "../../src/core/runstate/recordings.ts";
import { SnapshotSchema, AuthorAuditSchema, type GenerationHistory } from "../../src/core/runstate/evidence.ts";
import { TaskSchema, CleanVariant, VariantSchema, WitnessReceiptSchema } from "../../src/core/defectcorpus/schema.ts";
import { canonicalJson, hashCanonical } from "../../src/core/defectcorpus/hashes.ts";
import { toPublicRecord } from "../../src/core/defectcorpus/projection.ts";
import { sha256Hex } from "../../src/core/hash/sha256.ts";
import { filesSha256 } from "../../src/core/sandbox/runner.ts";
import { OPERATOR_NAMES } from "../../src/core/operators/types.ts";
import { createProvider } from "../../src/core/providers/port.ts";
import { adapterFor } from "../../src/core/providers/mock.ts";
import { settle, type Attempt } from "../../src/core/ledger/index.ts";
import { renderResultsJson, renderResultsMarkdown } from "../../src/core/reviewjudge/report.ts";
import { testLock } from "../core/providers/helpers.ts";

const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const at = "2026-10-27T00:00:00Z", h = "a".repeat(64), validator = "0998_MOCK_BuilderValidator";
const temps: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true }); });
const text = (value: unknown) => canonicalJson(value) + "\n";

describe("B generation to separate review manifest (synthetic source scenario)", () => {
  // Bounded full lifecycle performs many durable snapshot/lock I/O steps; allow slow Windows filesystem hosts.
  it("what_bug_this_catches: generated B heads must not retroactively change admitted generation inputs, qualification, pin or historical source verification", async () => {
    const outer = await realpath(await mkdtemp(path.join(os.tmpdir(), "s41-MOCK-b-lifecycle-"))); temps.push(outer);
    const root = path.join(outer, "repo"), vault = path.join(outer, "vault"), runtime = path.join(outer, ".runtime");
    for (const dir of [root, vault, runtime, path.join(root, "src/core"), path.join(root, "cli"), path.join(root, "runs")]) await mkdir(dir, { recursive: true });
    const write = async (file: string, value: unknown) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === "string" ? value : text(value)); };
    const task = TaskSchema.parse({ task_id: "H99", split: "heldout", spec: "Compare both orders of a pair.", intent: "MOCK builder intent, never real held-out content.", base_files: [{ path: "main.ts", content: "export const f = (a: number, b: number) => false;\nexport const g = (a: number, b: number) => false;\n" }], hidden_tests: [{ path: "main.test.ts", content: "// MOCK builder suite; no actual test is executed\n" }], executable_lines: 2, labels_authority: "steward_heldout" });
    const placeholder = CleanVariant.parse({ task_id: task.task_id, variant_id: "MOCK-placeholder", kind: "clean", labels_authority: task.labels_authority, head_files: task.base_files });
    const authors = { A: testLock("openai", { model_id: "MOCK-builder-author-A", system_prompt_sha256: sha256Hex(AUTHOR_SYSTEM), output_cap_tokens: 16000 }), B: testLock("openai", { model_id: "MOCK-builder-author-B", system_prompt_sha256: sha256Hex(AUTHOR_SYSTEM), output_cap_tokens: 16000 }) };
    const reviewers = { A: testLock("openai", { model_id: "MOCK-builder-review-A" }), B: testLock("openai", { model_id: "MOCK-builder-review-B" }) };
    const model = { status: "locked", requires: [], authors, reviewers };
    const prereg = { schema: "preregistration/v1", status: "locked", requires: [], repeats: { heldout: 1 }, slots: { a_heldout: 2, b_heldout: 12 }, quotas: { heldout: { tasks: 1 }, variants_per_task: ["clean"], stratum_b: { heldout_tasks: 1, clean_per_substrate: 1, operator_defects_per_substrate: 2 } } };
    const manifestFor = (records: { task: typeof task; variant: z.infer<typeof VariantSchema> }[]) => {
      const draft = records.map(({ task: t, variant }) => { const { manifestHash: _hash, ...r } = toPublicRecord(variant, t, { manifestHash: h, embargoStatus: "embargoed" }); void _hash; return r; }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const hash = hashCanonical(draft);
      return { schema: "public-manifest/v1", pending_activation: false, manifest_sha256: hash, records: draft.map((r) => ({ ...r, manifestHash: hash })) };
    };
    // Known admitted A input, intentionally unrelated to either as-yet nonexistent generated B head.
    const admittedManifest = manifestFor([{ task, variant: { ...placeholder, variant_id: "MOCK-prior-A", head_files: [{ path: "main.ts", content: "// MOCK prior A input\n" + task.base_files[0]!.content }] } }]);
    const admission = { schema: "MOCK-admission-control", status: "GO", note: "mocked authorization; never used with openVault" };
    const rate = { input_usd_per_mtok: 1, output_usd_per_mtok: 1 };
    const common: Record<string, Buffer> = {
      "src/core/MOCK-installed.ts": Buffer.from("// MOCK installed core source\n"), "cli/MOCK-installed.ts": Buffer.from("// MOCK installed CLI source\n"),
      "protocol/model-lock.json": Buffer.from(text(model)), "protocol/prices.json": Buffer.from(text({ models: { A: rate, B: rate } })),
      "protocol/preregistration.json": Buffer.from(text(prereg)), "corpus/ADMISSION.json": Buffer.from(text(admission)),
      "vault/generation/admitted-manifest.json": Buffer.from(text(admittedManifest)), "vault/generation/H99/task.json": Buffer.from(text(task)),
      "probe.json": Buffer.from("MOCK probe bytes\n"),
    };
    const corpus = BGenerationCorpusSchema.parse({ schema: "b-generation-corpus/v1", admission_sha256: sha256Hex(common["corpus/ADMISSION.json"]!), admitted_manifest_path: "vault/generation/admitted-manifest.json", admitted_manifest_sha256: sha256Hex(common["vault/generation/admitted-manifest.json"]!), config_sha256: sha256Hex(common["protocol/preregistration.json"]!), authors, system_sha256: sha256Hex(AUTHOR_SYSTEM), tasks: [{ task_id: task.task_id, task_path: "vault/generation/H99/task.json", task_sha256: hashCanonical(task), suite_sha256: filesSha256(task.hidden_tests), prompt_sha256: hashCanonical(authorPrompt(task)) }] });
    common["vault/generation/CORPUS.json"] = Buffer.from(text(corpus));
    common["grant.json"] = Buffer.from(text({ schema: "roy-stage-grant/v1", approved_by: "Roy", stage: "B", dirty_mode_closed: true, heldout_use_authorized: true, config_sha256: corpus.config_sha256, dev_qualification: { hit: 0.5, non_valid: 0, planned: 10 } }));
    const v = {
      root, vault, lock: undefined as unknown as RunLock, admission, admissionSha256: corpus.admission_sha256,
      appointment: { validator }, appointmentSha256: h, generationCorpus: corpus,
      read: async (p: string) => readFile(await vaultPolicy.contained(vault, path.resolve(vault, p))),
      json: async (p: string) => JSON.parse((await v.read(p)).toString("utf8")) as unknown,
      readKey: async (key: string) => key.startsWith("vault/") ? v.read(key.slice(6)) : readFile(await vaultPolicy.contained(root, path.join(root, key))),
      destination: async (p: string) => vaultPolicy.contained(vault, path.resolve(vault, p), true),
      directory: async (p: string) => { const dest = await v.destination(p); await mkdir(dest, { recursive: true }); return vaultPolicy.contained(vault, dest); },
      audit: async () => {},
    } as unknown as VaultSession;
    vi.spyOn(vaultPolicy, "openVault").mockResolvedValue(v);
    const persistInputs = async (bytes: Record<string, Uint8Array>) => { for (const [key, value] of Object.entries(bytes)) { const file = key.startsWith("vault/") ? path.join(vault, key.slice(6)) : path.join(root, key); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); } };
    const locked = (bytes: Record<string, Uint8Array>) => {
      const lock = RunLockSchema.parse({ schema: "run-lock/v1", model_lock: model, inputs: Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, sha256Hex(value)])), corpus_sha256: sha256Hex(bytes["corpus/manifest.public.json"]!), config_sha256: corpus.config_sha256, b_generation_corpus_path: "vault/generation/CORPUS.json", b_generation_corpus_sha256: sha256Hex(bytes["vault/generation/CORPUS.json"]!), b_generation_sha256: h, presentation_seed: 1, sandbox_qualified: true, sandbox_image: `MOCK-image@sha256:${h}`, probe_path: "probe.json", stage_grant_path: "grant.json", dirty_mode: false, stage: "B", stage_grant_sha256: sha256Hex(bytes["grant.json"]!) });
      lock.b_generation_sha256 = bGenerationHash(lock); return lock;
    };
    let global: Attempt[] = [];
    const persistRun = async (plan: ReturnType<typeof RunPlanSchema.parse>, lock: RunLock, bytes: Record<string, Uint8Array>, outputFor: (s: PlannedSlot) => string) => {
      v.lock = lock; await persistInputs(bytes);
      const dir = await v.directory(`runs/${plan.run_id}`); await v.directory(path.join(dir, "artifacts"));
      await write(path.join(dir, "LOCK.json"), lock); await write(path.join(dir, "plan.json"), plan);
      const snapshot = await snapshotExecutionInputs(v, dir, lock, bytes);
      const look = { run_id: plan.run_id, lock_sha256: hashCanonical(lock), corpus_sha256: lock.corpus_sha256, config_sha256: lock.config_sha256, stage: "B", purpose: plan.slots[0]!.purpose, action: "authorize", at };
      await appendFile(path.join(root, "runs/LOOKS.jsonl"), text(look));
      const rows: Attempt[] = [], slots = [];
      for (const slot of plan.slots) {
        const response = { status: 200, bodyText: JSON.stringify({ id: `MOCK-response-${slot.id}`, model: slot.lock.model_id, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: outputFor(slot) }] }], usage: { input_tokens: 10, output_tokens: 10 } }) };
        const envelope = await createProvider(adapterFor(slot.lock.provider), async () => response).complete(requestFor(slot));
        await write(path.join(dir, "artifacts", `${slot.id}.1.json`), envelope);
        await write(path.join(dir, "artifacts", `${slot.id}.1.transport.json`), { schema: "transport-record/v1", mode: "live", request_sha256: envelope.requestSha256, response, error: null });
        rows.push(settle({ id: `${plan.run_id}.${slot.id}.1`, slot_id: slot.id, cap: "stratum_b", reserved_usd: 1, actual_usd: null, state: "reserved" }, envelope, rate));
        slots.push({ id: slot.id, state: "settled", attempts: 1, pre_send_retries: 0, rate_limit_backoffs: 0, envelope });
      }
      global = [...global, ...rows]; await write(path.join(runtime, "ledger.json"), global);
      const author = plan.slots[0]!.purpose === "author";
      const state = SnapshotSchema.parse({ schema: "run-state/v1", run_id: plan.run_id, lock_sha256: hashCanonical(lock), plan_sha256: hashCanonical(plan), execution: { mode: "live", admission_sha256: corpus.admission_sha256, appointment_sha256: h, stage_grant_sha256: lock.stage_grant_sha256, look_sha256: hashCanonical(look), plan_input_path: `vault/plans/${plan.run_id}.json`, ...snapshot }, status: author ? "collecting" : "terminal_complete", stop_reason: null, slots, ledger: rows, events: author ? [] : [{ at, slot_id: null, state: "terminal_complete", reason: null }] });
      await write(path.join(dir, "slots.json"), state); return { dir, state };
    };
    const authorPlan = RunPlanSchema.parse({ schema: "run-plan/v1", run_id: "MOCK-author", slots: (["A", "B"] as const).map((arm) => ({ id: `author-${arm}`, purpose: "author", fresh_attempt: 1, task, variant: placeholder, clean_variant: placeholder, stratum: "B", arm, author: arm, defect_ordinal: 1, repeat: 1, lock: authors[arm] })) });
    const authorBytes = { ...common, "corpus/manifest.public.json": Buffer.from(text(admittedManifest)), "vault/plans/MOCK-author.json": Buffer.from(text(authorPlan)) };
    const authorLock = locked(authorBytes), generationHash = authorLock.b_generation_sha256!;
    expect(validateBGenerationCorpus(authorLock, authorBytes, decodeUtf8)).toEqual(corpus); bindBGenerationPlan(corpus, authorPlan.slots, authorLock.corpus_sha256);
    // Outputs exist only AFTER the admitted task/corpus commitment above has been constructed.
    const generated = { A: [{ path: "main.ts", content: "export const f = (a: number, b: number) => a < b;\nexport const g = (a: number, b: number) => a > b;\n" }], B: [{ path: "main.ts", content: "export const f = (a: number, b: number) => b > a;\nexport const g = (a: number, b: number) => b < a;\n" }] };
    const source = await persistRun(authorPlan, authorLock, authorBytes, (s) => JSON.stringify({ files: generated[s.arm] }));
    let history: GenerationHistory = { schema: "b-generation-history/v1", cells: [] };
    for (const slot of authorPlan.slots) history = scheduleAuthorGeneration(history, { task_id: task.task_id, author: slot.author!, cell_sha256: authorCellHash(task, slot.author!, generationHash, slot.lock), run_id: authorPlan.run_id, slot_id: slot.id, fresh: 1 }).history;
    await write(path.join(vault, "generation-history.json"), history);
    const witness = (hash: string, name: string, expectation: "passes" | "fails") => WitnessReceiptSchema.parse({ schema: "witness-receipt/v1", task_id: task.task_id, change_id: "c_0000000000", target_sha256: hash, test: { path: task.hidden_tests[0]!.path, name }, expectation, runs: [1, 2].map(() => ({ status: expectation === "passes" ? "pass" : "assertion_fail", duration_ms: 1, output_sha256: h })), consistent: true, witnessed: true, sandbox_image_digest: `sha256:${h}`, probe_receipt_sha256: authorLock.inputs["probe.json"], executor: validator, recorded_at: at });
    const refs = [];
    for (const arm of ["A", "B"] as const) {
      const evidencePath = `evidence/MOCK-${arm}.json`, qualifiedPath = `qualified/MOCK-${arm}.json`, auditPath = `audit/MOCK-${arm}.json`, witnessesPath = `seed/MOCK-${arm}.json`;
      await write(path.join(vault, evidencePath), { schema: "author-b-evidence/v2", task_sha256: hashCanonical(task), suite_sha256: filesSha256(task.hidden_tests), validator, appointment_sha256: h, mock: false, attempts: [{ slot_id: `author-${arm}`, source_sha256: filesSha256(generated[arm]), compile: "pass", receipts: [witness(filesSha256(generated[arm]), "*", "passes")] }] });
      expect(await runAuthorB(["--run", source.dir, "--slot", `author-${arm}`, "--recordings", evidencePath, "--out", qualifiedPath])).toBe(0);
      const q = QualifiedAuthorSchema.parse(await v.json(qualifiedPath));
      expect(q.generation_sha256).toBe(generationHash);
      await write(path.join(vault, auditPath), AuthorAuditSchema.parse({ schema: "b-author-audit/v1", task_sha256: hashCanonical(task), author: arm, qualified_sha256: hashCanonical(q), generation_sha256: generationHash, source_sha256: q.source_sha256, suite_sha256: filesSha256(task.hidden_tests), validator, appointment_sha256: h, probe_receipt_sha256: authorLock.inputs["probe.json"], sandbox_image: authorLock.sandbox_image, blind_audit: true, accepted: true, mock: false, recorded_at: at }));
      const candidates = seedCandidates(task, q.variant, OPERATOR_NAMES, ts).slice(0, 2); expect(candidates).toHaveLength(2);
      await write(path.join(vault, witnessesPath), { schema: "b-seed-witnesses/v2", task_sha256: hashCanonical(task), source_sha256: q.source_sha256, suite_sha256: filesSha256(task.hidden_tests), validator, appointment_sha256: h, mock: false, witnesses: candidates.map((c, i) => ({ mutation_key: c.mutation_key, compile: "pass", defect: witness(c.source_sha256, `MOCK-case-${i}`, "fails"), twin: witness(q.source_sha256, `MOCK-case-${i}`, "passes") })) });
      refs.push({ qualified_path: qualifiedPath, audit_path: auditPath, witnesses_path: witnessesPath });
    }
    await write(path.join(vault, "MOCK-seed.json"), { schema: "seed-b-evidence/v2", records: refs });
    expect(await runSeedB(["--evidence", "MOCK-seed.json"])).toBe(0);
    const pin = verifyBPin(await v.json("B-PIN.json"), generationHash);
    const records = [];
    for (const r of pin.records) {
      const q = QualifiedAuthorSchema.parse(await v.json(r.qualified_path));
      records.push({ task, variant: q.variant, clean_variant: q.variant, author: r.author });
      for (const [i, defect] of r.defects.entries()) records.push({ task, variant: VariantSchema.parse({ ...q.variant, variant_id: `MOCK-${r.author}-defect-${i}`, kind: "defect", head_files: defect.head_files, group: "G-BND", tag: "mock-boundary", severity: "high", origin: `operator:${defect.operator}`, witness_test: { path: task.hidden_tests[0]!.path, name: `MOCK-case-${i}` } }), clean_variant: q.variant, author: r.author });
    }
    const finalManifest = manifestFor(records);
    const reviewPlan = RunPlanSchema.parse({ schema: "run-plan/v1", run_id: "MOCK-review", slots: records.flatMap((record, i) => (["A", "B"] as const).map((arm) => ({ ...record, id: `review-${i}-${arm}`, purpose: "review", stratum: "B", arm, defect_ordinal: i % 3 || 1, repeat: 1, lock: reviewers[arm] }))) });
    const reviewBytes: Record<string, Buffer> = { ...common, "corpus/manifest.public.json": Buffer.from(text(finalManifest)), "vault/plans/MOCK-review.json": Buffer.from(text(reviewPlan)), "vault/B-PIN.json": await v.read("B-PIN.json") };
    for (const ref of refs) for (const file of [ref.qualified_path, ref.audit_path, ref.witnesses_path, QualifiedAuthorSchema.parse(await v.json(ref.qualified_path)).qualification_evidence_path]) reviewBytes[`vault/${file}`] = await v.read(file);
    const reviewLock = locked(reviewBytes);
    expect(reviewLock.corpus_sha256).not.toBe(authorLock.corpus_sha256); expect(reviewLock.b_generation_sha256).toBe(generationHash);
    bindBGenerationPlan(validateBGenerationCorpus(reviewLock, reviewBytes, decodeUtf8), reviewPlan.slots, reviewLock.corpus_sha256);
    const review = await persistRun(reviewPlan, reviewLock, reviewBytes, () => JSON.stringify({ verdict: "approve", findings: [] }));
    // The old mutable manifest path now holds B records. Historical author verification still uses the exact A copy.
    expect((await loadExecution(v, source.dir, false, true)).lock.corpus_sha256).toBe(authorLock.corpus_sha256);
    for (const r of pin.records) expect(await verifyBRecord(v, r, true)).toEqual(r);
    const execution = await loadExecution(v, review.dir), report = frozenReport(execution, at), reports = await v.directory(path.join(review.dir, "reports"));
    await write(path.join(reports, "results.json"), renderResultsJson(report)); await write(path.join(reports, "results.md"), renderResultsMarkdown(report));
    const release = await exclusive(path.join(review.dir, "OWNER.lock"), "MOCK-eval");
    let freeze;
    try { freeze = await freezeRun(v, execution, reports, at); } finally { await release(); }
    await expect(verifyRunFreeze(v, execution, path.join(review.dir, "FREEZE.json"), reports)).resolves.toEqual(freeze);
    const bundle = { schema: "s45-export/v1" as const, manifest_sha256: finalManifest.manifest_sha256, records: records.map(({ author: _author, ...record }) => { void _author; return record; }) };
    bindExportToRun(bundle, execution, prereg); bindExportToManifest(bundle, finalManifest);
    expect(exportRows(bundle, false).publicText).not.toContain("export const"); expect(exportRows(bundle, true).privateText).toContain("mock-boundary");
    await write(path.join(vault, "MOCK-export.json"), bundle);
    expect(await runExportS45(["--run", review.dir, "--freeze", path.join(review.dir, "FREEZE.json"), "--reports", reports, "--bundle", "MOCK-export.json", "--public-out", "MOCK-output.public.jsonl"])).toBe(0);
    expect((await v.read("MOCK-output.public.jsonl")).toString("utf8")).toBe(exportRows(bundle, false).publicText);

    const changedTask = structuredClone(reviewPlan.slots); changedTask[0]!.task.spec += " substituted";
    expect(() => bindBGenerationPlan(corpus, changedTask, reviewLock.corpus_sha256)).toThrow("substitution");
    const suiteBytes = { ...reviewBytes, "vault/generation/H99/task.json": Buffer.from(text({ ...task, hidden_tests: [{ path: "main.test.ts", content: "// MOCK substituted suite" }] })) };
    const suiteLock = { ...reviewLock, inputs: { ...reviewLock.inputs, "vault/generation/H99/task.json": sha256Hex(suiteBytes["vault/generation/H99/task.json"]) } };
    expect(() => validateBGenerationCorpus(suiteLock, suiteBytes, decodeUtf8)).toThrow("substitution");
    const changedConfig = { ...reviewLock, config_sha256: "b".repeat(64) };
    expect(() => validateBGenerationCorpus({ ...changedConfig, b_generation_sha256: bGenerationHash(changedConfig) }, reviewBytes, decodeUtf8)).toThrow();
    const changedModel = { ...reviewLock, model_lock: { ...model, authors: { ...authors, A: { ...authors.A, model_id: "MOCK-substitute" } } } };
    expect(() => validateBGenerationCorpus({ ...changedModel, b_generation_sha256: bGenerationHash(changedModel) }, reviewBytes, decodeUtf8)).toThrow();
    expect(() => verifyBPin(pin, bGenerationHash(changedModel))).toThrow();
    await write(path.join(root, "src/core/MOCK-installed.ts"), "// MOCK replaced executing code\n");
    await expect(loadExecution(v, source.dir, false, true)).rejects.toThrow("installed executable");
    await writeFile(path.join(root, "src/core/MOCK-installed.ts"), common["src/core/MOCK-installed.ts"]!);
    const snapshotFile = path.join(source.dir, "inputs", `${authorLock.corpus_sha256}.bin`);
    await write(snapshotFile, "MOCK substituted original manifest bytes");
    await expect(readExecutionInputs(v, source.dir, source.state.execution, authorLock)).rejects.toThrow("locked input drift");
    await writeFile(snapshotFile, authorBytes["corpus/manifest.public.json"]);
    await write(path.join(root, "corpus/manifest.public.json"), "MOCK changed AFTER final review lock");
    await expect(loadExecution(v, review.dir)).rejects.toThrow("locked input drift");
  }, 180000);
});
