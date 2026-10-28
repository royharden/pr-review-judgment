// Offline author-output qualification. Never executes generated code on the host.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./lib/args.ts";
import { durableWrite, exclusive } from "./run.ts";
import { acceptAuthorBundle, AuthorQualificationFailed, authorPrompt, QualifiedAuthorSchema, QualificationEvidenceSchema, qualificationAttemptHash, authorCellHash } from "../src/core/protocol/b.ts";
import { canonicalJson, hashCanonical } from "../src/core/defectcorpus/hashes.ts";
import { filesSha256 } from "../src/core/sandbox/runner.ts";
import { CUSTODY_FLAGS, openVault, contained, privateError } from "./lib/vault.ts";
import { loadExecution, reconcileGenerationInventory } from "./lib/execution.ts";
export async function runAuthorB(argv: readonly string[]): Promise<number> {
  let release: (() => Promise<void>) | undefined;
  try {
    try {
      const args = parseArgs(argv, { values: [...CUSTODY_FLAGS, "run", "slot", "recordings", "out"], booleans: [] });
      if (!args.get("recordings") || !args.get("run") || !args.get("slot")) throw new Error("run/slot/recordings required");
      const v = await openVault(args, "author-b");
      release = await exclusive(await contained(path.dirname(v.root), path.resolve(v.root, "..", ".runtime/BUDGET.lock"), true), `author-b-${process.pid}`);
      const execution = await loadExecution(v, args.get("run")!, false);
      const selected = execution.plan.slots.find((s) => s.id === args.get("slot") && s.purpose === "author");
      if (!selected || selected.author === null || !v.lock.b_generation_sha256) throw new Error("not an author execution");
      const evidence = QualificationEvidenceSchema.parse(await v.json(args.get("recordings")!));
      if (evidence.task_sha256 !== hashCanonical(selected.task) || evidence.suite_sha256 !== filesSha256(selected.task.hidden_tests) || evidence.validator !== v.appointment.validator || evidence.appointment_sha256 !== v.appointmentSha256 || evidence.mock) throw new Error("task/suite/validator qualification drift");
      const historyPath = await v.destination("generation-history.json");
      const history = await reconcileGenerationInventory(v, await v.json(historyPath));
      const cell = history.cells.find((c) => c.task_id === selected.task.task_id && c.author === selected.author);
      if (!cell || cell.generation_sha256 !== authorCellHash(selected.task, selected.author, v.lock.b_generation_sha256, selected.lock) || cell.attempts.length !== evidence.attempts.length) throw new Error("generation history omitted or changed");
      if (cell.attempts.some((a, i) => a.run_id !== execution.plan.run_id || a.fresh !== i + 1 || a.slot_id !== evidence.attempts[i]?.slot_id) || cell.attempts.at(-1)!.slot_id !== selected.id || cell.attempts.at(-1)!.qualification !== "pending") throw new Error("generation sequence mismatch");
      if (cell.attempts.some((a, i) => a.qualification !== "pending" && a.qualification_evidence_sha256 !== qualificationAttemptHash(evidence, i))) throw new Error("earlier qualification evidence changed");
      const attempts = evidence.attempts.map((a, i) => {
        const p = execution.plan.slots.find((s) => s.id === a.slot_id), state = execution.state.slots.find((s) => s.id === a.slot_id);
        if (!p || p.purpose !== "author" || p.fresh_attempt !== i + 1 || p.author !== selected.author || hashCanonical(p.task) !== evidence.task_sha256 || hashCanonical(p.lock) !== hashCanonical(selected.lock) || !state?.envelope || state.state !== "settled") throw new Error("author execution mismatch");
        for (const r of a.receipts) {
          const test = selected.task.hidden_tests.find((f) => f.path === r.test.path);
          if (!test || r.executor !== v.appointment.validator || r.sandbox_image_digest !== v.lock.sandbox_image.split("@")[1] || r.probe_receipt_sha256 !== v.lock.inputs[v.lock.probe_path]) throw new Error("qualification witness binding");
        }
        return { attempt: i + 1, slot_id: a.slot_id, envelope: state.envelope, source_sha256: a.source_sha256, receipts: a.receipts, compile: a.compile };
      });
      const qualification = { schema: "author-b-recordings/v2", task: selected.task, author: selected.author, model: selected.lock, lock_sha256: execution.state.lock_sha256, generation_sha256: v.lock.b_generation_sha256, attempts };
      let accepted;
      try { accepted = acceptAuthorBundle(qualification); }
      catch (e) { if (!(e instanceof AuthorQualificationFailed)) throw e; cell.attempts.at(-1)!.qualification = "fail"; cell.attempts.at(-1)!.qualification_evidence_sha256 = qualificationAttemptHash(evidence, cell.attempts.length - 1); await durableWrite(historyPath, history); return 1; }
      const artifact = QualifiedAuthorSchema.parse({ schema: "b-author-qualified/v2", ...accepted, task: selected.task, model: selected.lock, generation_sha256: v.lock.b_generation_sha256, cell_sha256: cell.generation_sha256, run_id: execution.plan.run_id, plan_sha256: execution.state.plan_sha256, qualification, qualification_evidence_path: path.relative(v.vault, path.resolve(v.vault, args.get("recordings")!)).split(path.sep).join("/"), qualification_evidence_sha256: hashCanonical(evidence), attempt_bindings: attempts.map((a) => ({ slot_id: a.slot_id, envelope_sha256: hashCanonical(a.envelope), request_sha256: a.envelope.requestSha256, receipts_sha256: hashCanonical(a.receipts) })), source_sha256: filesSha256(accepted.variant.head_files), prompt_sha256: hashCanonical(authorPrompt(selected.task)) });
      const out = await v.destination(args.get("out") ?? `qualified/${selected.task.task_id}-${selected.author}.json`); await v.directory(path.dirname(out));
      await writeFile(out, canonicalJson(artifact) + "\n", { flag: "wx" });
      cell.attempts.at(-1)!.qualification = "pass"; cell.attempts.at(-1)!.qualification_evidence_sha256 = qualificationAttemptHash(evidence, cell.attempts.length - 1); cell.attempts.at(-1)!.qualified_artifact_sha256 = hashCanonical(artifact); await durableWrite(historyPath, history); return 0;
    } finally { if (release) await release(); }
  } catch { process.stderr.write(privateError("author-b")); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await runAuthorB(process.argv.slice(2));
