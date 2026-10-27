// corpus-verify: execute every corpus witness in the qualified sandbox and write witness receipts (PLAN M2
// acceptance 4, K18, K19, K23). WRITTEN, NEVER RUN in Dirty Mode (DEFERRED-VALIDATION DV-16).
//
// Verify mode (runs code, only through the WitnessRunner -> Docker; there is no host-execution path):
//   tsx cli/corpus-verify.ts --split dev|heldout --corpus <dir> --image <name@sha256:64hex> --probe-receipt <file>
//       --seed <uint32> --operator-callsign <callsign> --out <dir> [--access-log <file>] [--roy-grant <file>]
//       [--lineage <file>]
//   Every planned check (src/core/sandbox/verifyplan.ts) runs twice, in two different seeded shuffled orders, each
//   run with its own seeded in-container test order. Timeout, crash and compile failure are never a witness.
//   A defect must fail its witness test twice and its clean twin must pass that test twice; clean and near-miss
//   variants must pass every hidden test file (including the guard) twice. Writes <out>/witness-receipts.jsonl and
//   <out>/verify-summary.json (<out> is created if missing; existing files are never overwritten).
//
// Receipts-only mode (runs nothing; the builder's only interface to held-out results, K19/K23):
//   tsx cli/corpus-verify.ts --receipts-only --split dev|heldout --receipts <file> --operator-callsign <callsign>
//       --access-log <file> [--admission <file>]
//   Prints only ids, hashes and statuses, and appends one line to the access log.
//
// Held-out verify mode runs BEFORE admission, in the Roy-appointed validator's session (K19). Admission GO is NOT
// required (and not read): GO needs the G3/G4 witness receipts that only this run produces (cli/admit.ts). Instead it
// requires --roy-grant (Roy's roy-grant/v1 R3 appointment; its path + sha256 go into verify-summary.json and the
// access log), --operator-callsign equal to the grant's validator and NOT in protocol/builder-lineage.json, --corpus
// and --out inside a `.heldout` directory, and --access-log. Receipts-only mode on held-out requires --admission
// pointing at an admission/v1 record with status GO and no open `requires`, plus --access-log.
// Nothing about held-out test names or contents is printed.
//
// Corpus layout read here (M5 must follow it): <corpus>/<TASK>/task.json (TaskSchema) and
// <corpus>/<TASK>/variants/*.json (VariantSchema), TASK = T## (dev) or H## (held-out).
//
// Exit: 0 every task verified; 1 some task not verified; 2 usage error or refusal; 3 sandbox unqualified (nothing
// ran); 4 stopped: a container could not be confirmed removed.
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RoyGrantFileSchema } from "../src/core/admission/grant.ts";
import type { RoyGrantFile } from "../src/core/admission/grant.ts";
import { isBuilderLineage, BuilderLineageSchema } from "../src/core/admission/lineage.ts";
import { canonicalJson } from "../src/core/defectcorpus/hashes.ts";
import { AdmissionRecordSchema, Callsign, Split, TaskId, TaskSchema, VariantSchema, WitnessReceiptSchema } from "../src/core/defectcorpus/schema.ts";
import type { Task, Variant, WitnessReceipt } from "../src/core/defectcorpus/schema.ts";
import { sha256Hex } from "../src/core/hash/sha256.ts";
import { DEFAULT_LIMITS } from "../src/core/sandbox/argv.ts";
import { qualifySandbox } from "../src/core/sandbox/probes.ts";
import { createWitnessRunner } from "../src/core/sandbox/runner.ts";
import type { DockerPort, WitnessRunResult } from "../src/core/sandbox/runner.ts";
import { buildReceipt, judgeTask, planVerification, runOrders, runSeed } from "../src/core/sandbox/verifyplan.ts";
import type { VerificationCheck } from "../src/core/sandbox/verifyplan.ts";
import { UsageError, parseArgs } from "./lib/args.ts";
import { createDockerExecutor, newContainerName } from "./lib/docker.ts";

export interface VerifyIo {
  readonly cwd: string;
  readonly docker: DockerPort | null;
  readonly newContainerName: () => string;
  readonly now: () => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const isInsideHeldout = (p: string) => path.resolve(p).split(/[\\/]/).includes(".heldout");

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

/** Receipts-only on held-out: the admission record must be GO with no open requirements. */
async function requireAdmissionGo(cwd: string, file: string | undefined): Promise<void> {
  if (file === undefined) throw new UsageError("--receipts-only --split heldout requires --admission <ADMISSION.json> with status GO");
  let json: unknown;
  try {
    json = await readJson(path.resolve(cwd, file));
  } catch {
    throw new UsageError("admission file could not be read as JSON");
  }
  const record = AdmissionRecordSchema.safeParse(json);
  if (!record.success) throw new UsageError("admission file is not a valid admission/v1 record");
  if (record.data.status !== "GO") throw new UsageError(`admission status is ${record.data.status}, not GO: held-out receipts may not be read`);
  if (record.data.requires.length > 0) throw new UsageError(`admission record still requires ${record.data.requires.join(", ")}: not a usable GO`);
}

export interface GrantRef {
  /** POSIX path relative to the working directory when inside it, else the absolute path. */
  readonly path: string;
  /** sha256 of the grant file's exact bytes (the same value cli/admit.ts records). */
  readonly sha256: string;
}

/** Held-out verify: read and validate Roy's R3 grant (roy-grant/v1). The grant holds no held-out content. */
async function readRoyGrant(cwd: string, file: string): Promise<{ grant: RoyGrantFile; ref: GrantRef }> {
  const abs = path.resolve(cwd, file);
  let bytes: Buffer;
  try {
    bytes = await readFile(abs);
  } catch {
    throw new UsageError("--roy-grant file could not be read");
  }
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new UsageError("--roy-grant file is not JSON");
  }
  const parsed = RoyGrantFileSchema.safeParse(json);
  if (!parsed.success) throw new UsageError("--roy-grant file does not match roy-grant/v1 (Roy's R3 appointment)");
  const rel = path.relative(cwd, abs);
  const inside = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  return { grant: parsed.data, ref: { path: (inside ? rel : abs).split(path.sep).join("/"), sha256: sha256Hex(bytes) } };
}

async function appendAccessLog(file: string, entry: Record<string, unknown>): Promise<void> {
  await appendFile(file, `${canonicalJson(entry)}\n`, "utf8");
}

async function loadCorpus(dir: string, split: Split): Promise<{ task: Task; variants: Variant[] }[]> {
  const out: { task: Task; variants: Variant[] }[] = [];
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && TaskId.safeParse(e.name).success);
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const taskDir = path.join(dir, e.name);
    const task = TaskSchema.parse(await readJson(path.join(taskDir, "task.json")));
    if (task.task_id !== e.name) throw new UsageError(`${e.name}/task.json has task_id ${task.task_id}`);
    if (task.split !== split) throw new UsageError(`${e.name} is split ${task.split}, not ${split}`);
    const variantFiles = (await readdir(path.join(taskDir, "variants"))).filter((f) => f.endsWith(".json")).sort();
    const variants: Variant[] = [];
    for (const f of variantFiles) variants.push(VariantSchema.parse(await readJson(path.join(taskDir, "variants", f))));
    out.push({ task, variants });
  }
  if (out.length === 0) throw new UsageError(`no tasks found in ${dir}`);
  return out;
}

function receiptLine(r: WitnessReceipt, line: string): string {
  return canonicalJson({
    task_id: r.task_id,
    change_id: r.change_id,
    target_sha256: r.target_sha256,
    receipt_sha256: sha256Hex(line),
    statuses: r.runs.map((x) => x.status),
    witnessed: r.witnessed,
  });
}

async function receiptsOnly(args: ReturnType<typeof parseArgs>, split: Split, operator: string, io: VerifyIo): Promise<number> {
  const receiptsFile = args.get("receipts");
  const accessLog = args.get("access-log");
  if (receiptsFile === undefined || accessLog === undefined) throw new UsageError("--receipts-only needs --receipts and --access-log");
  if (split === "heldout") await requireAdmissionGo(io.cwd, args.get("admission"));
  const text = await readFile(path.resolve(io.cwd, receiptsFile), "utf8");
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  let witnessed = 0;
  for (const line of lines) {
    const receipt = WitnessReceiptSchema.parse(JSON.parse(line));
    if (receipt.witnessed) witnessed++;
    io.stdout(`${receiptLine(receipt, line)}\n`);
  }
  const fileSha = sha256Hex(text);
  io.stdout(`${canonicalJson({ receipts_sha256: fileSha, count: lines.length, witnessed })}\n`);
  await appendAccessLog(path.resolve(io.cwd, accessLog), {
    at: io.now(),
    mode: "receipts-only",
    split,
    operator_callsign: operator,
    receipts_sha256: fileSha,
    count: lines.length,
  });
  return 0;
}

export async function runCorpusVerify(argv: readonly string[], io: VerifyIo): Promise<number> {
  let heldout = argv.includes("heldout") || argv.includes("--split=heldout");
  try {
    const args = parseArgs(argv, {
      values: ["split", "corpus", "image", "probe-receipt", "seed", "operator-callsign", "out", "access-log", "admission", "lineage", "receipts", "roy-grant"],
      booleans: ["receipts-only"],
    });
    const splitParsed = Split.safeParse(args.get("split"));
    if (!splitParsed.success) throw new UsageError("--split dev|heldout is required");
    const split = splitParsed.data;
    heldout = split === "heldout";
    const operator = args.get("operator-callsign") ?? "";
    if (!Callsign.safeParse(operator).success) throw new UsageError("--operator-callsign must be an AgentNamer callsign");
    if (args.has("receipts-only")) return await receiptsOnly(args, split, operator, io);

    const corpus = args.get("corpus");
    const image = args.get("image") ?? "";
    const probeReceipt = args.get("probe-receipt");
    const seedText = args.get("seed") ?? "";
    const out = args.get("out");
    const accessLog = args.get("access-log");
    if (corpus === undefined || out === undefined || probeReceipt === undefined) throw new UsageError("--corpus, --out and --probe-receipt are required");
    if (!/^[0-9]{1,10}$/.test(seedText) || Number(seedText) > 0xffffffff) throw new UsageError("--seed must be a uint32");
    const seed = Number(seedText);

    // Held-out verify runs before admission (GO depends on these receipts), so it is gated by Roy's R3 grant instead:
    // only the appointed validator, outside builder lineage, inside the vault, with an access log (K19).
    let royGrant: GrantRef | null = null;
    if (split === "heldout") {
      const grantArg = args.get("roy-grant");
      if (grantArg === undefined) throw new UsageError("held-out verify requires --roy-grant <Roy's R3 grant file> (K19: the appointed validator runs it)");
      const { grant, ref } = await readRoyGrant(io.cwd, grantArg);
      if (operator !== grant.validator) {
        throw new UsageError(`${operator} is not the validator appointed in the Roy grant: held-out corpus-verify runs only in that validator's session (K19)`);
      }
      const lineage = BuilderLineageSchema.parse(await readJson(path.resolve(io.cwd, args.get("lineage") ?? "protocol/builder-lineage.json")));
      if (isBuilderLineage(operator, lineage)) {
        throw new UsageError(`${operator} is builder lineage: held-out corpus-verify runs only in the validator's session (K19)`);
      }
      if (!isInsideHeldout(path.resolve(io.cwd, corpus)) || !isInsideHeldout(path.resolve(io.cwd, out))) {
        throw new UsageError("held-out --corpus and --out must be inside a .heldout directory");
      }
      if (accessLog === undefined) throw new UsageError("--split heldout requires --access-log");
      royGrant = ref;
    }

    const probeText = await readFile(path.resolve(io.cwd, probeReceipt), "utf8");
    const qualification = qualifySandbox(probeText, image);
    if (!qualification.qualified || io.docker === null) {
      io.stderr(`corpus-verify: sandbox unqualified; nothing ran: ${[...qualification.reasons, ...(io.docker === null ? ["no Docker"] : [])].join("; ")}\n`);
      return 3;
    }

    const loaded = await loadCorpus(path.resolve(io.cwd, corpus), split);
    const checks: VerificationCheck[] = loaded.flatMap(({ task, variants }) => planVerification(task, variants));
    const runner = createWitnessRunner({ probeReceiptText: probeText, docker: io.docker, owner: operator, newContainerName: io.newContainerName });
    const results = new Map<string, WitnessRunResult[]>();
    const [order1, order2] = runOrders(checks, seed);
    for (const [run, order] of [[1, order1], [2, order2]] as const) {
      for (const c of order) {
        const r = await runner.verify({
          sourceHash: c.sourceHash,
          testHash: c.testHash,
          imageDigest: image,
          limits: DEFAULT_LIMITS,
          sourceFiles: c.sourceFiles,
          testFiles: c.testFiles,
          selection: c.selection,
          shuffleSeed: runSeed(seed, c.checkId, run),
        });
        if (r.cause === "cleanup_unconfirmed") {
          io.stderr(`corpus-verify: STOP: a sandbox container could not be confirmed removed (run ${run}); no receipts written\n`);
          return 4;
        }
        results.set(c.checkId, [...(results.get(c.checkId) ?? []), r]);
      }
    }

    const receipts = new Map<string, WitnessReceipt>();
    const lines: string[] = [];
    for (const c of checks) {
      const [a, b] = results.get(c.checkId) ?? [];
      if (a === undefined || b === undefined) throw new Error(`internal: missing run for ${c.checkId}`);
      const receipt = buildReceipt(c, [a, b], operator, io.now());
      receipts.set(c.checkId, receipt);
      lines.push(canonicalJson(receipt));
    }
    const verdicts = loaded.map(({ task }) => judgeTask(task.task_id, checks, receipts));
    const outDir = path.resolve(io.cwd, out);
    const receiptsText = lines.map((l) => `${l}\n`).join("");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "witness-receipts.jsonl"), receiptsText, { encoding: "utf8", flag: "wx" });
    const summary = {
      schema: "corpus-verify-summary/v1",
      split,
      seed,
      operator_callsign: operator,
      // Held-out: the Roy R3 grant that authorised this validator run (path + sha256 of its exact bytes); dev: null.
      roy_grant: royGrant,
      image_digest: qualification.imageDigest,
      probe_receipt_sha256: qualification.receiptSha256,
      receipts_sha256: sha256Hex(receiptsText),
      checks: checks.length,
      witnessed: [...receipts.values()].filter((r) => r.witnessed).length,
      // Held-out summaries carry task ids and counts only, never check ids (they contain test names).
      tasks: verdicts.map((v) => ({ task_id: v.taskId, verified: v.verified, failing: split === "dev" ? v.failing : v.failing.length })),
      recorded_at: io.now(),
    };
    await writeFile(path.join(outDir, "verify-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    for (const [checkId, r] of receipts) {
      io.stdout(`${split === "dev" ? `${checkId} ` : ""}${receiptLine(r, canonicalJson(r))}\n`);
    }
    if (accessLog !== undefined) {
      await appendAccessLog(path.resolve(io.cwd, accessLog), {
        at: io.now(),
        mode: "verify",
        split,
        operator_callsign: operator,
        roy_grant: royGrant,
        receipts_sha256: summary.receipts_sha256,
        count: lines.length,
      });
    }
    return verdicts.every((v) => v.verified) ? 0 : 1;
  } catch (error) {
    // Our own refusals are safe to print. Any other error on held-out data may quote held-out content, so it is withheld.
    const message = error instanceof UsageError || !heldout ? (error as Error).message : "failed (details withheld on the held-out split)";
    io.stderr(`corpus-verify: ${message}\n`);
    return 2;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  process.exitCode = await runCorpusVerify(process.argv.slice(2), {
    cwd: process.cwd(),
    docker: createDockerExecutor(),
    newContainerName,
    now: () => new Date().toISOString(),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  });
}
