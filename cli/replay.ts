import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./lib/args.ts";
import { readJson } from "./run.ts";
import { replayBundle } from "../src/core/runstate/recordings.ts";
import { aggregate } from "../src/core/reviewjudge/aggregate.ts";
import { PROMPT_SHA256 } from "../src/core/reviewjudge/contract.ts";
import { RULESET_SHA256 } from "../src/core/reviewjudge/baselines/diffHeuristic.ts";
import { renderResultsJson, renderResultsMarkdown, type ReportInput } from "../src/core/reviewjudge/report.ts";
import { sha256Hex } from "../src/core/hash/sha256.ts";
import { canonicalRoot, contained, privateError } from "./lib/vault.ts";
import { ReplayBundleSchema } from "../src/core/runstate/recordings.ts";

export async function replay(raw: unknown): Promise<{ json: string; markdown: string; sha256: string }> {
  const { input, generatedAt } = await replayBundle(raw);
  const report: ReportInput = { meta: { reportState: "terminal_complete", generatedAt, promptSha256: PROMPT_SHA256, rulesetSha256: RULESET_SHA256, protocolSha256: null }, measured: null, mock: aggregate(input) };
  const json = renderResultsJson(report), markdown = renderResultsMarkdown(report);
  return { json, markdown, sha256: sha256Hex(json) };
}
export async function runReplay(argv: readonly string[]): Promise<number> {
  try {
    const args = parseArgs(argv, { values: ["bundle", "out"], booleans: [] });
    if (!args.get("bundle") || !args.get("out")) throw new Error("--bundle and --out required");
    const root = await canonicalRoot();
    const fixtureRoot = await contained(root, path.join(root, "fixtures"));
    const bundle = ReplayBundleSchema.parse(await readJson(await contained(fixtureRoot, path.resolve(args.get("bundle")!))));
    if (bundle.slots.some((s) => s.task.split !== "dev")) throw new Error("public replay accepts dev MOCK fixtures only");
    const result = await replay(bundle);
    const out = await contained(root, path.resolve(args.get("out")!), true); await mkdir(out, { recursive: true }); await contained(root, out);
    // MOCK output names cannot be confused with measured results.
    await writeFile(await contained(root, path.join(out, "replay.mock.json"), true), result.json, { flag: "wx" });
    await writeFile(await contained(root, path.join(out, "replay.mock.md"), true), result.markdown, { flag: "wx" });
    process.stdout.write(`MOCK replay report sha256 ${result.sha256}\n`); return 0;
  } catch { process.stderr.write(privateError("replay")); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runReplay(process.argv.slice(2));
