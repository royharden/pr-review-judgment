// admit CLI tests in a temporary root (PLAN M2 acceptance 5). Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-17).
// All callsigns below other than the builder ones are fictional test values, not appointments.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vaultPolicy from "../../cli/lib/vault.ts";
import { runAdmit } from "../../cli/admit.ts";
import { AdmissionRecordSchema, GATE_IDS } from "../../src/core/defectcorpus/schema.ts";
import type { AdmissionRecord } from "../../src/core/defectcorpus/schema.ts";

vi.mock("../../cli/lib/vault.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cli/lib/vault.ts")>();
  return { ...actual, canonicalRoot: vi.fn(), canonicalVault: vi.fn() };
});

vi.setConfig({testTimeout: 30000});
const repoRoot = new URL("../../", import.meta.url);
const BUILDER = "0830_Claude_Opus55_Sub_M2CoderHigh";
const STEWARD = "0950_Gemini_Test_Steward";
const VALIDATOR = "0951_Grok_Test_Validator";

let root: string;
const out: string[] = [];
const io = () => ({ cwd: root, now: () => "2026-10-27T12:00:00Z", stdout: (t: string) => void out.push(t), stderr: (t: string) => void out.push(t) });
const sha = (file: string) => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
const record = (): AdmissionRecord => AdmissionRecordSchema.parse(JSON.parse(readFileSync(path.join(root, "corpus/ADMISSION.json"), "utf8")));

function writeGrant(overrides: Record<string, unknown> = {}): string {
  const file = "protocol/grants/R3.json";
  writeFileSync(
    path.join(root, file),
    JSON.stringify({
      schema: "roy-grant/v1",
      item: "R3",
      granted_by: "Roy",
      steward: STEWARD,
      validator: VALIDATOR,
      developer_overlap_disclosed: false,
      granted_at: "2026-10-27T11:00:00Z",
      statement: "Test fixture statement.",
      ...overrides,
    }),
  );
  writeSummary(file);
  return file;
}

const gateArgs = (skip: string[] = []) =>
  ["--verify-summary", ".heldout/verify-summary.json", ...GATE_IDS.filter((g) => !skip.includes(g)).flatMap((g) => ["--gate", `${g}=evidence/${g}.json`])];

/** A synthetic witness-receipt/v1 line (H99 and the test name are fictional test values, not held-out content). */
function receiptLine(executor: string, expectation: "fails" | "passes", overrides: Record<string, unknown> = {}): string {
  const status = expectation === "fails" ? "assertion_fail" : "pass";
  const run = { status, duration_ms: 10, output_sha256: "2".repeat(64) };
  return JSON.stringify({
    schema: "witness-receipt/v1",
    task_id: "H99",
    change_id: "c_0123456789",
    target_sha256: "1".repeat(64),
    test: { path: "hidden/synthetic.test.ts", name: expectation === "fails" ? "synthetic case" : "*" },
    expectation,
    runs: [run, run],
    consistent: true,
    witnessed: true,
    sandbox_image_digest: `sha256:${"a".repeat(64)}`,
    probe_receipt_sha256: "3".repeat(64),
    executor,
    recorded_at: "2026-10-27T11:30:00Z",
    ...overrides,
  });
}

/** G3/G4 evidence: corpus-verify's held-out witness-receipts.jsonl shape. */
function writeReceipts(gate: "G3" | "G4", lines: string[]): void {
  writeFileSync(path.join(root, `evidence/${gate}.json`), lines.map((l) => `${l}\n`).join(""));
}


function writeSummary(grant: string): void {
  const receipts = readFileSync(path.join(root, "evidence/G3.json"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as {task_id: string; change_id: string});
  writeFileSync(path.join(root, ".heldout/verify-summary.json"), JSON.stringify({
    schema: "corpus-verify-summary/v1", split: "heldout", roy_grant: {sha256: sha(grant)}, receipts_sha256: sha("evidence/G3.json"),
    tasks: Array.from({length: 10}, (_, i) => ({task_id: `H${90 + i}`, verified: true})),
    input_ceiling: {policy: "review-input-ceiling/v1", ceiling: 12000, variants: receipts.map(({task_id, change_id}) => ({task_id, change_id, prompt_sha256: "4".repeat(64), utf8_bytes: 5000}))},
  }));
  writeFileSync(path.join(root, ".heldout/LEAKSCAN.json"), JSON.stringify({fixture_only: true, note: "Synthetic leakage/custody audit fixture; no actual held-out audit"}));
  writeG7();
}
function writeG7(): void {
  writeFileSync(path.join(root, "evidence/G7.json"), JSON.stringify({
    schema: "g7-verification-evidence/v1",
    verification_summary: {path: ".heldout/verify-summary.json", sha256: sha(".heldout/verify-summary.json")},
    leakage_custody: {path: ".heldout/LEAKSCAN.json", sha256: sha(".heldout/LEAKSCAN.json")},
  }));
}

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "s41-admit-test-")));
  // Test-only roots replace discovery; real containment and CLI checks still run against the temp fixture.
  vi.mocked(vaultPolicy.canonicalRoot).mockImplementation(async () => root);
  vi.mocked(vaultPolicy.canonicalVault).mockImplementation(async () => path.join(root, ".heldout"));
  out.length = 0;
  for (const dir of ["protocol/grants", "corpus", "evidence", ".heldout"]) mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, "protocol/builder-lineage.json"), readFileSync(new URL("protocol/builder-lineage.json", repoRoot)));
  writeFileSync(path.join(root, "corpus/ADMISSION.json"), readFileSync(new URL("corpus/ADMISSION.json", repoRoot)));
  for (const g of GATE_IDS) writeFileSync(path.join(root, `evidence/${g}.json`), JSON.stringify({ gate: g }));
  const receipts = Array.from({length: 10}, (_, i) => `H${90 + i}`).flatMap((task_id) => [
    receiptLine(VALIDATOR, "fails", {task_id, change_id: "c_0123456789"}),
    receiptLine(VALIDATOR, "passes", {task_id, change_id: "c_abcdef0123"}),
  ]);
  writeReceipts("G3", receipts);
  writeReceipts("G4", receipts);
});

afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

describe("admit", () => {
  it("stays PENDING_ROY_APPOINTMENT without a Roy grant, even with all evidence", async () => {
    const code = await runAdmit(["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", VALIDATOR, ...gateArgs()], io());
    expect(code).toBe(1);
    const r = record();
    expect(r.status).toBe("PENDING_ROY_APPOINTMENT");
    expect(r.signers).toEqual({ steward: null, validator: null });
    expect(r.roy_grant).toBeNull();
    expect(r.decided_at).toBeNull();
  });

  it("writes GO with every hash when all checks pass; the builder appears only as invoked_by", async () => {
    const grant = writeGrant({ developer_overlap_disclosed: true });
    const code = await runAdmit(
      ["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", VALIDATOR, "--roy-grant", grant, ...gateArgs()],
      io(),
    );
    expect(code).toBe(0);
    const r = record();
    expect(r.status).toBe("GO");
    expect(r.signers).toEqual({ steward: STEWARD, validator: VALIDATOR });
    expect(r.invoked_by).toBe(BUILDER);
    expect(r.roy_grant).toEqual({ path: grant, sha256: sha(grant) });
    expect(r.developer_overlap_disclosed).toBe(true);
    for (const g of GATE_IDS) expect(r.gates[g]).toEqual({ evidence: `evidence/${g}.json`, sha256: sha(`evidence/${g}.json`) });
    expect(r.decided_at).toBe("2026-10-27T12:00:00Z");
    expect(r.requires).toEqual([]);
  });

  it("what_bug_this_catches: GO cannot omit its summary, exceed the ceiling, or omit a receipted variant", async () => {
    const grant = writeGrant();
    const invoke = (extra: string[]) => runAdmit(["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", VALIDATOR, "--roy-grant", grant, ...extra], io());
    const gatesOnly = gateArgs().slice(2);
    expect(await invoke(gatesOnly)).toBe(2);
    expect(record().status).toBe("PENDING_ROY_APPOINTMENT");
    for (const mutate of [
      (summary: {input_ceiling: {variants: {utf8_bytes: number}[]}; tasks: {task_id: string}[]}) => { summary.input_ceiling.variants[0]!.utf8_bytes = 12001; },
      (summary: {input_ceiling: {variants: {utf8_bytes: number}[]}; tasks: {task_id: string}[]}) => { summary.input_ceiling.variants.pop(); },
      (summary: {input_ceiling: {variants: {utf8_bytes: number}[]}; tasks: {task_id: string}[]}) => { summary.tasks[0]!.task_id = "H01"; },
    ]) {
      writeSummary(grant);
      const summary = JSON.parse(readFileSync(path.join(root, ".heldout/verify-summary.json"), "utf8"));
      mutate(summary);
      writeFileSync(path.join(root, ".heldout/verify-summary.json"), JSON.stringify(summary));
      writeG7();
      expect(await invoke(gateArgs())).toBe(2);
      expect(record().status).toBe("PENDING_ROY_APPOINTMENT");
      expect(out.join("")).not.toContain("synthetic case");
    }
  });

  it("what_bug_this_catches: G7 cannot drop, change, or alias the separate leakage/custody audit", async () => {
    const grant = writeGrant();
    const invoke = () => runAdmit(["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", VALIDATOR, "--roy-grant", grant, ...gateArgs()], io());
    const wrapper = () => JSON.parse(readFileSync(path.join(root, "evidence/G7.json"), "utf8")) as {verification_summary: {path: string; sha256: string}; leakage_custody: {path: string; sha256: string}};
    const save = (value: unknown) => writeFileSync(path.join(root, "evidence/G7.json"), JSON.stringify(value));
    const missing = wrapper(); missing.leakage_custody.path = ".heldout/missing-audit.json"; save(missing);
    expect(await invoke()).toBe(2);
    writeG7();
    writeFileSync(path.join(root, ".heldout/LEAKSCAN.json"), "synthetic changed private audit sentinel");
    expect(await invoke()).toBe(2);
    writeSummary(grant);
    const samePath = wrapper(); samePath.leakage_custody = {...samePath.verification_summary}; save(samePath);
    expect(await invoke()).toBe(2);
    writeG7();
    linkSync(path.join(root, ".heldout/verify-summary.json"), path.join(root, ".heldout/summary-alias.json"));
    const hardlink = wrapper(); hardlink.leakage_custody = {path: ".heldout/summary-alias.json", sha256: sha(".heldout/summary-alias.json")}; save(hardlink);
    expect(await invoke()).toBe(2);
    writeG7();
    const differentPath = wrapper();
    writeFileSync(path.join(root, ".heldout/summary-copy.json"), readFileSync(path.join(root, ".heldout/verify-summary.json")));
    differentPath.verification_summary.path = ".heldout/summary-copy.json"; save(differentPath);
    expect(await invoke()).toBe(2);
    writeG7();
    writeFileSync(path.join(root, "evidence/outside-audit.json"), "synthetic outside-vault private audit sentinel");
    const outside = wrapper(); outside.leakage_custody = {path: "evidence/outside-audit.json", sha256: sha("evidence/outside-audit.json")}; save(outside);
    expect(await invoke()).toBe(2);
    expect(record().status).toBe("PENDING_ROY_APPOINTMENT");
    expect(out.join("")).not.toContain("private audit sentinel");
  });

  it("is NO-GO unless G3/G4 are witnessed held-out receipts executed by the grant's validator", async () => {
    const grant = writeGrant();
    const run = async () => {
      await runAdmit(["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", VALIDATOR, "--roy-grant", grant, ...gateArgs()], io());
      return record();
    };
    const cases: [string, () => void][] = [
      ["not witness-receipt/v1 records", () => writeFileSync(path.join(root, "evidence/G3.json"), JSON.stringify({ gate: "G3" }))],
      ["not executed by the appointed validator", () => writeReceipts("G3", [receiptLine(BUILDER, "fails")])],
      ["not executed by the appointed validator", () => writeReceipts("G4", [receiptLine(STEWARD, "passes")])],
      ["not held-out (H##) receipts", () => writeReceipts("G3", [receiptLine(VALIDATOR, "fails", { task_id: "T01" })])],
      ["no defect witness (fails) receipt", () => writeReceipts("G3", [receiptLine(VALIDATOR, "passes")])],
      ["no witness receipts", () => writeReceipts("G4", [])],
    ];
    for (const [reason, mutate] of cases) {
      const good = [receiptLine(VALIDATOR, "fails"), receiptLine(VALIDATOR, "passes")];
      writeReceipts("G3", good);
      writeReceipts("G4", good);
      mutate();
      const r = await run();
      expect(r.status).toBe("NO-GO");
      expect(r.status_note).toContain(reason);
      // Receipt content (test names) never reaches the record.
      expect(r.status_note).not.toContain("synthetic case");
    }
    // An unwitnessed receipt (assertion_fail twice on a `passes` expectation) also blocks GO.
    const failing = { status: "assertion_fail", duration_ms: 10, output_sha256: "2".repeat(64) };
    writeReceipts("G4", [receiptLine(VALIDATOR, "passes", { runs: [failing, failing], witnessed: false })]);
    expect((await run()).status_note).toContain("not witnessed");
  });

  it("refuses a builder-lineage signer, including a relabelled builder id", async () => {
    for (const builder of ["0818_Claude_Opus55_Sub_M1CoderHigh", "0801_Someone_Else_Entirely"]) {
      const grant = writeGrant({ steward: builder });
      await runAdmit(["--invoked-by", BUILDER, "--steward", builder, "--validator", VALIDATOR, "--roy-grant", grant, ...gateArgs()], io());
      const r = record();
      expect(r.status).toBe("NO-GO");
      expect(r.signers.steward).toBeNull();
      expect(r.status_note).toContain("builder lineage");
    }
  });

  it("refuses signers who are not the grant's appointees, or the same session twice", async () => {
    const grant = writeGrant();
    await runAdmit(["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", STEWARD, "--roy-grant", grant, ...gateArgs()], io());
    expect(record().status).toBe("NO-GO");
    await runAdmit(["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", "0952_Grok_Other_Validator", "--roy-grant", grant, ...gateArgs()], io());
    expect(record().status).toBe("NO-GO");
  });

  it("is NO-GO when any gate evidence is missing or outside the root", async () => {
    const grant = writeGrant();
    await runAdmit(["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", VALIDATOR, "--roy-grant", grant, ...gateArgs(["G9"])], io());
    expect(record().status).toBe("NO-GO");
    expect(record().status_note).toContain("G9 evidence missing");
    writeFileSync(path.join(path.dirname(root), "s41-outside.json"), "{}");
    await runAdmit(
      ["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", VALIDATOR, "--roy-grant", grant, ...gateArgs(["G1"]), "--gate", "G1=../s41-outside.json"],
      io(),
    );
    expect(record().gates.G1).toEqual({ evidence: null, sha256: null });
    expect(record().status).toBe("NO-GO");
    rmSync(path.join(path.dirname(root), "s41-outside.json"), { force: true });
  });

  it("writes NO-GO when the invoker requests it, and treats an invalid grant file as no appointment", async () => {
    const grant = writeGrant();
    await runAdmit(["--invoked-by", BUILDER, "--decision", "NO-GO", "--steward", STEWARD, "--validator", VALIDATOR, "--roy-grant", grant, ...gateArgs()], io());
    expect(record().status).toBe("NO-GO");
    const bad = writeGrant({ granted_by: "Builder" });
    await runAdmit(["--invoked-by", BUILDER, "--steward", STEWARD, "--validator", VALIDATOR, "--roy-grant", bad, ...gateArgs()], io());
    expect(record().status).toBe("PENDING_ROY_APPOINTMENT");
  });

  it("--dry-run writes nothing; bad usage exits 2", async () => {
    const before = readFileSync(path.join(root, "corpus/ADMISSION.json"), "utf8");
    expect(await runAdmit(["--invoked-by", BUILDER, "--dry-run"], io())).toBe(1);
    expect(readFileSync(path.join(root, "corpus/ADMISSION.json"), "utf8")).toBe(before);
    expect(await runAdmit(["--steward", STEWARD], io())).toBe(2);
    expect(await runAdmit(["--invoked-by", BUILDER, "--decision", "MAYBE"], io())).toBe(2);
    expect(existsSync(path.join(root, "corpus/ADMISSION.json.tmp"))).toBe(false);
  });
});
