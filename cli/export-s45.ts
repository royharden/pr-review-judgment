// Private-bearing export is offline, audited and serialized with collection/evaluation.
import { open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { parseArgs } from "./lib/args.ts";
import { exclusive } from "./run.ts";
import { CUSTODY_FLAGS, canonicalRoot, contained, openVault, privateError, publicJson } from "./lib/vault.ts";
import { loadExecution } from "./lib/execution.ts";
import { verifyRunFreeze, type Execution, type Freeze } from "./lib/freeze.ts";
import { TaskSchema, VariantSchema, CleanVariant, Sha256Hex, PrivateCompanionRecordSchema, PublicManifestRecordSchema } from "../src/core/defectcorpus/schema.ts";
import { toPublicRecord, variantChangeId, touchedFiles } from "../src/core/defectcorpus/projection.ts";
import { changeContentSha256, canonicalJson, hashCanonical } from "../src/core/defectcorpus/hashes.ts";
import { deriveFileIntervals } from "../src/core/defectcorpus/region.ts";
import { compareCodeUnits } from "../src/core/defectcorpus/order.ts";
import { sha256Hex } from "../src/core/hash/sha256.ts";

export const ExportBundleSchema = z.strictObject({ schema: z.literal("s45-export/v1"), manifest_sha256: Sha256Hex, records: z.array(z.strictObject({ task: TaskSchema, variant: VariantSchema, clean_variant: CleanVariant })).min(1) });
type Bundle = z.infer<typeof ExportBundleSchema>;
// This scoped local record is not cryptographic proof of the human issuer's identity.
export const ReleaseGrantSchema = z.strictObject({ schema: z.literal("roy-release-grant/v2"), approved_by: z.literal("Roy"), decision: z.literal("release"), scope: z.tuple([z.literal("heldout-source"), z.literal("private-labels")]), run_id: z.string(), stage: z.enum(["A", "B"]), freeze_sha256: Sha256Hex, lock_sha256: Sha256Hex, plan_sha256: Sha256Hex, state_sha256: Sha256Hex, corpus_sha256: Sha256Hex, slot_set_sha256: Sha256Hex, report_sha256: Sha256Hex, report_markdown_sha256: Sha256Hex, execution_sha256: Sha256Hex, manifest_sha256: Sha256Hex, export_sha256: Sha256Hex, public_sha256: Sha256Hex, private_sha256: Sha256Hex, public_out_path_sha256: Sha256Hex, private_out_path_sha256: Sha256Hex, issued_at: z.iso.datetime() });
const Manifest = z.object({ schema: z.literal("public-manifest/v1"), pending_activation: z.literal(false), manifest_sha256: Sha256Hex, records: z.array(PublicManifestRecordSchema).min(1) });
const Preregistration = z.object({ schema: z.literal("preregistration/v1"), status: z.literal("locked"), requires: z.array(z.string()).length(0), repeats: z.object({ heldout: z.number().int().positive() }), slots: z.object({ a_heldout: z.number().int().positive(), b_heldout: z.number().int().positive() }), quotas: z.object({ heldout: z.object({ tasks: z.number().int().positive() }), variants_per_task: z.array(z.enum(["clean", "near_miss", "defect"])).min(1), stratum_b: z.object({ heldout_tasks: z.number().int().positive(), clean_per_substrate: z.number().int().positive(), operator_defects_per_substrate: z.number().int().positive() }) }) });

/** Exact triples bind labels, task, source and clean counterpart to the frozen reviewed inputs. */
export function bindExportToRun(bundle: Bundle, execution: Execution, rawPreregistration: unknown): void {
  const prereg = Preregistration.parse(rawPreregistration), { plan, lock } = execution;
  const count = lock.stage === "A" ? prereg.slots.a_heldout : prereg.slots.b_heldout;
  if (plan.slots.length !== count || plan.slots.some((s) => s.purpose !== "review" || s.stratum !== lock.stage || s.task.split !== "heldout")) throw new Error("release requires complete locked review stage");
  const tasks = new Set(plan.slots.map((s) => s.task.task_id));
  if (tasks.size !== (lock.stage === "A" ? prereg.quotas.heldout.tasks : prereg.quotas.stratum_b.heldout_tasks)) throw new Error("incomplete release task inventory");
  const key = (r: Bundle["records"][number]) => hashCanonical({ task: r.task, variant: r.variant, clean_variant: r.clean_variant });
  const expected = new Set(plan.slots.map(key)), supplied = bundle.records.map(key);
  if (new Set(supplied).size !== supplied.length || supplied.length !== expected.size || supplied.some((k) => !expected.has(k))) throw new Error("export differs from reviewed source/labels");
  for (const task of tasks) for (const author of lock.stage === "A" ? [null] : ["A", "B"] as const) {
    const cell = plan.slots.filter((s) => s.task.task_id === task && s.author === author);
    const variants = new Map(cell.map((s) => [key(s), s.variant.kind]));
    const kinds = [...variants.values()].sort(compareCodeUnits);
    const wanted = lock.stage === "A" ? [...prereg.quotas.variants_per_task].sort(compareCodeUnits) : [...Array.from({ length: prereg.quotas.stratum_b.clean_per_substrate }, () => "clean"), ...Array.from({ length: prereg.quotas.stratum_b.operator_defects_per_substrate }, () => "defect")].sort(compareCodeUnits);
    if (canonicalJson(kinds) !== canonicalJson(wanted)) throw new Error("incomplete release variant inventory");
    for (const variant of variants.keys()) for (const arm of ["A", "B"] as const) for (let repeat = 1; repeat <= prereg.repeats.heldout; repeat++) if (cell.filter((s) => key(s) === variant && s.arm === arm && s.repeat === repeat).length !== 1) throw new Error("missing/duplicate release crossed slot");
  }
}

/** Hash the actual committed representation, including embargoed null source fields. */
export function bindExportToManifest(bundle: Bundle, rawManifest: unknown): void {
  const manifest = Manifest.parse(rawManifest);
  const records = [...manifest.records].sort((a, b) => compareCodeUnits(a.id, b.id));
  if (new Set(records.map((r) => r.id)).size !== records.length || records.some((r) => r.manifestHash !== manifest.manifest_sha256) || hashCanonical(records.map(({ manifestHash: _hash, ...r }) => r)) !== manifest.manifest_sha256 || bundle.manifest_sha256 !== manifest.manifest_sha256 || records.length !== bundle.records.length) throw new Error("manifest commitment mismatch");
  const projected = bundle.records.map(({ task, variant }) => {
    const committed = records.find((r) => r.id === variantChangeId(variant, task));
    if (!committed) throw new Error("record absent from committed manifest");
    return toPublicRecord(variant, task, { manifestHash: manifest.manifest_sha256, embargoStatus: committed.embargoStatus });
  }).sort((a, b) => compareCodeUnits(a.id, b.id));
  if (hashCanonical(projected) !== hashCanonical(records)) throw new Error("manifest/source identity mismatch");
}

export function exportRows(bundle: Bundle, release: boolean) {
  const publicRows = [], privateRows = [];
  for (const { task, variant, clean_variant: clean } of bundle.records) {
    if (variant.task_id !== task.task_id || clean.task_id !== task.task_id || variant.labels_authority !== task.labels_authority || clean.labels_authority !== task.labels_authority) throw new Error("export task/authority mismatch");
    publicRows.push(toPublicRecord(variant, task, { manifestHash: bundle.manifest_sha256, embargoStatus: task.split === "heldout" && !release ? "embargoed" : "open" }));
    if (release) {
      const heads = new Map(clean.head_files.map((f) => [f.path, f.content])), defect = variant.kind === "defect";
      privateRows.push(PrivateCompanionRecordSchema.parse({ id: variantChangeId(variant, task), task_id: task.task_id, variant_id: variant.variant_id, split: task.split, kind: variant.kind, group: defect ? variant.group : null, tag: defect ? variant.tag : null, severity: defect ? variant.severity : null, origin: defect ? variant.origin : null, labels_authority: variant.labels_authority, content_sha256: changeContentSha256(task.spec, touchedFiles(variant, task)), clean_twin_id: variant.kind === "clean" ? null : variantChangeId(clean, task), region_policy: "region/v1", regions: defect ? variant.head_files.flatMap((f) => deriveFileIntervals(heads.get(f.path) ?? "", f.content).map((r) => ({ path: f.path, start_line: r.startLine, end_line: r.endLine }))) : [], witness_test: defect ? variant.witness_test : null, guard_test: variant.kind === "near_miss" ? variant.guard_test : null }));
    }
  }
  if (new Set(publicRows.map((r) => r.id)).size !== publicRows.length) throw new Error("duplicate export id");
  publicRows.sort((a, b) => compareCodeUnits(a.id, b.id)); privateRows.sort((a, b) => compareCodeUnits(a.id, b.id));
  return { publicText: publicRows.map(canonicalJson).join("\n") + "\n", privateText: privateRows.map(canonicalJson).join("\n") + "\n" };
}

async function durableNew(file: string, text: string): Promise<void> { const h = await open(file, "wx"); try { await h.writeFile(text); await h.sync(); } finally { await h.close(); } }
export function bindReleaseGrant(raw: unknown, freeze: Freeze, stage: "A" | "B", manifestHash: string, exportHash: string, rows: ReturnType<typeof exportRows>, publicOut: string, privateOut: string): void {
  const grant = ReleaseGrantSchema.parse(raw);
  for (const key of ["run_id", "lock_sha256", "plan_sha256", "state_sha256", "corpus_sha256", "slot_set_sha256", "report_sha256", "report_markdown_sha256", "execution_sha256"] as const) if (grant[key] !== freeze[key]) throw new Error("release/freeze scope mismatch");
  if (grant.stage !== stage || grant.freeze_sha256 !== freeze.sha256 || grant.manifest_sha256 !== manifestHash || grant.export_sha256 !== exportHash || grant.public_sha256 !== sha256Hex(rows.publicText) || grant.private_sha256 !== sha256Hex(rows.privateText) || grant.public_out_path_sha256 !== sha256Hex(publicOut) || grant.private_out_path_sha256 !== sha256Hex(privateOut) || Date.parse(grant.issued_at) < Date.parse(freeze.frozen_at)) throw new Error("release content/destination scope mismatch");
}

export async function runExportS45(argv: readonly string[]): Promise<number> {
  let releaseOwner: (() => Promise<void>) | undefined;
  try {
    const args = parseArgs(argv, { values: [...CUSTODY_FLAGS, "bundle", "public-out", "private-out", "roy-grant", "run", "freeze", "reports"], booleans: ["release-authorized", "dev"] });
    if (!args.get("bundle") || !args.get("public-out")) throw new Error("bundle/output required");
    if (args.has("dev")) {
      if (args.has("release-authorized") || ["private-out", "roy-grant", "run", "freeze", "reports", "operator-callsign", "lock", "access-log"].some((f) => args.get(f))) throw new Error("dev has no measured/release authority");
      const root = await canonicalRoot(args.get("root"));
      const bundle = ExportBundleSchema.parse(await publicJson(root, args.get("bundle")!));
      if (bundle.records.some((r) => r.task.split !== "dev")) throw new Error("dev refuses heldout");
      const rows = exportRows(bundle, false);
      const draft = bundle.records.map(({ task, variant }) => { const { manifestHash: _hash, ...record } = toPublicRecord(variant, task, { manifestHash: bundle.manifest_sha256, embargoStatus: "open" }); return record; }).sort((a, b) => compareCodeUnits(a.id, b.id));
      if (hashCanonical(draft) !== bundle.manifest_sha256) throw new Error("dev manifest commitment mismatch");
      await durableNew(await contained(root, path.resolve(root, args.get("public-out")!), true), rows.publicText);
      return 0;
    }
    if (!args.get("run") || !args.get("freeze")) throw new Error("heldout export needs exact run/freeze");
    const v = await openVault(args, "export-s45");
    const dir = await contained(v.vault, path.resolve(v.vault, args.get("run")!));
    releaseOwner = await exclusive(await v.destination(path.join(dir, "OWNER.lock")), `export-${process.pid}`);
    const execution = await loadExecution(v, dir, true);
    const freeze = await verifyRunFreeze(v, execution, args.get("freeze")!, args.get("reports") ?? path.join(dir, "reports"));
    const bytes = await v.read(args.get("bundle")!);
    const bundle = ExportBundleSchema.parse(JSON.parse(bytes.toString("utf8")));
    bindExportToRun(bundle, execution, JSON.parse((await v.readKey("protocol/preregistration.json")).toString("utf8")));
    const manifestBytes = await v.readKey("corpus/manifest.public.json");
    if (sha256Hex(manifestBytes) !== freeze.corpus_sha256) throw new Error("frozen corpus drift");
    bindExportToManifest(bundle, JSON.parse(manifestBytes.toString("utf8")));
    const release = args.has("release-authorized"), rows = exportRows(bundle, release);
    if (!release) {
      if (args.get("private-out") || args.get("roy-grant")) throw new Error("unscoped release");
      await durableNew(await v.destination(args.get("public-out")!), rows.publicText);
    } else {
      if (!args.get("roy-grant") || !args.get("private-out")) throw new Error("release needs scoped public grant/private output");
      const publicOut = path.resolve(v.root, args.get("public-out")!), privateOut = path.resolve(v.root, args.get("private-out")!);
      if (publicOut === privateOut) throw new Error("outputs alias");
      bindReleaseGrant(await publicJson(v.root, args.get("roy-grant")!), freeze, execution.lock.stage, bundle.manifest_sha256, sha256Hex(bytes), rows, publicOut, privateOut);
      // Reject symlinks/junctions in every destination ancestor, including outside the vault.
      await contained(path.parse(publicOut).root, publicOut, true); await contained(path.parse(privateOut).root, privateOut, true);
      await v.audit("authorized-release-public", publicOut); await v.audit("authorized-release-private", privateOut);
      await durableNew(await contained(path.parse(publicOut).root, publicOut, true), rows.publicText);
      await durableNew(await contained(path.parse(privateOut).root, privateOut, true), rows.privateText);
    }
    return 0;
  } catch { process.stderr.write(privateError("export-s45")); return 2; }
  finally { if (releaseOwner) { try { await releaseOwner(); } catch { process.stderr.write(privateError("export-s45")); return 2; } } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runExportS45(process.argv.slice(2));
