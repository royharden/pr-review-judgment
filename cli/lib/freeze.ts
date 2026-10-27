// Offline freeze attestation. Callers hold this run's exclusive OWNER.lock through all reads/writes.
import { open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canonicalJson, hashCanonical } from "../../src/core/defectcorpus/hashes.ts";
import { sha256Hex } from "../../src/core/hash/sha256.ts";
import { FreezeSchema, verifyFreeze } from "../../src/core/runstate/evidence.ts";
import { scoreRecordings } from "../../src/core/runstate/recordings.ts";
import { aggregate, sourceOf } from "../../src/core/reviewjudge/aggregate.ts";
import { assertNoMock, renderResultsJson, renderResultsMarkdown, type ReportInput } from "../../src/core/reviewjudge/report.ts";
import { PROMPT_SHA256 } from "../../src/core/reviewjudge/contract.ts";
import { RULESET_SHA256 } from "../../src/core/reviewjudge/baselines/diffHeuristic.ts";
import { undefinedValue, value } from "../../src/core/stats/value.ts";
import { loadExecution } from "./execution.ts";
import { contained, type VaultSession } from "./vault.ts";

export type Execution = Awaited<ReturnType<typeof loadExecution>>;
export type Freeze = z.infer<typeof FreezeSchema>;

/** Rebuild the measured report from reconciled recordings; a caller's report-shaped JSON is insufficient. */
export function frozenReport(execution: Execution, generatedAt: string): ReportInput {
  const { plan, state } = execution;
  z.iso.datetime().parse(generatedAt);
  if (state.status === "collecting" || state.execution.mode !== "live") throw new Error("nonterminal/unmeasured freeze");
  assertNoMock(state);
  const measured = aggregate(scoreRecordings(plan.run_id, plan.slots.map((slot, i) => ({ slot, envelope: state.slots[i]!.envelope })).filter((r) => r.slot.purpose === "review")));
  const costs = (["A", "B"] as const).map((arm) => {
    const slots = plan.slots.filter((s) => s.arm === arm), ids = new Set(slots.map((s) => s.id));
    const attempts = state.ledger.filter((a) => ids.has(a.slot_id));
    const unknown = attempts.some((a) => a.state === "unknown" || a.state === "reserved" || a.actual_usd === null);
    return { arm, allAttemptUsd: unknown ? undefinedValue("unknown billing; reservation retained") : value(attempts.reduce((sum, a) => sum + (a.actual_usd ?? 0), 0)), source: sourceOf(slots.map((s) => ({ runId: plan.run_id, slotId: s.id, mock: false }))) };
  });
  return { meta: { reportState: state.status, generatedAt, promptSha256: PROMPT_SHA256, rulesetSha256: RULESET_SHA256, protocolSha256: state.lock_sha256 }, measured, measuredCosts: costs, mock: null };
}

/** Pure binding check also used by deferred regressions. Hashes cover exact report bytes and closed state. */
export function freezeBody(execution: Execution, json: Uint8Array, markdown: Uint8Array, generatedAt: string): Omit<Freeze, "sha256"> {
  const { plan, state, lock } = execution;
  if (state.run_id !== plan.run_id || state.lock_sha256 !== hashCanonical(lock) || state.plan_sha256 !== hashCanonical(plan) || state.slots.length !== plan.slots.length || state.slots.some((s, i) => s.id !== plan.slots[i]?.id || !["settled", "unknown", "cancelled"].includes(s.state)) || new Set(state.slots.map((s) => s.id)).size !== state.slots.length) throw new Error("freeze execution inventory drift");
  if (lock.inputs["corpus/manifest.public.json"] !== lock.corpus_sha256) throw new Error("freeze corpus commitment");
  const report = frozenReport(execution, generatedAt);
  if (sha256Hex(json) !== sha256Hex(renderResultsJson(report)) || sha256Hex(markdown) !== sha256Hex(renderResultsMarkdown(report))) throw new Error("report differs from verified execution");
  return { schema: "run-freeze/v1", run_id: plan.run_id, lock_sha256: state.lock_sha256, plan_sha256: state.plan_sha256, state_sha256: hashCanonical(state), corpus_sha256: lock.corpus_sha256, slot_set_sha256: hashCanonical(state.slots), report_sha256: sha256Hex(json), report_markdown_sha256: sha256Hex(markdown), execution_sha256: hashCanonical(state.execution), frozen_at: generatedAt };
}

async function reportBytes(v: VaultSession, reportDir: string) {
  const dir = await contained(v.vault, path.resolve(v.vault, reportDir));
  return { json: await v.read(path.join(dir, "results.json")), markdown: await v.read(path.join(dir, "results.md")) };
}

export async function freezeRun(v: VaultSession, execution: Execution, reportDir: string, generatedAt: string): Promise<Freeze> {
  // Never attest a stale in-memory state, even when called after a report write.
  const fresh = await loadExecution(v, execution.dir, true);
  if (hashCanonical({ plan: fresh.plan, state: fresh.state, lock: fresh.lock }) !== hashCanonical({ plan: execution.plan, state: execution.state, lock: execution.lock })) throw new Error("execution changed during freeze");
  const bytes = await reportBytes(v, reportDir);
  const body = freezeBody(fresh, bytes.json, bytes.markdown, generatedAt);
  const freeze = FreezeSchema.parse({ ...body, sha256: hashCanonical(body) });
  // Exclusive creation preserves any prior attestation or interrupted receipt for explicit reconciliation.
  const handle = await open(await v.destination(path.join(fresh.dir, "FREEZE.json")), "wx");
  try { await handle.writeFile(canonicalJson(freeze) + "\n"); await handle.sync(); } finally { await handle.close(); }
  return freeze;
}

export async function verifyRunFreeze(v: VaultSession, execution: Execution, freezePath: string, reportDir: string): Promise<Freeze> {
  const canonical = await contained(v.vault, path.resolve(v.vault, freezePath));
  if (canonical !== path.join(execution.dir, "FREEZE.json")) throw new Error("freeze must belong to run");
  const freeze = verifyFreeze(await v.json(canonical));
  const bytes = await reportBytes(v, reportDir);
  const body = freezeBody(execution, bytes.json, bytes.markdown, freeze.frozen_at);
  if (hashCanonical(body) !== freeze.sha256) throw new Error("frozen execution/report drift");
  return freeze;
}
