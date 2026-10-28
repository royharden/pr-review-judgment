// All private-bearing CLIs use this one custody boundary. No content-bearing diagnostics leave it.
import { lstat, realpath, readFile, open, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { canonicalJson } from "../../src/core/defectcorpus/hashes.ts";
import { sha256Hex } from "../../src/core/hash/sha256.ts";
import { AdmissionRecordSchema, Callsign, Sha256Hex } from "../../src/core/defectcorpus/schema.ts";
import { RoyGrantFileSchema } from "../../src/core/admission/grant.ts";
import { BuilderLineageSchema, isBuilderLineage } from "../../src/core/admission/lineage.ts";
import { RunLockSchema, validateLock, qualifyDev } from "../../src/core/protocol/index.ts";
import { validateBGenerationCorpus } from "../../src/core/protocol/b.ts";
import { qualifySandbox } from "../../src/core/sandbox/probes.ts";
import type { ParsedArgs } from "./args.ts";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const CUSTODY_FLAGS = ["root", "operator-callsign", "lock", "access-log"] as const;
export const StageGrantSchema = z.strictObject({ schema: z.literal("roy-stage-grant/v1"), approved_by: z.literal("Roy"), stage: z.enum(["A", "B"]), dirty_mode_closed: z.literal(true), heldout_use_authorized: z.literal(true), config_sha256: Sha256Hex, dev_qualification: z.strictObject({ hit: z.number(), non_valid: z.number().int(), planned: z.number().int() }).optional() });
export const privateError = (command: string): string => `${command}: refused/stopped (private details withheld)\n`;
export function inside(root: string, candidate: string): boolean { const r = path.relative(root, candidate); return r !== ".." && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); }

/** Reject every symlink/junction in the candidate, including existing output ancestors. Missing tails are allowed
 * only for destinations. Recheck immediately at each access; never accept a merely named `.heldout` component. */
export async function contained(root: string, candidate: string, destination = false): Promise<string> {
  const boundary = await realpath(root); const absolute = path.resolve(candidate);
  if (!inside(boundary, absolute)) throw new Error("custody boundary");
  const parts = path.relative(boundary, absolute).split(path.sep).filter(Boolean);
  let current = boundary;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]!);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error("symlink custody boundary"); }
    catch (e) { if (!destination || (e as NodeJS.ErrnoException).code !== "ENOENT") throw e; return absolute; }
    if (!inside(boundary, await realpath(current))) throw new Error("real custody boundary");
  }
  return absolute;
}
export async function canonicalRoot(argument?: string): Promise<string> {
  const canonical = await realpath(REPO);
  if (await realpath(path.resolve(argument ?? REPO)) !== canonical) throw new Error("root must be canonical repository");
  return canonical;
}
export async function canonicalVault(root: string): Promise<string> {
  const expected = path.resolve(root, "..", ".heldout");
  if ((await lstat(expected)).isSymbolicLink() || await realpath(expected) !== expected) throw new Error("vault cannot be redirected");
  return expected;
}
export async function publicJson(root: string, file: string): Promise<unknown> { return JSON.parse(await readFile(await contained(root, path.resolve(root, file)), "utf8")); }

export async function openVault(args: ParsedArgs, command: string) {
  const root = await canonicalRoot(args.get("root")); const vault = await canonicalVault(root);
  const operator = Callsign.parse(args.get("operator-callsign"));
  const admissionBytes = await readFile(await contained(root, path.join(root, "corpus/ADMISSION.json")));
  const admission = AdmissionRecordSchema.parse(JSON.parse(admissionBytes.toString("utf8")));
  if (admission.status !== "GO" || admission.requires.length || !admission.roy_grant) throw new Error("admission not GO");
  // Admission paths are relative to the outer shell (admit's declared held-out root).
  const outer = await realpath(path.dirname(root));
  const appointmentPath = await contained(outer, path.resolve(outer, admission.roy_grant.path));
  if (inside(vault, appointmentPath)) throw new Error("appointment must be public control material");
  const appointmentBytes = await readFile(appointmentPath);
  const appointment = RoyGrantFileSchema.parse(JSON.parse(appointmentBytes.toString("utf8")));
  const lineage = BuilderLineageSchema.parse(await publicJson(root, "protocol/builder-lineage.json"));
  if (sha256Hex(appointmentBytes) !== admission.roy_grant.sha256 || appointment.steward !== admission.signers.steward || appointment.validator !== admission.signers.validator || isBuilderLineage(appointment.validator, lineage) || isBuilderLineage(appointment.steward, lineage)) throw new Error("appointment binding");
  if (operator !== appointment.validator && !isBuilderLineage(operator, lineage)) throw new Error("operator not appointed validator or builder lineage");
  const log = path.resolve(vault, args.get("access-log") ?? "access-log.jsonl");
  async function audit(action: string, file?: string): Promise<void> {
    const target = await contained(vault, log, true);
    const h = await open(target, "a");
    try { await h.writeFile(canonicalJson({ schema: "vault-access/v1", at: new Date().toISOString(), command, operator, action, path_sha256: file ? sha256Hex(path.relative(vault, file)) : null }) + "\n"); await h.sync(); } finally { await h.close(); }
  }
  async function read(file: string): Promise<Buffer> { const p = await contained(vault, path.resolve(vault, file)); await audit("read", p); return readFile(await contained(vault, p)); }
  async function json(file: string): Promise<unknown> { return JSON.parse((await read(file)).toString("utf8")); }
  async function destination(file: string): Promise<string> { const p = await contained(vault, path.resolve(vault, file), true); if (p === log) throw new Error("output aliases audit log"); await audit("write", p); return p; }
  async function directory(file: string): Promise<string> { const p = await destination(file); await mkdir(p, { recursive: true }); return contained(vault, p); }
  const lockBytes = await readFile(await contained(root, path.resolve(root, args.get("lock") ?? "RUN-LOCK.json")));
  const lock = RunLockSchema.parse(JSON.parse(lockBytes.toString("utf8")));
  await audit("begin"); // Durable before the first private read; failures refuse consumption.
  async function readKey(key: string): Promise<Buffer> {
    if (key.startsWith("vault/")) return read(key.slice(6));
    return readFile(await contained(root, path.resolve(root, key)));
  }
  // The stage authorization is public control material and must be checked before any locked private input.
  if (lock.stage_grant_path.startsWith("vault/")) throw new Error("stage grant must be public control material");
  const stageGrantBytes = await readKey(lock.stage_grant_path);
  if (lock.inputs["corpus/ADMISSION.json"] !== sha256Hex(admissionBytes) || lock.inputs[lock.stage_grant_path] !== lock.stage_grant_sha256 || sha256Hex(stageGrantBytes) !== lock.stage_grant_sha256 || !lock.inputs[lock.probe_path]) throw new Error("unlocked custody gates");
  const stageGrant = StageGrantSchema.parse(JSON.parse(stageGrantBytes.toString("utf8")));
  if (stageGrant.stage !== lock.stage || stageGrant.config_sha256 !== lock.config_sha256) throw new Error("stage scope");
  const lockedBytes: Record<string, Uint8Array> = {};
  for (const key of Object.keys(lock.inputs)) lockedBytes[key] = await readKey(key);
  validateLock(lock, lockedBytes);
  if (lock.inputs["corpus/ADMISSION.json"] !== sha256Hex(admissionBytes) || lock.inputs[lock.stage_grant_path] !== lock.stage_grant_sha256 || !lock.inputs[lock.probe_path]) throw new Error("unlocked custody gates");
  if (lock.inputs["corpus/manifest.public.json"] !== lock.corpus_sha256 || lock.inputs["protocol/preregistration.json"] !== lock.config_sha256 || !lockedBytes["protocol/model-lock.json"] || hashCanonicalJson(lockedBytes["protocol/model-lock.json"]!) !== canonicalJson(lock.model_lock)) throw new Error("custody corpus/config/model commitment");
  const generationCorpus = lock.stage === "B" ? validateBGenerationCorpus(lock, lockedBytes, (bytes) => new TextDecoder().decode(bytes)) : null;
  if (lock.stage === "B" && (!stageGrant.dev_qualification || !qualifyDev(stageGrant.dev_qualification.hit, stageGrant.dev_qualification.non_valid, stageGrant.dev_qualification.planned))) throw new Error("B estimability gate");
  if (!qualifySandbox(new TextDecoder().decode(lockedBytes[lock.probe_path]), lock.sandbox_image).qualified) throw new Error("sandbox gate");
  return { root, vault, operator, admission, appointment, lock, stageGrant, generationCorpus, read, json, readKey, destination, directory, audit,
    admissionSha256: sha256Hex(admissionBytes), appointmentSha256: sha256Hex(appointmentBytes) };
}
export type VaultSession = Awaited<ReturnType<typeof openVault>>;
function hashCanonicalJson(bytes: Uint8Array): string { return canonicalJson(JSON.parse(new TextDecoder().decode(bytes))); }
