// corpus-verify CLI tests in a temporary root with a fake DockerPort; nothing is spawned. Written, never run in Dirty
// Mode (DEFERRED-VALIDATION DV-16). Covers the held-out flow of PLAN K19: Roy's R3 grant -> the appointed validator runs
// held-out verify WITHOUT admission GO -> admit accepts those receipts as G3/G4 -> GO -> the builder's receipts-only.
// The H99 task below is a synthetic TEST-ONLY fixture in an OS temp directory (its `.heldout` is a temp folder, not the
// project vault); it is not held-out corpus data, and `steward_heldout` is only the schema-required label for split
// heldout. All callsigns other than the builder ones are fictional test values, not appointments.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vaultPolicy from "../../cli/lib/vault.ts";
import { runAdmit } from "../../cli/admit.ts";
import { runCorpusVerify, readRoyGrant } from "../../cli/corpus-verify.ts";
import { AdmissionRecordSchema, GATE_IDS, WitnessReceiptSchema } from "../../src/core/defectcorpus/schema.ts";
import { SANDBOX_POLICY_SHA256 } from "../../src/core/sandbox/argv.ts";
import { PROBE_IDS } from "../../src/core/sandbox/probes.ts";
import type { DockerPort, StagedFile } from "../../src/core/sandbox/runner.ts";

const repoRoot = new URL("../../", import.meta.url);
const BUILDER = "0830_Claude_Opus55_Sub_M2CoderHigh";
const STEWARD = "0950_Gemini_Test_Steward";
const VALIDATOR = "0951_Grok_Test_Validator";
const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `s41-prj-witness@${DIGEST}`;
const GRANT = "protocol/grants/R3.json";

const SIGNATURE = "export function sum(a: number, b: number): number {";
const BASE = `${SIGNATURE}\n  return 0;\n}\n`;
const GOOD = `${SIGNATURE}\n  return a + b;\n}\n`;
const NEAR = `${SIGNATURE}\n  return b + a;\n}\n`;
const BAD = `${SIGNATURE}\n  return a - b;\n}\n`;

let root: string;
const out: string[] = [];
const io = (docker: DockerPort | null) => ({
  cwd: root,
  docker,
  newContainerName: () => "s41-prj-witness-0123abcd",
  now: () => "2026-10-27T12:00:00Z",
  stdout: (t: string) => void out.push(t),
  stderr: (t: string) => void out.push(t),
});
const write = (rel: string, value: unknown) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), typeof value === "string" ? value : JSON.stringify(value));
};
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const sha = (rel: string) => createHash("sha256").update(readFileSync(path.join(root, rel))).digest("hex");

/** Fake Docker: the defect head fails a named selection; everything else passes. Counts runs. */
function fakeDocker() {
  const state = { staged: null as StagedFile[] | null, runs: 0 };
  const port: DockerPort = {
    async stage(files) {
      state.staged = [...files];
      return { hostDir: "/tmp/s41-prj-stage-test", dispose: async () => void (state.staged = null) };
    },
    async run() {
      state.runs++;
      const files = state.staged ?? [];
      const source = files.find((f) => f.path === "files/src/sum.ts")?.content ?? "";
      const request = JSON.parse(files.find((f) => f.path === "request.json")?.content ?? "{}") as { selection?: { kind?: string } };
      const status = source === BAD && request.selection?.kind === "named" ? "assertion_fail" : "pass";
      const stdout = `${JSON.stringify({ schema: "witness-entry/v1", status })}\n`;
      return { kind: "exited", exitCode: 0, stdout, outputBytes: stdout.length, durationMs: 5, cleanupConfirmed: null };
    },
    async absent() {
      return true;
    },
  };
  return { port, state };
}

function writeGrant(file: string, overrides: Record<string, unknown> = {}): void {
  write(file, {
    schema: "roy-grant/v1",
    item: "R3",
    granted_by: "Roy",
    steward: STEWARD,
    validator: VALIDATOR,
    developer_overlap_disclosed: false,
    granted_at: "2026-10-27T11:00:00Z",
    statement: "Test fixture statement.",
    ...overrides,
  });
}

const verifyArgs = (overrides: Record<string, string | null> = {}) =>
  Object.entries({
    split: "heldout",
    corpus: ".heldout/corpus",
    image: IMAGE,
    "probe-receipt": "runs/probe-receipt.json",
    seed: "4101",
    "operator-callsign": VALIDATOR,
    out: ".heldout/runs/verify-1",
    "access-log": ".heldout/access.log.jsonl",
    "roy-grant": GRANT,
    ...overrides,
  }).flatMap(([k, v]) => (v === null ? [] : [`--${k}`, v]));

const RECEIPTS = ".heldout/runs/verify-1/witness-receipts.jsonl";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "s41-verify-test-"));
  vi.spyOn(vaultPolicy, "canonicalRoot").mockImplementation(async () => root);
  vi.spyOn(vaultPolicy, "canonicalVault").mockImplementation(async () => path.join(root, ".heldout"));
  out.length = 0;
  write("protocol/builder-lineage.json", readFileSync(new URL("protocol/builder-lineage.json", repoRoot), "utf8"));
  writeGrant(GRANT);
  write("runs/probe-receipt.json", {
    schema: "sandbox-probe-receipt/v1",
    image: IMAGE,
    image_digest: DIGEST,
    policy_sha256: SANDBOX_POLICY_SHA256,
    probes: PROBE_IDS.map((id) => ({ id, expected: "expected outcome", observed: "observed", passed: true, duration_ms: 1, output_sha256: "0".repeat(64) })),
    all_passed: true,
    executor: VALIDATOR,
    recorded_at: "2026-10-27T11:10:00Z",
  });
  const common = { task_id: "H99", labels_authority: "steward_heldout" };
  write(".heldout/corpus/H99/task.json", {
    task_id: "H99",
    split: "heldout",
    spec: "sum(a, b) returns a + b.",
    intent: "Implement sum.",
    base_files: [{ path: "src/sum.ts", content: BASE }],
    hidden_tests: [{ path: "hidden/sum.test.ts", content: "// synthetic test-only fixture\n" }],
    executable_lines: 3,
    labels_authority: "steward_heldout",
  });
  write(".heldout/corpus/H99/variants/c.json", { ...common, variant_id: "H99.c", kind: "clean", head_files: [{ path: "src/sum.ts", content: GOOD }] });
  write(".heldout/corpus/H99/variants/n.json", {
    ...common,
    variant_id: "H99.n",
    kind: "near_miss",
    guard_test: { path: "hidden/sum.test.ts", name: "commutes" },
    head_files: [{ path: "src/sum.ts", content: NEAR }],
  });
  write(".heldout/corpus/H99/variants/d1.json", {
    ...common,
    variant_id: "H99.d1",
    kind: "defect",
    group: "G-ERR",
    tag: "wrong-operator",
    severity: "high",
    origin: "hand",
    witness_test: { path: "hidden/sum.test.ts", name: "adds" },
    head_files: [{ path: "src/sum.ts", content: BAD }],
  });
});

afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

describe("held-out verify (K19): Roy grant, no admission GO", () => {
  it("what_bug_this_catches: appointment loading reaches the public grant without TDZ and rejects a vault grant", async () => {
    const loaded = await readRoyGrant(root, GRANT);
    expect(loaded.grant.validator).toBe(VALIDATOR);
    expect(loaded.ref).toEqual({ path: GRANT, sha256: sha(GRANT) });
    writeGrant(".heldout/MOCK-appointment.json");
    await expect(readRoyGrant(root, ".heldout/MOCK-appointment.json")).rejects.toThrow("public control material");
  });
  it("runs in the appointed validator's session without any admission record and records the grant", async () => {
    const { port, state } = fakeDocker();
    const code = await runCorpusVerify(verifyArgs(), io(port));
    expect(code).toBe(0);
    // 4 checks (clean suite, clean witness, defect witness, near-miss suite), each run twice.
    expect(state.runs).toBe(8);
    const lines = read(RECEIPTS).split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      const r = WitnessReceiptSchema.parse(JSON.parse(line));
      expect(r.executor).toBe(VALIDATOR);
      expect(r.witnessed).toBe(true);
      expect(r.task_id).toBe("H99");
    }
    const grantRef = { path: GRANT, sha256: sha(GRANT) };
    const summary = JSON.parse(read(".heldout/runs/verify-1/verify-summary.json")) as Record<string, unknown>;
    expect(summary["roy_grant"]).toEqual(grantRef);
    expect(summary["operator_callsign"]).toBe(VALIDATOR);
    expect(summary["tasks"]).toEqual([{ task_id: "H99", verified: true, failing: 0 }]);
    const log = read(".heldout/access.log.jsonl").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(log[0]).toMatchObject({ mode: "verify-begin", split: "heldout", operator_callsign: VALIDATOR, roy_grant: grantRef });
    expect(log.at(-1)).toMatchObject({ mode: "verify", split: "heldout", operator_callsign: VALIDATOR, roy_grant: grantRef });
    expect(log.some((entry) => entry["mode"] === "verify-read")).toBe(true);
    // Held-out test names never reach the console.
    const printed = out.join("");
    expect(printed).not.toContain("adds");
    expect(printed).not.toContain("commutes");
  });

  it("refuses (exit 2, nothing runs) without a grant, for a non-appointed or builder operator, outside the vault, without an access log", async () => {
    writeGrant("protocol/grants/R3-builder.json", { validator: BUILDER });
    writeGrant("protocol/grants/R3-bad.json", { granted_by: "Builder" });
    const refusals: Record<string, string | null>[] = [
      { "roy-grant": null },
      { "roy-grant": "protocol/grants/missing.json" },
      { "roy-grant": "protocol/grants/R3-bad.json" },
      { "operator-callsign": STEWARD },
      { "operator-callsign": BUILDER },
      { "operator-callsign": BUILDER, "roy-grant": "protocol/grants/R3-builder.json" },
      { corpus: "corpus-outside" },
      { out: "runs/verify-outside" },
      { "access-log": null },
    ];
    for (const overrides of refusals) {
      const { port, state } = fakeDocker();
      expect(await runCorpusVerify(verifyArgs(overrides), io(port))).toBe(2);
      expect(state.runs).toBe(0);
    }
    expect(out.join("")).toContain("details withheld");
  });
});

describe("grant -> validator verify -> admit GO -> builder receipts-only", () => {
  it("admit accepts the validator's receipts as G3/G4 and receipts-only then needs that GO with no open requires", async () => {
    expect(await runCorpusVerify(verifyArgs(), io(fakeDocker().port))).toBe(0);

    // Before admission, the builder's receipts-only on held-out is refused.
    const receiptsOnly = (admission: string | null) =>
      runCorpusVerify(
        [
          "--receipts-only",
          "--split", "heldout",
          "--receipts", RECEIPTS,
          "--operator-callsign", BUILDER,
          "--access-log", ".heldout/access.log.jsonl",
          ...(admission === null ? [] : ["--admission", admission]),
        ],
        io(null),
      );
    expect(await receiptsOnly(null)).toBe(2);
    write("corpus/ADMISSION.json", readFileSync(new URL("corpus/ADMISSION.json", repoRoot), "utf8"));
    expect(await receiptsOnly("corpus/ADMISSION.json")).toBe(2);

    for (const g of GATE_IDS.filter((id) => id !== "G3" && id !== "G4")) write(`.heldout/evidence/${g}.json`, { gate: g });
    const gates = GATE_IDS.flatMap((g) => ["--gate", `${g}=${g === "G3" || g === "G4" ? RECEIPTS : `.heldout/evidence/${g}.json`}`]);
    const admitIo = { cwd: root, now: () => "2026-10-27T12:30:00Z", stdout: (t: string) => void out.push(t), stderr: (t: string) => void out.push(t) };
    expect(await runAdmit(["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", VALIDATOR, "--roy-grant", GRANT, ...gates], admitIo)).toBe(0);
    const record = AdmissionRecordSchema.parse(JSON.parse(read("corpus/ADMISSION.json")));
    expect(record.status).toBe("GO");
    expect(record.requires).toEqual([]);
    expect(record.gates.G3).toEqual({ evidence: RECEIPTS, sha256: sha(RECEIPTS) });
    expect(record.roy_grant).toEqual({ path: GRANT, sha256: sha(GRANT) });

    expect(await receiptsOnly("corpus/ADMISSION.json")).toBe(0);
    const log = read(".heldout/access.log.jsonl").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(log.some((e) => e["mode"] === "verify-begin")).toBe(true);
    expect(log.some((e) => e["mode"] === "receipts-only-begin")).toBe(true);
    expect(log.at(-1)?.["mode"]).toBe("receipts-only");

    // A GO-shaped record that still lists open requirements is not a usable GO (schema + CLI check).
    write("corpus/ADMISSION-open.json", { ...record, requires: ["R7"] });
    expect(await receiptsOnly("corpus/ADMISSION-open.json")).toBe(2);
  });
});
