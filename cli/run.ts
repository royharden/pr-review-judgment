// Host effects only. Direct CLI has no implicit credential discovery or network transport.
import { open, readFile, writeFile, rename, mkdir, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { parseArgs } from "./lib/args.ts";
import { canonicalJson, hashCanonical } from "../src/core/defectcorpus/hashes.ts";
import { sha256Hex } from "../src/core/hash/sha256.ts";
import { reserve, settle, worstCase, type Attempt, type Budget, type Price } from "../src/core/ledger/index.ts";
import { newSlot, recover, retryDecision, transition } from "../src/core/runstate/index.ts";
import { RunPlanSchema, requestFor } from "../src/core/runstate/recordings.ts";
import { authorizeLook, lockHash, qualifyDev, requireAdmission, validateLock, type Look } from "../src/core/protocol/index.ts";
import { createProvider, type Transport } from "../src/core/providers/port.ts";
import { adapterFor } from "../src/core/providers/mock.ts";
import { presentationOrder } from "../src/core/reviewjudge/projection.ts";
import { qualifySandbox } from "../src/core/sandbox/probes.ts";
import { filesSha256 } from "../src/core/sandbox/runner.ts";
import { CUSTODY_FLAGS, openVault, contained, privateError } from "./lib/vault.ts";
import { SnapshotSchema, GenerationHistorySchema, type Snapshot, type GenerationHistory } from "../src/core/runstate/evidence.ts";
import { bGenerationHash, authorCellHash, scheduleAuthorGeneration, verifyBPin, bindBGenerationPlan } from "../src/core/protocol/b.ts";
import { verifyBRecord } from "./lib/b-evidence.ts";
import { reconcileGenerationInventory, snapshotExecutionInputs, readExecutionInputs } from "./lib/execution.ts";

export const readJson = async (p: string): Promise<unknown> => JSON.parse(await readFile(p, "utf8"));
export async function durableText(p: string, text: string): Promise<void> {
  const tmp = `${p}.tmp-${process.pid}`;
  const handle = await open(tmp, "wx");
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  await rename(tmp, p);
}
export async function durableWrite(p: string, data: unknown): Promise<void> { await durableText(p, canonicalJson(data) + "\n"); }
export async function exclusive(p: string, owner: string, recoverDeadOwner = false): Promise<() => Promise<void>> {
  let handle;
  try { handle = await open(p, "wx"); }
  catch (e) {
    if (!recoverDeadOwner || (e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    // Recovery itself is exclusive. EPERM, malformed locks, or a live PID are never evidence of death.
    const recovery = await open(`${p}.recovery`, "wx");
    try {
      const previous = z.object({ owner: z.string(), pid: z.number().int().positive() }).parse(await readJson(p));
      let dead = false;
      try { process.kill(previous.pid, 0); } catch (probe) { if ((probe as NodeJS.ErrnoException).code === "ESRCH") dead = true; else throw probe; }
      if (!dead) throw new Error("previous lock owner still exists; refusing takeover");
      await writeFile(`${p}.retired-${previous.pid}-${process.pid}.json`, canonicalJson(previous), { flag: "wx" });
      await unlink(p); handle = await open(p, "wx");
    } finally { await recovery.close(); await unlink(`${p}.recovery`); }
  }
  await handle.writeFile(canonicalJson({ owner, pid: process.pid }) + "\n"); await handle.sync();
  return async () => { await handle.close(); const held = await readJson(p) as { owner: string }; if (held.owner !== owner) throw new Error("lost run ownership"); await unlink(p); };
}
export interface RunIo { cwd: string; now(): string; stdout(text: string): void; stderr(text: string): void; transport: Transport | null; provisionTransport?: () => Transport; backoff(): Promise<void> }
const Rate = z.object({ model_id: z.string().min(1), input_usd_per_mtok: z.number().nonnegative(), output_usd_per_mtok: z.number().nonnegative(), cached_input_usd_per_mtok: z.number().nonnegative().optional(), cache_write_usd_per_mtok: z.number().nonnegative().optional(), reasoning_billed_as_output: z.literal(true) });
const Prices = z.object({ retrieved_at: z.iso.datetime(), approved_by_roy: z.string().min(1), requires: z.array(z.string()).length(0), models: z.object({ A: Rate, B: Rate }) });
const BudgetSchema = z.object({ enabled: z.literal(true), approved_usd: z.number().positive(), approved_by_roy: z.string().min(1), requires: z.array(z.string()).length(0), sub_caps: z.object({ stratum_a: z.object({ approved_usd: z.number().nonnegative() }), stratum_b: z.object({ approved_usd: z.number().nonnegative() }), preparation: z.object({ approved_usd: z.number().nonnegative() }) }) });
async function executableInputs(root: string, dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const e of await readdir(path.join(root, dir), { withFileTypes: true })) { const rel = `${dir}/${e.name}`; if (e.isSymbolicLink()) throw new Error("symlinked executable input refused"); if (e.isDirectory()) files.push(...await executableInputs(root, rel)); else if (e.isFile() && e.name.endsWith(".ts")) files.push(rel); }
  return files;
}
export async function run(argv: readonly string[], io: RunIo): Promise<number> { try { return await collectRun(argv, io); } catch { io.stderr(privateError("run")); return 2; } }
async function collectRun(argv: readonly string[], io: RunIo): Promise<number> {
  let release: (() => Promise<void>) | undefined, releaseRegistry: (() => Promise<void>) | undefined, releaseBudget: (() => Promise<void>) | undefined;
  let appLedger: Attempt[] | undefined, appLedgerPath: string | undefined;
  let snapshot: Snapshot | undefined, statePath: string | undefined;
  try {
    const args = parseArgs(argv, { values: [...CUSTODY_FLAGS, "plan", "owner"], booleans: ["resume", "live"] });
    const custody = await openVault(args, "run"); const { root, vault } = custody;
    const inputPath = (p: string) => p.startsWith("vault/") ? path.join(vault, p.slice(6)) : path.join(root, p);
    const planPath = await contained(vault, path.resolve(vault, args.get("plan") ?? "run-plan.json"));
    const planRel = path.relative(root, planPath).split(path.sep).join("/");
    const vaultPlanRel = path.relative(vault, planPath).split(path.sep).join("/");
    const planKey = planRel.startsWith("../") && !vaultPlanRel.startsWith("../") ? `vault/${vaultPlanRel}` : planRel;
    const rawLock = custody.lock;
    const refs = z.object({ inputs: z.record(z.string(), z.string()) }).parse(rawLock).inputs;
    const bytes: Record<string, Uint8Array> = {};
    for (const p of Object.keys(refs)) bytes[p] = await custody.readKey(p);
    const lock = validateLock(rawLock, bytes);
    for (const p of [...await executableInputs(root, "src/core"), ...await executableInputs(root, "cli")]) if (!lock.inputs[p]) throw new Error(`executable source is not locked: ${p}`);
    for (const p of ["protocol/model-lock.json", "protocol/prices.json", "protocol/budget.json", "protocol/preregistration.json", "protocol/diff-heuristic.rules.json", "corpus/ADMISSION.json", planKey]) if (bytes[p] === undefined) throw new Error(`required input is not locked: ${p}`);
    if (hashCanonical(JSON.parse(new TextDecoder().decode(bytes["protocol/model-lock.json"]))) !== hashCanonical(lock.model_lock)) throw new Error("model lock input differs from embedded model lock");
    requireAdmission(await readJson(path.join(root, "corpus/ADMISSION.json")));
    const budget: Budget = BudgetSchema.parse(await readJson(path.join(root, "protocol/budget.json")));
    const prices = Prices.parse(await readJson(path.join(root, "protocol/prices.json")));
    if (Date.parse(prices.retrieved_at) > Date.parse(io.now()) || Date.parse(io.now()) - Date.parse(prices.retrieved_at) > 7 * 86400000) throw new Error("prices are future dated or older than seven days");
    if (!lock.inputs[lock.stage_grant_path] || lock.inputs[lock.stage_grant_path] !== lock.stage_grant_sha256 || !lock.inputs[lock.probe_path]) throw new Error("stage grant/probe not hash locked");
    const grant = z.object({ schema: z.literal("roy-stage-grant/v1"), approved_by: z.literal("Roy"), stage: z.enum(["A", "B"]), dirty_mode_closed: z.literal(true), heldout_use_authorized: z.literal(true), config_sha256: z.string(), dev_qualification: z.object({ hit: z.number(), non_valid: z.number().int(), planned: z.number().int() }).optional() }).parse(await readJson(inputPath(lock.stage_grant_path)));
    if (grant.stage !== lock.stage || grant.config_sha256 !== lock.config_sha256) throw new Error("stage grant scope mismatch");
    if (lock.stage === "B" && (!grant.dev_qualification || !qualifyDev(grant.dev_qualification.hit, grant.dev_qualification.non_valid, grant.dev_qualification.planned))) throw new Error("B dev qualification not inside estimability band");
    if (!qualifySandbox((await custody.readKey(lock.probe_path)).toString("utf8"), lock.sandbox_image).qualified) throw new Error("sandbox unqualified");
    if (lock.inputs["corpus/manifest.public.json"] !== lock.corpus_sha256 || lock.inputs["protocol/preregistration.json"] !== lock.config_sha256) throw new Error("corpus/config commitment mismatch");
    const plan = RunPlanSchema.parse(await custody.json(planPath));
    if (new Set(plan.slots.map((s) => s.purpose)).size !== 1) throw new Error("author generation and review require separate locked plans");
    if (plan.slots.some((s) => s.task.split !== "heldout")) throw new Error("live run accepts admitted held-out plans only; use replay for public MOCK");
    if (lock.stage === "B") { if (!custody.generationCorpus) throw new Error("B generation corpus missing"); bindBGenerationPlan(custody.generationCorpus, plan.slots, lock.corpus_sha256); }
    if (lock.stage === "B" && plan.slots.some((s) => s.purpose === "review")) {
      const pinKey = planKey.startsWith("vault/") ? "vault/B-PIN.json" : "B-PIN.json";
      if (!lock.inputs[pinKey]) throw new Error("B review requires locked B-PIN.json");
      const generation = bGenerationHash(lock);
      if (lock.b_generation_sha256 !== generation) throw new Error("B generation commitment drift");
      const pin = verifyBPin(JSON.parse((await custody.readKey(pinKey)).toString("utf8")), generation);
      if (pin.mock) throw new Error("MOCK B pin refused");
      if (pin.records.length !== 20 || new Set(pin.records.map((r) => r.task_id)).size !== 10) throw new Error("B requires all ten paired held-out tasks");
      for (const r of pin.records) if (hashCanonical(await verifyBRecord(custody, r, true)) !== hashCanonical(r)) throw new Error("B provenance drift");
      for (const s of plan.slots.filter((s) => s.purpose === "review")) { const r = pin.records.find((r) => r.task_id === s.task.task_id && r.author === s.author); const head = filesSha256(s.variant.head_files); if (!r || hashCanonical(s.task) !== r.task_sha256 || filesSha256(s.clean_variant.head_files) !== r.clean_sha256 || s.variant.kind === "near_miss" || (s.variant.kind === "clean" ? head !== r.clean_sha256 : !r.defects.some((d) => d.source_sha256 === head))) throw new Error("B substitution after pin; near-miss B variants unsupported"); }
      for (const r of pin.records) if (!plan.slots.some((s) => s.purpose === "review" && s.task.task_id === r.task_id && s.author === r.author)) throw new Error("B paired pin cell omitted from plan");
    }
    if (new Set(plan.slots.map((s) => s.id)).size !== plan.slots.length) throw new Error("duplicate planned slot");
    for (const s of plan.slots) { requestFor(s); if (s.stratum !== lock.stage || prices.models[s.arm].model_id !== s.lock.model_id) throw new Error("stage/model drift"); const m = z.object({ reviewers: z.record(z.string(), z.unknown()), authors: z.record(z.string(), z.unknown()).optional() }).parse(lock.model_lock); if (hashCanonical((s.purpose === "author" ? m.authors : m.reviewers)?.[s.arm]) !== hashCanonical(s.lock)) throw new Error("slot configuration differs from model lock"); }
    const authorCounts = new Map<string, number>();
    for (const s of plan.slots.filter((s) => s.purpose === "author")) { const key = `${s.task.task_id}/${s.author}`; authorCounts.set(key, (authorCounts.get(key) ?? 0) + 1); if (authorCounts.get(key)! > 2 || !s.fresh_attempt) throw new Error("author requires at most two numbered fresh slots"); const peers = plan.slots.filter((p) => p.purpose === "author" && p.task.task_id === s.task.task_id && p.author === s.author); if (new Set(peers.map((p) => p.fresh_attempt)).size !== peers.length || !peers.some((p) => p.fresh_attempt === 1) || peers.some((p) => hashCanonical(p.task) !== hashCanonical(s.task) || hashCanonical(p.lock) !== hashCanonical(s.lock))) throw new Error("author generation cell drift"); }
    if (authorCounts.size && lock.b_generation_sha256 !== bGenerationHash(lock)) throw new Error("author generation commitment missing");
    // Only the explicitly provisioned CLI transport creates measured lineage. Injected fixture transports
    // belong to replay and cannot be re-labelled as a live run by removing a MOCK field later.
    if (!args.has("live") || io.transport !== null) throw new Error("measured collection requires explicitly provisioned live transport");
    const transport = io.provisionTransport?.();
    if (!transport) throw new Error("no explicitly provisioned provider transport; --live requires all gates and operator provisioning");
    const owner = args.get("owner"); if (!owner) throw new Error("--owner is required");
    // Roy's ceiling is app-wide, including every prior run/configuration and preparation attempt.
    // The shared lock serializes the actual mutable budget target, not unrelated source construction.
    const runtime = await contained(path.dirname(root), path.resolve(root, "..", ".runtime"), true); await mkdir(runtime, { recursive: true });
    await contained(path.dirname(root), runtime);
    releaseBudget = await exclusive(path.join(runtime, "BUDGET.lock"), owner, args.has("resume"));
    appLedgerPath = await contained(runtime, path.join(runtime, "ledger.json"), true);
    try { appLedger = z.array(z.object({ id: z.string(), slot_id: z.string(), cap: z.enum(["stratum_a", "stratum_b", "preparation"]), reserved_usd: z.number().nonnegative(), actual_usd: z.number().nonnegative().nullable(), state: z.enum(["reserved", "settled", "released", "unknown"]) })).parse(await readJson(appLedgerPath)); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      // Never reset old run liabilities when importing a workspace predating the app-wide ledger.
      for (const candidate of [path.join(root, "runs"), path.join(vault, "runs")]) {
        try { if ((await readdir(candidate)).some((n) => !["LOOKS.jsonl", "LOOKS.lock"].includes(n))) throw new Error("existing runs require app-ledger reconciliation; refusing reset"); } catch (x) { if ((x as NodeJS.ErrnoException).code !== "ENOENT") throw x; }
      }
      appLedger = [];
    }
    if (new Set(appLedger.map((a) => a.id)).size !== appLedger.length) throw new Error("duplicate app ledger attempt");
    appLedger = appLedger.map((a) => a.state === "reserved" ? { ...a, state: "unknown" } : a);
    await durableWrite(appLedgerPath, appLedger);
    if (appLedger.some((a) => a.state === "unknown")) throw new Error("app-wide unknown billing stops all run ids");
    const runs = await custody.directory("runs");
    const registryRoot = await contained(root, path.join(root, "runs"), true); await mkdir(registryRoot, { recursive: true });
    const dir = await custody.directory(path.join(runs, plan.run_id));
    release = await exclusive(path.join(dir, "OWNER.lock"), owner, args.has("resume"));
    const hash = lockHash(lock), planHash = hashCanonical(plan); statePath = path.join(dir, "slots.json");
    if (args.has("resume")) {
      snapshot = SnapshotSchema.parse(await custody.json(statePath));
      if (snapshot.execution.mode !== "live" || snapshot.execution.admission_sha256 !== custody.admissionSha256 || snapshot.execution.appointment_sha256 !== custody.appointmentSha256 || snapshot.execution.stage_grant_sha256 !== lock.stage_grant_sha256 || snapshot.execution.plan_input_path !== planKey) throw new Error("resume authorization drift");
      await readExecutionInputs(custody, dir, snapshot.execution, lock);
      if (hashCanonical(await custody.json(path.join(dir, "LOCK.json"))) !== hash || hashCanonical(await custody.json(path.join(dir, "plan.json"))) !== planHash) throw new Error("persisted resume lock/plan drift");
      const registered = (await readFile(path.join(registryRoot, "LOOKS.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Look);
      if (!registered.some((l) => l.run_id === plan.run_id && l.lock_sha256 === hash && l.action === "authorize")) throw new Error("resume has no authorized corpus look");
      if (snapshot.schema !== "run-state/v1" || snapshot.run_id !== plan.run_id || snapshot.lock_sha256 !== hash || snapshot.plan_sha256 !== planHash || snapshot.slots.length !== plan.slots.length || snapshot.slots.some((s, i) => s.id !== plan.slots[i]?.id)) throw new Error("resume lock/plan/slot mismatch");
      if (snapshot.status !== "collecting") throw new Error("terminal run cannot resume");
      for (const a of snapshot.ledger) if (!appLedger.some((global) => global.id === a.id && hashCanonical(global) === hashCanonical(a))) throw new Error("run ledger does not reconcile with app ledger");
      snapshot.slots = snapshot.slots.map((s) => recover(s));
      snapshot.ledger = snapshot.ledger.map((a) => a.state === "reserved" ? { ...a, state: "unknown" } : a);
      if (snapshot.slots.some((s) => s.state === "unknown") || snapshot.ledger.some((a) => a.state === "unknown")) throw new Error("crash left unknown billing; no resend");
    } else {
      // Serialize read/check/append across ALL run ids. Retained look survives any later initialization failure.
      releaseRegistry = await exclusive(path.join(registryRoot, "LOOKS.lock"), owner);
      const registry = path.join(registryRoot, "LOOKS.jsonl"); let looks: Look[] = [];
      try { looks = (await readFile(registry, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Look); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      const next = authorizeLook(looks, { run_id: plan.run_id, lock_sha256: hash, corpus_sha256: lock.corpus_sha256, config_sha256: lock.config_sha256, purpose: plan.slots[0]!.purpose, stage: lock.stage, action: "authorize", at: io.now() });
      const h = await open(registry, "a"); try { await h.writeFile(canonicalJson(next[next.length - 1]) + "\n"); await h.sync(); } finally { await h.close(); }
      await releaseRegistry(); releaseRegistry = undefined;
      await writeFile(path.join(dir, "LOCK.json"), canonicalJson(lock), { flag: "wx" });
      await writeFile(path.join(dir, "plan.json"), canonicalJson(plan), { flag: "wx" });
      const inputSnapshot = await snapshotExecutionInputs(custody, dir, lock, bytes);
      snapshot = { schema: "run-state/v1", run_id: plan.run_id, lock_sha256: hash, plan_sha256: planHash, execution: { mode: "live", admission_sha256: custody.admissionSha256, appointment_sha256: custody.appointmentSha256, stage_grant_sha256: lock.stage_grant_sha256, look_sha256: hashCanonical(next[next.length - 1]), plan_input_path: planKey, ...inputSnapshot }, status: "collecting", stop_reason: null, slots: plan.slots.map((s) => newSlot(s.id)), ledger: [], events: [] };
      await writeFile(statePath, canonicalJson(snapshot), { flag: "wx" });
    }
    const artifacts = await custody.directory(path.join(dir, "artifacts"));
    const historyPath = await custody.destination("generation-history.json");
    let history: GenerationHistory;
    try { history = GenerationHistorySchema.parse(await custody.json(historyPath)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT" || appLedger.length > 0) throw e; history = { schema: "b-generation-history/v1", cells: [] }; await durableWrite(historyPath, history); }
    history = await reconcileGenerationInventory(custody, history);
    if (new Set(history.cells.map((c) => `${c.task_id}/${c.author}`)).size !== history.cells.length) throw new Error("duplicate generation history cell");
    const persist = async (slotId: string | null, state: string, reason: string | null = null) => { snapshot!.events.push({ at: io.now(), slot_id: slotId, state, reason }); await durableWrite(await custody.destination(statePath!), snapshot); await durableText(await custody.destination(path.join(dir, "events.jsonl")), snapshot!.events.map(canonicalJson).join("\n") + "\n"); };
    await persist(null, "collecting");
    const shuffled = presentationOrder(plan.slots.map((s) => s.id), lock.presentation_seed, "all", 1).changeIds;
    const order = [...shuffled].sort((a, b) => (plan.slots.find((s) => s.id === a)!.fresh_attempt ?? 3) - (plan.slots.find((s) => s.id === b)!.fresh_attempt ?? 3));
    for (const id of order) {
      const index = plan.slots.findIndex((s) => s.id === id); const planned = plan.slots[index]!;
      let slot = snapshot.slots[index]!;
      if (slot.state === "settled" || slot.state === "cancelled") {
        if (planned.purpose === "author" && slot.state === "settled" && history.cells.find((c) => c.task_id === planned.task.task_id && c.author === planned.author)?.attempts.find((a) => a.slot_id === slot.id)?.qualification === "pending") { await persist(null, "awaiting_author_qualification"); return 0; }
        continue;
      }
      if (planned.purpose === "author") {
        const cellHash = authorCellHash(planned.task, planned.author!, lock.b_generation_sha256!, planned.lock);
        const scheduled = scheduleAuthorGeneration(history, { task_id: planned.task.task_id, author: planned.author!, cell_sha256: cellHash, run_id: plan.run_id, slot_id: slot.id, fresh: planned.fresh_attempt! });
        history = scheduled.history;
        if (scheduled.decision === "wait") { await persist(null, "awaiting_author_qualification"); return 0; }
        if (scheduled.decision === "cancel") { snapshot.slots[index] = transition(slot, "cancelled"); await persist(slot.id, "cancelled", "first author generation qualified"); continue; }
        await durableWrite(await custody.destination(historyPath), history);
      }
      if (slot.state === "released") slot = transition(slot, "planned");
      if (slot.state === "failed_pre_send") { if (slot.pre_send_retries >= 1) throw new Error("pre-send retry exhausted"); slot = { ...transition(transition(slot, "released"), "planned"), pre_send_retries: slot.pre_send_retries + 1 }; }
      if (slot.state !== "planned") throw new Error("slot not eligible to issue");
      for (;;) {
        // Re-read locked bytes immediately before every reservation, including retries.
        const current: Record<string, Uint8Array> = {}; for (const p of Object.keys(lock.inputs)) current[p] = await custody.readKey(p); validateLock(lock, current);
        const price: Price = prices.models[planned.arm]; const cap = lock.stage === "A" ? "stratum_a" : "stratum_b";
        const attemptId = `${plan.run_id}.${slot.id}.${slot.attempts + 1}`;
        const held = await readJson(path.join(dir, "OWNER.lock")) as { owner: string }; const budgetHeld = await readJson(path.join(runtime, "BUDGET.lock")) as { owner: string };
        if (held.owner !== owner || budgetHeld.owner !== owner) throw new Error("lost run or budget ownership");
        appLedger = reserve(budget, appLedger, { id: attemptId, slot_id: slot.id, cap, reserved_usd: worstCase(price, planned.purpose === "author" ? 8000 : 12000, planned.purpose === "author" ? 16000 : 8000) });
        await durableWrite(appLedgerPath, appLedger);
        snapshot.ledger.push(appLedger[appLedger.length - 1]!);
        slot = transition(slot, "reserved"); snapshot.slots[index] = slot; await persist(slot.id, "reserved");
        slot = transition(slot, "sent"); snapshot.slots[index] = slot; await persist(slot.id, "sent");
        const request = requestFor(planned), requestHash = sha256Hex(adapterFor(planned.lock.provider).buildRequest(request).body);
        const recordingTransport: Transport = async (http) => {
          try { const response = await transport(http); await writeFile(await custody.destination(path.join(artifacts, `${slot.id}.${slot.attempts}.transport.json`)), canonicalJson({ schema: "transport-record/v1", mode: "live", request_sha256: requestHash, response, error: null }) + "\n", { flag: "wx" }); return response; }
          catch (e) { const { TransportError } = await import("../src/core/providers/port.ts"); const phase = e instanceof TransportError ? e.phase : "unknown"; await writeFile(await custody.destination(path.join(artifacts, `${slot.id}.${slot.attempts}.transport.json`)), canonicalJson({ schema: "transport-record/v1", mode: "live", request_sha256: requestHash, response: null, error: { phase, message: (e as Error).message } }) + "\n", { flag: "wx" }); throw e; }
        };
        const envelope = await createProvider(adapterFor(planned.lock.provider), recordingTransport).complete(request);
        await writeFile(await custody.destination(path.join(artifacts, `${slot.id}.${slot.attempts}.json`)), canonicalJson(envelope) + "\n", { flag: "wx" });
        const ai = snapshot.ledger.findIndex((a) => a.id === attemptId); const settled = settle(snapshot.ledger[ai]!, envelope, price); snapshot.ledger[ai] = settled;
        appLedger[appLedger.findIndex((a) => a.id === attemptId)] = settled; await durableWrite(appLedgerPath, appLedger);
        slot = { ...slot, envelope }; const decision = retryDecision(slot, envelope);
        slot = transition(slot, settled.state === "unknown" ? "unknown" : envelope.preSendFailure ? "failed_pre_send" : "settled"); snapshot.slots[index] = slot;
        await persist(slot.id, slot.state);
        if (settled.state === "unknown" || decision === "stop") throw new Error("billing/identity/retry stop");
        if (decision === "pre_send") { slot = { ...transition(transition(slot, "released"), "planned"), pre_send_retries: slot.pre_send_retries + 1 }; }
        else if (decision === "backoff") { slot = { ...slot, rate_limit_backoffs: slot.rate_limit_backoffs + 1 }; slot = transition(slot, "planned"); snapshot.slots[index] = slot; await persist(slot.id, "backoff"); await io.backoff(); }
        else break;
      }
      if (planned.purpose === "author") { await persist(slot.id, "awaiting_author_qualification"); return 0; }
    }
    snapshot.status = "terminal_complete"; await persist(null, snapshot.status); io.stdout(`run ${plan.run_id}: terminal_complete\n`); return 0;
  } catch {
    if (appLedger && appLedgerPath) { appLedger = appLedger.map((a) => a.state === "reserved" ? { ...a, state: "unknown" } : a); await durableWrite(appLedgerPath, appLedger); }
    if (snapshot && statePath) { snapshot.status = "terminal_partial"; snapshot.slots = snapshot.slots.map((s) => ["planned", "released", "failed_pre_send"].includes(s.state) && s.attempts === 0 ? { ...s, state: "cancelled" } : ["reserved", "sent"].includes(s.state) ? { ...s, state: "unknown" } : s); snapshot.stop_reason = "execution stopped; private details withheld"; snapshot.events.push({ at: io.now(), slot_id: null, state: "terminal_partial", reason: snapshot.stop_reason }); await durableWrite(statePath, snapshot); await durableText(path.join(path.dirname(statePath), "events.jsonl"), snapshot.events.map(canonicalJson).join("\n") + "\n"); }
    io.stderr(privateError("run")); return 2;
  } finally { if (releaseRegistry) await releaseRegistry(); if (release) await release(); if (releaseBudget) await releaseBudget(); }
}
/** Only called by a future explicitly gated --live invocation. No SDK retries; ambiguous fetch failures stay unknown. */
function provisionLiveTransport(): Transport {
  return async (request) => {
    const allowed = request.auth === "bearer" ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages";
    if (request.url !== allowed) throw new Error("provider endpoint not allowlisted");
    const key = process.env[request.auth === "bearer" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"];
    if (!key) { const { TransportError } = await import("../src/core/providers/port.ts"); throw new TransportError("pre_send", "provider key is not provisioned"); }
    const headers = { ...request.headers, ...(request.auth === "bearer" ? { Authorization: `Bearer ${key}` } : { "x-api-key": key }) };
    const response = await fetch(request.url, { method: request.method, headers, body: request.body, redirect: "error", signal: AbortSignal.timeout(180000) });
    return { status: response.status, bodyText: await response.text() };
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await run(process.argv.slice(2), { cwd: process.cwd(), now: () => new Date().toISOString(), stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), transport: null, provisionTransport: provisionLiveTransport, backoff: () => new Promise((resolve) => setTimeout(resolve, 1000)) });
