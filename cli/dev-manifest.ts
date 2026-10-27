// Source only in Dirty Mode. Later: npx tsx cli/dev-manifest.ts --root . --out corpus/manifest.dev.generated.json
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./lib/args.ts";
import { canonicalJson } from "../src/core/defectcorpus/hashes.ts";
import { buildDevManifest } from "../src/core/defectcorpus/devManifest.ts";
import { TaskSchema, VariantSchema } from "../src/core/defectcorpus/schema.ts";

function refuseVault(p: string): void { if (p.split(/[\\/]/).includes(".heldout")) throw new Error("dev manifest refuses held-out paths"); }
async function within(root: string, file: string): Promise<string> {
  const actual = await realpath(file);
  const rel = path.relative(root, actual);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("development input escaped repo root");
  refuseVault(actual);
  return actual;
}
export async function runDevManifest(argv: readonly string[]): Promise<number> {
  try {
    const args = parseArgs(argv, { values: ["root", "out"], booleans: [] });
    const root = await realpath(path.resolve(args.get("root") ?? "."));
    refuseVault(root);
    const entries = [];
    for (const id of ["T01", "T02", "T03", "T04", "T05", "T06"]) {
      const folder = path.join(root, "corpus", "dev", id);
      const task = TaskSchema.parse(JSON.parse(await readFile(await within(root, path.join(folder, "task.json")), "utf8")));
      if (task.task_id !== id) throw new Error("development directory/task mismatch");
      const variants = [];
      for (const name of ["c", "n", "d1", "d2", "d3", "d4"]) {
        const file = await within(root, path.join(folder, "variants", `${name}.json`));
        variants.push(VariantSchema.parse(JSON.parse(await readFile(file, "utf8"))));
      }
      if (variants.filter((v) => v.kind === "clean").length !== 1 || variants.filter((v) => v.kind === "near_miss").length !== 1 || variants.filter((v) => v.kind === "defect").length !== 4) throw new Error("dev variant inventory mismatch");
      entries.push({ task, variants });
    }
    const manifest = buildDevManifest(entries);
    const out = path.resolve(root, args.get("out") ?? "corpus/manifest.dev.generated.json");
    const parent = await within(root, path.dirname(out));
    refuseVault(out);
    await writeFile(path.join(parent, path.basename(out)), canonicalJson(manifest) + "\n", { flag: "wx" });
    process.stdout.write(`Development manifest: ${manifest.records.length} public records; runtime validation still pending\n`);
    return 0;
  } catch (e) { process.stderr.write(`dev-manifest: ${(e as Error).message}\n`); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runDevManifest(process.argv.slice(2));
