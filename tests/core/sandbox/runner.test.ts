// WitnessRunner tests with a fake DockerPort; nothing is spawned. Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-18).
import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, SANDBOX_POLICY_SHA256 } from "../../../src/core/sandbox/argv.ts";
import { PROBE_IDS, qualifySandbox } from "../../../src/core/sandbox/probes.ts";
import { classifyOutcome, createWitnessRunner, filesSha256 } from "../../../src/core/sandbox/runner.ts";
import type { DockerPort, DockerRawOutcome, DockerRunPlan, StagedFile, WitnessRequest } from "../../../src/core/sandbox/runner.ts";

const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `s41-prj-witness@${DIGEST}`;

function receiptText(overrides: { digest?: string; failProbe?: boolean; policy?: string } = {}): string {
  const digest = overrides.digest ?? DIGEST;
  return JSON.stringify({
    schema: "sandbox-probe-receipt/v1",
    image: `s41-prj-witness@${digest}`,
    image_digest: digest,
    policy_sha256: overrides.policy ?? SANDBOX_POLICY_SHA256,
    probes: PROBE_IDS.map((id, i) => ({
      id,
      expected: "expected outcome",
      observed: "observed",
      passed: !(overrides.failProbe === true && i === 0),
      duration_ms: 1,
      output_sha256: "0".repeat(64),
    })),
    all_passed: overrides.failProbe !== true,
    executor: "0900_Grok_X_Validator",
    recorded_at: "2026-10-27T00:00:00Z",
  });
}

const sourceFiles = [{ path: "src/a.ts", content: "export const a = 1;\n" }];
const testFiles = [{ path: "hidden/a.test.ts", content: 'import { test } from "vitest";\ntest("x", () => {});\n' }];
const request: WitnessRequest = {
  sourceHash: filesSha256(sourceFiles),
  testHash: filesSha256(testFiles),
  imageDigest: IMAGE,
  limits: DEFAULT_LIMITS,
  sourceFiles,
  testFiles,
  selection: { kind: "named", test: { path: "hidden/a.test.ts", name: "x" } },
  shuffleSeed: 42,
};

const entryLine = (status: string) => `${JSON.stringify({ schema: "witness-entry/v1", status })}\n`;
const exited = (stdout: string, exitCode = 0): DockerRawOutcome => ({ kind: "exited", exitCode, stdout, outputBytes: stdout.length, durationMs: 5, cleanupConfirmed: null });

function fakeDocker(outcome: DockerRawOutcome) {
  const calls = { staged: [] as StagedFile[][], plans: [] as DockerRunPlan[], disposed: 0 };
  const port: DockerPort = {
    async stage(files) {
      calls.staged.push([...files]);
      return { hostDir: "/tmp/s41-prj-stage-test", dispose: async () => void calls.disposed++ };
    },
    async run(plan) {
      calls.plans.push(plan);
      return outcome;
    },
    async absent() {
      return true;
    },
  };
  return { port, calls };
}

const runner = (docker: DockerPort | null, text: string | null = receiptText()) =>
  createWitnessRunner({ probeReceiptText: text, docker, owner: "0900_Grok_X_Validator", newContainerName: () => "s41-prj-witness-0123abcd" });

describe("fail-closed qualification", () => {
  it("is sandbox_unqualified without a receipt, and Docker is never touched", async () => {
    const { port, calls } = fakeDocker(exited(entryLine("pass")));
    const r = await runner(port, null).verify(request);
    expect(r.status).toBe("sandbox_unqualified");
    expect(r.imageDigest).toBeNull();
    expect(calls.staged).toHaveLength(0);
    expect(calls.plans).toHaveLength(0);
  });

  it("is unqualified for a failing probe, another digest, another policy, malformed JSON, or no Docker", async () => {
    const { port, calls } = fakeDocker(exited(entryLine("pass")));
    for (const text of [receiptText({ failProbe: true }), receiptText({ digest: `sha256:${"b".repeat(64)}` }), receiptText({ policy: "f".repeat(64) }), "{not json"]) {
      expect((await runner(port, text).verify(request)).status).toBe("sandbox_unqualified");
    }
    expect((await runner(null).verify(request)).status).toBe("sandbox_unqualified");
    expect(calls.plans).toHaveLength(0);
    expect(qualifySandbox(receiptText(), IMAGE).qualified).toBe(true);
  });
});

describe("execution through the Docker port only", () => {
  it("stages request + files, runs the pinned docker argv, disposes, and reports pass", async () => {
    const { port, calls } = fakeDocker(exited(entryLine("pass")));
    const r = await runner(port).verify(request);
    expect(r).toMatchObject({ status: "pass", cause: null, imageDigest: DIGEST });
    expect(r.probeReceiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.staged[0]!.map((f) => f.path)).toEqual(["request.json", "files/src/a.ts", "files/hidden/a.test.ts"]);
    expect(JSON.parse(calls.staged[0]![0]!.content)).toMatchObject({ schema: "witness-request/v1", shuffle_seed: 42 });
    const plan = calls.plans[0]!;
    expect(plan.command).toBe("docker");
    expect(plan.argv[0]).toBe("run");
    expect(plan.argv).toContain(IMAGE);
    expect(plan.argv[plan.argv.indexOf("--network") + 1]).toBe("none");
    expect(plan.cleanupArgv).toEqual(["rm", "--force", "s41-prj-witness-0123abcd"]);
    expect(calls.disposed).toBe(1);
  });

  it("refuses hash mismatches and unsafe paths before staging", async () => {
    const { port, calls } = fakeDocker(exited(entryLine("pass")));
    expect(await runner(port).verify({ ...request, sourceHash: "0".repeat(64) })).toMatchObject({ status: "infra_error", cause: "hash_mismatch" });
    const bad = [{ path: "../x.ts", content: "" }];
    expect(await runner(port).verify({ ...request, sourceFiles: bad, sourceHash: filesSha256(bad) })).toMatchObject({ status: "infra_error", cause: "bad_request" });
    expect(await runner(port).verify({ ...request, limits: { timeoutMs: 60_000, outputCapBytes: 1 } })).toMatchObject({ cause: "bad_request" });
    expect(calls.staged).toHaveLength(0);
  });
});

describe("timeout, crash and compile failure are never a witness", () => {
  it("maps raw outcomes conservatively", () => {
    expect(classifyOutcome(exited(entryLine("assertion_fail")))).toEqual({ status: "assertion_fail", cause: null });
    expect(classifyOutcome(exited(entryLine("compile_error")))).toEqual({ status: "infra_error", cause: "compile_error" });
    expect(classifyOutcome(exited(entryLine("load_error")))).toEqual({ status: "infra_error", cause: "load_error" });
    expect(classifyOutcome(exited(entryLine("pass"), 1))).toEqual({ status: "infra_error", cause: "crash" });
    expect(classifyOutcome(exited("garbage", 137))).toEqual({ status: "infra_error", cause: "crash" });
    expect(classifyOutcome(exited(`${entryLine("pass")}${entryLine("pass")}`))).toEqual({ status: "infra_error", cause: "bad_report" });
    const timeout = { kind: "timeout", exitCode: null, stdout: "", outputBytes: 0, durationMs: 30_000 } as const;
    expect(classifyOutcome({ ...timeout, cleanupConfirmed: true })).toEqual({ status: "timeout", cause: null });
    expect(classifyOutcome({ ...timeout, cleanupConfirmed: false })).toEqual({ status: "infra_error", cause: "cleanup_unconfirmed" });
    expect(classifyOutcome({ ...timeout, kind: "output_cap", cleanupConfirmed: true })).toEqual({ status: "infra_error", cause: "output_cap" });
    expect(classifyOutcome({ ...timeout, kind: "spawn_error", cleanupConfirmed: null })).toEqual({ status: "infra_error", cause: "docker_unavailable" });
  });
});
