// sandbox-probe: qualify the witness sandbox (PLAN K18, M2). Runs the six probes of src/core/sandbox/probes.ts
// through Docker (five in a container under the exact witness argv, one host-side traversal check) and writes a
// sandbox-probe-receipt/v1. Until such a receipt exists with all six passing for the image digest, the WitnessRunner
// refuses to execute anything. WRITTEN, NEVER RUN in Dirty Mode (DEFERRED-VALIDATION DV-12, DV-13).
//
// Usage: tsx cli/sandbox-probe.ts --image <name@sha256:64hex> --operator-callsign <callsign> --out <receipt.json>
//        [--print-plan]   (print the probe argv plans as JSON and exit without running Docker)
// Exit: 0 all probes passed (receipt written), 1 a probe failed (receipt written, sandbox stays unqualified),
//       2 usage error / refusal.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Callsign } from "../src/core/defectcorpus/schema.ts";
import { sha256Hex } from "../src/core/hash/sha256.ts";
import { DEFAULT_LIMITS, SANDBOX_POLICY_SHA256, assertHostMountPath, buildCleanupArgv, buildDockerRunArgv, imageDigestOf } from "../src/core/sandbox/argv.ts";
import { PROBES, ProbeReceiptSchema, TRAVERSAL_CASES } from "../src/core/sandbox/probes.ts";
import type { ProbeDefinition, ProbeObservation, ProbeReceipt } from "../src/core/sandbox/probes.ts";
import type { DockerPort, DockerRawOutcome } from "../src/core/sandbox/runner.ts";
import { UsageError, parseArgs } from "./lib/args.ts";
import { createDockerExecutor, newContainerName } from "./lib/docker.ts";

export interface ProbeIo {
  readonly docker: DockerPort;
  readonly newContainerName: () => string;
  readonly now: () => string;
  readonly writeFile: (file: string, text: string) => Promise<void>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

async function observeContainerProbe(probe: ProbeDefinition, image: string, owner: string, io: ProbeIo): Promise<ProbeObservation> {
  const input = await io.docker.stage([{ path: "probe.mjs", content: probe.script ?? "" }]);
  try {
    const containerName = io.newContainerName();
    const raw: DockerRawOutcome = await io.docker.run({
      command: "docker",
      argv: buildDockerRunArgv({ image, containerName, inputDir: input.hostDir, owner, entry: ["/in/probe.mjs"] }),
      cleanupArgv: buildCleanupArgv(containerName),
      containerName,
      timeoutMs: DEFAULT_LIMITS.timeoutMs,
      outputCapBytes: DEFAULT_LIMITS.outputCapBytes,
    });
    return { raw, containerAbsent: await io.docker.absent(containerName), refusals: null };
  } finally {
    await input.dispose();
  }
}

/** Probe 6: every traversal case must be refused by the real stager or by the argv mount check, before Docker runs. */
async function observeTraversal(io: ProbeIo): Promise<ProbeObservation> {
  const refusals: { case: string; refused: boolean }[] = [];
  for (const c of TRAVERSAL_CASES) {
    let refused = false;
    if (c.kind === "stage") {
      try {
        const staged = await io.docker.stage([{ path: c.value, content: "export {};\n" }]);
        await staged.dispose();
      } catch {
        refused = true;
      }
    } else {
      try {
        assertHostMountPath(c.value);
      } catch {
        refused = true;
      }
    }
    refusals.push({ case: c.case, refused });
  }
  return { raw: null, containerAbsent: null, refusals };
}

export async function runSandboxProbe(argv: readonly string[], io: ProbeIo): Promise<number> {
  let image: string;
  let operator: string;
  let out: string;
  let printPlan: boolean;
  try {
    const args = parseArgs(argv, { values: ["image", "operator-callsign", "out"], booleans: ["print-plan"] });
    image = args.get("image") ?? "";
    operator = args.get("operator-callsign") ?? "";
    out = args.get("out") ?? "";
    printPlan = args.has("print-plan");
    imageDigestOf(image);
    if (!Callsign.safeParse(operator).success) throw new UsageError("--operator-callsign must be an AgentNamer callsign");
    if (!printPlan && out === "") throw new UsageError("--out <receipt.json> is required");
  } catch (error) {
    io.stderr(`sandbox-probe: ${(error as Error).message}\n`);
    return 2;
  }

  if (printPlan) {
    const plans = PROBES.filter((p) => p.where === "container").map((p) => ({
      id: p.id,
      argv: ["docker", ...buildDockerRunArgv({ image, containerName: "s41-prj-witness-plan0000", inputDir: "/staging/placeholder", owner: operator, entry: ["/in/probe.mjs"] })],
      expected: p.expected,
    }));
    io.stdout(`${JSON.stringify({ policy_sha256: SANDBOX_POLICY_SHA256, plans }, null, 2)}\n`);
    return 0;
  }

  const results: ProbeReceipt["probes"] = [];
  for (const probe of PROBES) {
    const started = Date.now();
    let obs: ProbeObservation;
    try {
      obs = probe.where === "host" ? await observeTraversal(io) : await observeContainerProbe(probe, image, operator, io);
    } catch {
      obs = { raw: null, containerAbsent: null, refusals: null };
    }
    const verdict = probe.evaluate(obs);
    results.push({
      id: probe.id,
      expected: probe.expected,
      observed: verdict.observed,
      passed: verdict.passed,
      duration_ms: Math.max(0, Date.now() - started),
      output_sha256: sha256Hex(obs.raw?.stdout ?? ""),
    });
    io.stdout(`${probe.id}: ${verdict.passed ? "PASS" : "FAIL"} (${verdict.observed})\n`);
  }
  const receipt = ProbeReceiptSchema.parse({
    schema: "sandbox-probe-receipt/v1",
    image,
    image_digest: imageDigestOf(image),
    policy_sha256: SANDBOX_POLICY_SHA256,
    probes: results,
    all_passed: results.every((r) => r.passed),
    executor: operator,
    recorded_at: io.now(),
  });
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  await io.writeFile(out, text);
  io.stdout(`receipt ${out} sha256 ${sha256Hex(text)} all_passed=${String(receipt.all_passed)}\n`);
  return receipt.all_passed ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  process.exitCode = await runSandboxProbe(process.argv.slice(2), {
    docker: createDockerExecutor(),
    newContainerName,
    now: () => new Date().toISOString(),
    // `wx`: a receipt is never overwritten; write a new one per qualification.
    writeFile: (file, text) => writeFile(file, text, { encoding: "utf8", flag: "wx" }),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
  });
}
