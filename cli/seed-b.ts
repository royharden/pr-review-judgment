import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { parseArgs } from "./lib/args.ts";
import { makeBPin, bGenerationHash } from "../src/core/protocol/b.ts";
import { canonicalJson } from "../src/core/defectcorpus/hashes.ts";
import { CUSTODY_FLAGS, openVault, privateError } from "./lib/vault.ts";
import { verifyBRecord, SeedRefSchema } from "./lib/b-evidence.ts";
const Bundle = z.strictObject({ schema: z.literal("seed-b-evidence/v2"), records: z.array(SeedRefSchema).min(2) });
export async function runSeedB(argv: readonly string[]): Promise<number> {
  try {
    const args = parseArgs(argv, { values: [...CUSTODY_FLAGS, "evidence", "out"], booleans: [] }); if (!args.get("evidence")) throw new Error("--evidence required");
    const v = await openVault(args, "seed-b");
    if (v.lock.stage !== "B" || v.lock.b_generation_sha256 !== bGenerationHash(v.lock)) throw new Error("B generation commitment");
    const bundle = Bundle.parse(await v.json(args.get("evidence")!));
    const records = []; for (const r of bundle.records) records.push(await verifyBRecord(v, r));
    const pin = makeBPin(records, v.lock.b_generation_sha256);
    // Exclusive create: a pin can never be overwritten to substitute outputs after review begins.
    await writeFile(await v.destination(args.get("out") ?? "B-PIN.json"), canonicalJson(pin) + "\n", { flag: "wx" }); return 0;
  } catch { process.stderr.write(privateError("seed-b")); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runSeedB(process.argv.slice(2));
