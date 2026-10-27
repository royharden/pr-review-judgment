// Deferred regression source. All examples are synthetic; the execution loader is mocked and no
// fixture transport or this synthetic live-shaped state can create an admitted measured run.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TaskSchema, CleanVariant } from "../../../src/core/defectcorpus/schema.ts";
import { RunPlanSchema } from "../../../src/core/runstate/recordings.ts";
import { RunLockSchema } from "../../../src/core/protocol/index.ts";
import { SnapshotSchema, verifyFreeze } from "../../../src/core/runstate/evidence.ts";
import { hashCanonical } from "../../../src/core/defectcorpus/hashes.ts";
import { toPublicRecord } from "../../../src/core/defectcorpus/projection.ts";
import { renderResultsJson, renderResultsMarkdown } from "../../../src/core/reviewjudge/report.ts";
import { sha256Hex } from "../../../src/core/hash/sha256.ts";
import { testLock } from "../providers/helpers.ts";
import { freezeBody, freezeRun, frozenReport, verifyRunFreeze, type Execution } from "../../../cli/lib/freeze.ts";
import { bindExportToManifest, bindExportToRun, bindReleaseGrant, exportRows, runExportS45 } from "../../../cli/export-s45.ts";
import { contained, type VaultSession } from "../../../cli/lib/vault.ts";
import { exclusive } from "../../../cli/run.ts";
import { loadExecution } from "../../../cli/lib/execution.ts";
vi.mock("../../../cli/lib/execution.ts", () => ({ loadExecution: vi.fn() }));

const at = "2026-10-27T00:00:00Z", h = "a".repeat(64);
const task = TaskSchema.parse({ task_id: "H01", split: "heldout", spec: "Synthetic comparison.", intent: "PRIVATE_INTENT_SENTINEL", base_files: [{ path: "main.ts", content: "export const f = () => false;\n" }], hidden_tests: [{ path: "main.test.ts", content: "PRIVATE_TEST_SENTINEL" }], executable_lines: 1, labels_authority: "steward_heldout" });
const clean = CleanVariant.parse({ task_id: "H01", variant_id: "clean", kind: "clean", labels_authority: "steward_heldout", head_files: [{ path: "main.ts", content: "export const f = () => true;\n" }] });
const record = { task, variant: clean, clean_variant: clean };
function specimen(dir = "synthetic-run"): Execution {
  const plan = RunPlanSchema.parse({ schema: "run-plan/v1", run_id: "synthetic-run", slots: (["A", "B"] as const).map((arm) => ({ ...record, id: `review-${arm}`, purpose: "review", stratum: "A", arm, author: null, defect_ordinal: 1, repeat: 1, lock: testLock(arm === "A" ? "openai" : "anthropic") })) });
  const lock = RunLockSchema.parse({ schema: "run-lock/v1", model_lock: { status: "locked", requires: [], reviewers: { A: testLock("openai"), B: testLock("anthropic") } }, inputs: { "corpus/manifest.public.json": h }, corpus_sha256: h, config_sha256: h, presentation_seed: 4104, sandbox_qualified: true, sandbox_image: `synthetic@sha256:${h}`, probe_path: "probe.json", stage_grant_path: "grant.json", dirty_mode: false, stage: "A", stage_grant_sha256: h });
  const state = SnapshotSchema.parse({ schema: "run-state/v1", run_id: plan.run_id, lock_sha256: hashCanonical(lock), plan_sha256: hashCanonical(plan), execution: { mode: "live", admission_sha256: h, appointment_sha256: h, stage_grant_sha256: h, look_sha256: h, plan_input_path: "vault/synthetic-plan.json", input_snapshot_path: "runs/synthetic-run/INPUTS.json", input_snapshot_sha256: h }, status: "terminal_partial", stop_reason: "synthetic cancelled collection", slots: plan.slots.map((s) => ({ id: s.id, state: "cancelled", attempts: 0, pre_send_retries: 0, rate_limit_backoffs: 0, envelope: null })), ledger: [], events: [] });
  return { dir, plan, state, lock };
}
const prereg = { schema: "preregistration/v1", status: "locked", requires: [], repeats: { heldout: 1 }, slots: { a_heldout: 2, b_heldout: 12 }, quotas: { heldout: { tasks: 1 }, variants_per_task: ["clean"], stratum_b: { heldout_tasks: 1, clean_per_substrate: 1, operator_defects_per_substrate: 2 } } };
function bundleAndManifest() {
  const { manifestHash: _hash, ...draft } = toPublicRecord(clean, task, { manifestHash: h, embargoStatus: "embargoed" });
  const manifestHash = hashCanonical([draft]);
  return { bundle: { schema: "s45-export/v1" as const, manifest_sha256: manifestHash, records: [record] }, manifest: { schema: "public-manifest/v1", pending_activation: false, manifest_sha256: manifestHash, records: [{ ...draft, manifestHash }] } };
}
function receipt(execution: Execution) {
  const report = frozenReport(execution, at);
  const body = freezeBody(execution, Buffer.from(renderResultsJson(report)), Buffer.from(renderResultsMarkdown(report)), at);
  return { ...body, sha256: hashCanonical(body) };
}

const temp: string[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(async () => { vi.restoreAllMocks(); for (const dir of temp.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe("freeze/release custody (runtime deferred)", () => {
  it("what_bug_this_catches: a self-hashed receipt cannot ignore changed state, corpus, slot set or report bytes", () => {
    const e = specimen(), frozen = receipt(e), report = frozenReport(e, at);
    expect(verifyFreeze(frozen)).toEqual(frozen);
    expect(() => verifyFreeze({ ...frozen, report_sha256: "b".repeat(64) })).toThrow();
    expect(() => freezeBody(e, Buffer.from(renderResultsJson(report) + " "), Buffer.from(renderResultsMarkdown(report)), at)).toThrow("report differs");
    const changed = structuredClone(e); changed.state.stop_reason = "different";
    expect(receipt(changed).sha256).not.toBe(frozen.sha256);
    changed.state.slots[0]!.state = "sent";
    expect(() => receipt(changed)).toThrow("inventory");
    changed.state.slots[0]!.state = "cancelled"; changed.lock.corpus_sha256 = "b".repeat(64);
    expect(() => receipt(changed)).toThrow();
  });
  it("what_bug_this_catches: caller manifest hashes and pending stubs cannot authorize substituted source or labels", () => {
    const { bundle, manifest } = bundleAndManifest();
    expect(() => bindExportToManifest(bundle, manifest)).not.toThrow();
    expect(() => bindExportToManifest(bundle, { ...manifest, pending_activation: true })).toThrow();
    expect(() => bindExportToManifest({ ...bundle, manifest_sha256: h }, manifest)).toThrow();
    const substituted = structuredClone(bundle); substituted.records[0]!.variant.head_files[0]!.content += "// substituted\n";
    expect(() => bindExportToManifest(substituted, manifest)).toThrow();
    const labels = structuredClone(bundle); labels.records[0]!.task.intent += " different private labels";
    expect(() => bindExportToRun(labels, specimen(), prereg)).toThrow("reviewed");
  });
  it("what_bug_this_catches: an author-only freeze, omitted reviewer or duplicate repeat cannot release a review bundle", () => {
    const { bundle } = bundleAndManifest(), e = specimen();
    expect(() => bindExportToRun(bundle, e, prereg)).not.toThrow();
    e.plan.slots[0]!.purpose = "author";
    expect(() => bindExportToRun(bundle, e, prereg)).toThrow("review stage");
    e.plan.slots[0]!.purpose = "review"; e.plan.slots[1]!.arm = "A";
    expect(() => bindExportToRun(bundle, e, prereg)).toThrow("crossed slot");
    e.plan.slots.pop();
    expect(() => bindExportToRun(bundle, e, prereg)).toThrow("review stage");
  });
  it("what_bug_this_catches: a grant for another freeze, destination or exact output cannot open heldout contents", () => {
    const { bundle } = bundleAndManifest(), frozen = receipt(specimen()), rows = exportRows(bundle, true);
    const { schema: _schema, frozen_at: _at, sha256, ...bindings } = frozen;
    const publicOut = path.resolve("synthetic-public.jsonl"), privateOut = path.resolve("synthetic-private.jsonl");
    const grant = { schema: "roy-release-grant/v2", approved_by: "Roy", decision: "release", scope: ["heldout-source", "private-labels"], ...bindings, freeze_sha256: sha256, stage: "A", manifest_sha256: bundle.manifest_sha256, export_sha256: h, public_sha256: sha256Hex(rows.publicText), private_sha256: sha256Hex(rows.privateText), public_out_path_sha256: sha256Hex(publicOut), private_out_path_sha256: sha256Hex(privateOut), issued_at: at };
    expect(() => bindReleaseGrant(grant, frozen, "A", bundle.manifest_sha256, h, rows, publicOut, privateOut)).not.toThrow();
    expect(() => bindReleaseGrant({ ...grant, freeze_sha256: h }, frozen, "A", bundle.manifest_sha256, h, rows, publicOut, privateOut)).toThrow();
    expect(() => bindReleaseGrant(grant, frozen, "A", bundle.manifest_sha256, h, rows, publicOut + "other", privateOut)).toThrow();
    expect(() => bindReleaseGrant(grant, frozen, "A", bundle.manifest_sha256, h, { ...rows, privateText: rows.privateText + " " }, publicOut, privateOut)).toThrow();
    const embargoed = exportRows(bundle, false);
    expect(embargoed.publicText).not.toContain("export const"); expect(embargoed.privateText).toBe("\n");
  });
  it("what_bug_this_catches: freeze is exclusive, survives reread, refuses changed reports and shares owner exclusion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "s41-freeze-")); temp.push(root);
    const dir = path.join(root, "synthetic-run"), reports = path.join(dir, "reports"); await mkdir(reports, { recursive: true });
    const e = specimen(dir), report = frozenReport(e, at);
    await writeFile(path.join(reports, "results.json"), renderResultsJson(report)); await writeFile(path.join(reports, "results.md"), renderResultsMarkdown(report));
    const v = { vault: root, read: (p: string) => readFile(path.resolve(root, p)), json: async (p: string) => JSON.parse(await readFile(path.resolve(root, p), "utf8")), destination: (p: string) => contained(root, path.resolve(root, p), true) } as unknown as VaultSession;
    vi.mocked(loadExecution).mockResolvedValue(e);
    const release = await exclusive(path.join(dir, "OWNER.lock"), "synthetic-eval");
    try {
      await expect(exclusive(path.join(dir, "OWNER.lock"), "synthetic-export")).rejects.toMatchObject({ code: "EEXIST" });
      const frozen = await freezeRun(v, e, reports, at);
      await expect(verifyRunFreeze(v, e, path.join(dir, "FREEZE.json"), reports)).resolves.toEqual(frozen);
      await expect(freezeRun(v, e, reports, at)).rejects.toMatchObject({ code: "EEXIST" });
      expect(JSON.parse(await readFile(path.join(dir, "FREEZE.json"), "utf8"))).toEqual(frozen);
      await writeFile(path.join(reports, "results.md"), "changed report");
      await expect(verifyRunFreeze(v, e, path.join(dir, "FREEZE.json"), reports)).rejects.toThrow();
    } finally { await release(); }
  });
  it("what_bug_this_catches: symlinked input, run directory and output ancestor cannot cross the custody boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "s41-custody-")); temp.push(root);
    const vault = path.join(root, "vault"), outside = path.join(root, "outside"); await mkdir(vault); await mkdir(outside);
    await writeFile(path.join(outside, "secret.json"), "PRIVATE_SOURCE_SENTINEL");
    await symlink(outside, path.join(vault, "redirect"), process.platform === "win32" ? "junction" : "dir");
    await expect(contained(vault, path.join(vault, "redirect/secret.json"))).rejects.toThrow();
    await expect(contained(vault, path.join(vault, "redirect"))).rejects.toThrow();
    await expect(contained(vault, path.join(vault, "redirect/new/result.jsonl"), true)).rejects.toThrow();
  });
  it("what_bug_this_catches: parse failures never print heldout-bearing arguments or raw private diagnostics", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await runExportS45(["--PRIVATE_SOURCE_SENTINEL"])).toBe(2);
    expect(stderr).toHaveBeenCalledWith("export-s45: refused/stopped (private details withheld)\n");
    expect(stderr.mock.calls.flat().join("")).not.toContain("PRIVATE_SOURCE_SENTINEL");
  });
});
