// admit: write corpus/ADMISSION.json (PLAN M2 acceptance 5, K21 G1-G9). WRITTEN, NEVER RUN in Dirty Mode
// (DEFERRED-VALIDATION DV-17). The decision itself is pure (src/core/admission/decide.ts); this file only gathers
// file facts: existence, sha256 of the exact bytes, and the parsed Roy grant.
//
// Usage: tsx cli/admit.ts --invoked-by <callsign> [--decision GO|NO-GO] [--gate G1=<path> ... --gate G9=<path>]
//          [--steward <callsign>] [--validator <callsign>] [--roy-grant <path>]
//          [--root <dir>] [--lineage <path>] [--out <path>] [--dry-run]
// Paths are resolved against --root (default: the current directory, i.e. the repository root) and must stay inside
// it; they are recorded root-relative. GO only if: a valid Roy R3 grant (roy-grant/v1) exists, all nine gate evidence
// files exist, G3 and G4 are the validator's held-out `witness-receipts.jsonl` from `corpus-verify --split heldout`
// (every receipt witnessed and executed by the grant's validator; the same file may be given for both), and steward +
// distinct validator are both outside builder lineage and are exactly the grant's appointees.
// `developer_overlap_disclosed` is read from the grant file. Without a valid grant the record stays
// PENDING_ROY_APPOINTMENT; otherwise any failed check makes it NO-GO. The invoker appears only as `invoked_by`.
// The held-out vault `.heldout/` lives in the OUTER shell, so a held-out admission runs with `--root ..` (the outer
// shell) plus `--lineage pr-review-judgment/protocol/builder-lineage.json --out pr-review-judgment/corpus/ADMISSION.json`.
// Receipt contents are parsed but never printed (reasons carry counts and callsigns only).
// Exit: 0 GO written; 1 NO-GO or PENDING written; 2 usage error.
import { createHash } from "node:crypto";
import { readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RECEIPT_GATES, decideAdmission } from "../src/core/admission/decide.ts";
import type { FileFact, GrantFact } from "../src/core/admission/decide.ts";
import { BuilderLineageSchema } from "../src/core/admission/lineage.ts";
import { Callsign, GATE_IDS } from "../src/core/defectcorpus/schema.ts";
import type { GateId } from "../src/core/defectcorpus/schema.ts";
import { UsageError, parseArgs } from "./lib/args.ts";

export interface AdmitIo {
  readonly cwd: string;
  readonly now: () => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const sha256OfBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Resolve `p` inside `root`; return the root-relative POSIX path and the file bytes, or null if missing/outside/not a file. */
async function fileFact(root: string, p: string): Promise<{ fact: FileFact; bytes: Buffer } | null> {
  let real: string;
  try {
    real = await realpath(path.resolve(root, p));
    if (!(await stat(real)).isFile()) return null;
  } catch {
    return null;
  }
  const rel = path.relative(root, real);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const bytes = await readFile(real);
  return { fact: { path: rel.split(path.sep).join("/"), sha256: sha256OfBytes(bytes) }, bytes };
}

export async function runAdmit(argv: readonly string[], io: AdmitIo): Promise<number> {
  try {
    const args = parseArgs(argv, {
      values: ["invoked-by", "decision", "gate", "steward", "validator", "roy-grant", "root", "lineage", "out"],
      booleans: ["dry-run"],
      repeatable: ["gate"],
    });
    const invokedBy = args.get("invoked-by") ?? "";
    if (!Callsign.safeParse(invokedBy).success) throw new UsageError("--invoked-by <callsign> is required");
    const decision = args.get("decision") ?? "GO";
    if (decision !== "GO" && decision !== "NO-GO") throw new UsageError("--decision must be GO or NO-GO");
    const root = await realpath(path.resolve(io.cwd, args.get("root") ?? "."));

    const lineagePath = path.resolve(root, args.get("lineage") ?? "protocol/builder-lineage.json");
    const lineage = BuilderLineageSchema.parse(JSON.parse(await readFile(lineagePath, "utf8")));

    const gates = Object.fromEntries(GATE_IDS.map((id) => [id, null])) as Record<GateId, FileFact | null>;
    for (const spec of args.all("gate")) {
      const m = /^(G[1-9])=(.+)$/.exec(spec);
      if (m === null) throw new UsageError(`--gate must be G<n>=<path>, got ${JSON.stringify(spec)}`);
      const id = m[1] as GateId;
      if (gates[id] !== null) throw new UsageError(`${id} given twice`);
      const found = await fileFact(root, m[2]!);
      // G3/G4 content (witness receipts) is checked by decideAdmission; the text is never printed.
      const isReceiptGate = (RECEIPT_GATES as readonly GateId[]).includes(id);
      gates[id] = found === null ? null : isReceiptGate ? { ...found.fact, text: found.bytes.toString("utf8") } : found.fact;
    }

    let grant: GrantFact | null = null;
    const grantArg = args.get("roy-grant");
    if (grantArg !== undefined) {
      const found = await fileFact(root, grantArg);
      if (found !== null) {
        let content: unknown;
        try {
          content = JSON.parse(found.bytes.toString("utf8"));
        } catch {
          content = undefined;
        }
        grant = { ...found.fact, content };
      }
    }

    const { record, reasons } = decideAdmission({
      requested: decision,
      gates,
      steward: args.get("steward") ?? null,
      validator: args.get("validator") ?? null,
      grant,
      invokedBy,
      lineage,
      now: io.now(),
    });
    const text = `${JSON.stringify(record, null, 2)}\n`;
    if (args.has("dry-run")) io.stdout(text);
    else {
      const out = path.resolve(root, args.get("out") ?? "corpus/ADMISSION.json");
      const tmp = `${out}.tmp-${process.pid}`;
      await writeFile(tmp, text, { encoding: "utf8", flag: "wx" });
      await rename(tmp, out);
      io.stdout(`admit: wrote ${record.status} to ${path.relative(root, out).split(path.sep).join("/")}\n`);
    }
    for (const r of reasons) io.stdout(`  - ${r}\n`);
    return record.status === "GO" ? 0 : 1;
  } catch (error) {
    io.stderr(`admit: ${(error as Error).message}\n`);
    return 2;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  process.exitCode = await runAdmit(process.argv.slice(2), {
    cwd: process.cwd(),
    now: () => new Date().toISOString(),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  });
}
