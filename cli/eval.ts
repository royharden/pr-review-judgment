// Keyless, network-free evaluation. Only terminal persisted runs are reportable.
import { open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { parseArgs } from "./lib/args.ts";
import { exclusive } from "./run.ts";
import { scoreRecordings } from "../src/core/runstate/recordings.ts";
import { aggregate, sourceOf } from "../src/core/reviewjudge/aggregate.ts";
import { renderResultsJson, renderResultsMarkdown, assertNoMock, type ReportInput } from "../src/core/reviewjudge/report.ts";
import { PROMPT_SHA256 } from "../src/core/reviewjudge/contract.ts";
import { RULESET_SHA256 } from "../src/core/reviewjudge/baselines/diffHeuristic.ts";
import { hashCanonical } from "../src/core/defectcorpus/hashes.ts";
import { undefinedValue, value } from "../src/core/stats/value.ts";
import { CUSTODY_FLAGS, openVault, contained, privateError } from "./lib/vault.ts";
import { loadExecution } from "./lib/execution.ts";
import { freezeRun } from "./lib/freeze.ts";

export async function runEval(argv: readonly string[]): Promise<number> {
  let release: (() => Promise<void>) | undefined;
  try {
    const args = parseArgs(argv, { values: [...CUSTODY_FLAGS, "run", "out", "generated-at"], booleans: ["freeze"] });
    const generatedAt = z.iso.datetime().parse(args.get("generated-at"));
    if (!args.get("run")) throw new Error("--run --generated-at required");
    const v = await openVault(args, "eval"); const dir = await contained(v.vault, path.resolve(v.vault, args.get("run")!));
    release = await exclusive(await v.destination(path.join(dir, "OWNER.lock")), `eval-${process.pid}`);
    const execution = await loadExecution(v, dir, true); const { plan, state } = execution;
    assertNoMock(state);
    const records = plan.slots.map((slot, i) => ({ slot, envelope: state.slots[i]!.envelope })).filter((r) => r.slot.purpose === "review");
    const input = scoreRecordings(plan.run_id, records);
    const measured = aggregate(input);
    const costs = (["A", "B"] as const).map((arm) => {
      const slots = plan.slots.filter((s) => s.arm === arm); const ids = new Set(slots.map((s) => s.id)); const attempts = state.ledger.filter((a) => ids.has(a.slot_id));
      const unknown = attempts.some((a) => a.state === "unknown" || a.state === "reserved" || a.actual_usd === null);
      return { arm, allAttemptUsd: unknown ? undefinedValue("unknown billing; reservation retained") : value(attempts.reduce((sum, a) => sum + (a.actual_usd ?? 0), 0)), source: sourceOf(slots.map((s) => ({ runId: plan.run_id, slotId: s.id, mock: false }))) };
    });
    const report: ReportInput = { meta: { reportState: state.status as "terminal_complete" | "terminal_partial", generatedAt, promptSha256: PROMPT_SHA256, rulesetSha256: RULESET_SHA256, protocolSha256: state.lock_sha256 }, measured, measuredCosts: costs, mock: null };
    const out = await v.directory(args.get("out") ?? path.join(dir, "reports"));
    for (const [name, text] of [["results.json", renderResultsJson(report)], ["results.md", renderResultsMarkdown(report)]]) { const h = await open(await v.destination(path.join(out, name!)), "wx"); try { await h.writeFile(text!); await h.sync(); } finally { await h.close(); } }
    if (args.has("freeze")) await freezeRun(v, execution, out, generatedAt);
    return 0;
  } catch { process.stderr.write(privateError("eval")); return 2; }
  finally { try { if (release) await release(); } catch { process.stderr.write(privateError("eval")); return 2; } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runEval(process.argv.slice(2));
