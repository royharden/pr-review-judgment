// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-07, DV-10).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AdmissionRecordSchema,
  GATE_IDS,
  isSafeRelPath,
  PrivateCompanionRecordSchema,
  PublicManifestRecordSchema,
  RelPath,
  Sha256Hex,
  TaskSchema,
  VariantSchema,
  WitnessReceiptSchema,
} from "../../../src/core/defectcorpus/schema.ts";

const repoRoot = new URL("../../../", import.meta.url);
const readJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, repoRoot), "utf8"));

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);

describe("RelPath", () => {
  it("accepts normalized relative POSIX paths", () => {
    for (const p of ["src/a.ts", "a.ts", "hidden/x.test.ts", "a-b_c/d.e.ts"]) expect(RelPath.safeParse(p).success).toBe(true);
  });

  it("rejects absolute, drive letters, backslashes, '..', '.' and empty segments", () => {
    for (const p of ["", "/etc/passwd", "C:/x.ts", "c:x.ts", "src\\a.ts", "../a.ts", "src/../a.ts", "src/..", "./a.ts", "src//a.ts", "src/", "a\u0000b"]) {
      expect(isSafeRelPath(p), p).toBe(false);
      expect(RelPath.safeParse(p).success, p).toBe(false);
    }
  });
});

describe("Sha256Hex", () => {
  it("accepts 64 lowercase hex only", () => {
    expect(Sha256Hex.safeParse(HASH).success).toBe(true);
    expect(Sha256Hex.safeParse("A".repeat(64)).success).toBe(false);
    expect(Sha256Hex.safeParse("a".repeat(63)).success).toBe(false);
    expect(Sha256Hex.safeParse("g".repeat(64)).success).toBe(false);
  });
});

describe("TaskSchema", () => {
  const task = {
    task_id: "T01",
    split: "dev",
    spec: "s",
    intent: "i",
    base_files: [{ path: "src/a.ts", content: "" }],
    hidden_tests: [{ path: "hidden/a.test.ts", content: "" }],
    executable_lines: 10,
    labels_authority: "builder_dev_not_independent",
  };

  it("accepts a dev task", () => {
    expect(TaskSchema.safeParse(task).success).toBe(true);
  });

  it("enforces split/id/authority consistency and size limits", () => {
    expect(TaskSchema.safeParse({ ...task, split: "heldout" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...task, labels_authority: "steward_heldout" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...task, executable_lines: 151 }).success).toBe(false);
    const three = [1, 2, 3].map((n) => ({ path: `src/f${n}.ts`, content: "" }));
    expect(TaskSchema.safeParse({ ...task, base_files: three }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...task, extra: 1 }).success).toBe(false);
  });
});

describe("VariantSchema", () => {
  const common = {
    variant_id: "T01.v",
    task_id: "T01",
    head_files: [{ path: "src/a.ts", content: "x\n" }],
    labels_authority: "builder_dev_not_independent",
  };
  const test = { path: "hidden/a.test.ts", name: "t" };

  it("accepts the three kinds with their required fields", () => {
    expect(VariantSchema.safeParse({ ...common, kind: "clean" }).success).toBe(true);
    expect(VariantSchema.safeParse({ ...common, kind: "near_miss", guard_test: test }).success).toBe(true);
    const defect = { ...common, kind: "defect", group: "G-BND", tag: "off-by-one", severity: "medium", origin: "hand", witness_test: test };
    expect(VariantSchema.safeParse(defect).success).toBe(true);
    expect(VariantSchema.safeParse({ ...defect, origin: "operator:RemoveAwait" }).success).toBe(true);
  });

  it("rejects missing or misplaced label fields", () => {
    expect(VariantSchema.safeParse({ ...common, kind: "defect" }).success).toBe(false);
    expect(VariantSchema.safeParse({ ...common, kind: "clean", group: "G-BND" }).success).toBe(false);
    expect(VariantSchema.safeParse({ ...common, kind: "near_miss" }).success).toBe(false);
    expect(VariantSchema.safeParse({ ...common, kind: "mutant" }).success).toBe(false);
    const defect = { ...common, kind: "defect", group: "G-XXX", tag: "t", severity: "high", origin: "hand", witness_test: test };
    expect(VariantSchema.safeParse(defect).success).toBe(false);
    expect(VariantSchema.safeParse({ ...defect, group: "G-ACC", origin: "operator:" }).success).toBe(false);
  });
});

describe("PublicManifestRecordSchema", () => {
  const open = {
    id: "c_0123456789",
    taskId: "T01",
    spec: "s",
    files: [{ path: "src/a.ts", base: "x\n", head: "y\n" }],
    manifestHash: HASH,
    license: "MIT",
    embargoStatus: "open",
  };

  it("accepts the open payload and rejects any label field", () => {
    expect(PublicManifestRecordSchema.safeParse(open).success).toBe(true);
    for (const extra of ["kind", "group", "tag", "regions", "clean_twin_id"]) {
      expect(PublicManifestRecordSchema.safeParse({ ...open, [extra]: "x" }).success, extra).toBe(false);
    }
  });

  it("embargoed records must withhold files and spec", () => {
    const embargoed = { ...open, embargoStatus: "embargoed", files: null, spec: null };
    expect(PublicManifestRecordSchema.safeParse(embargoed).success).toBe(true);
    expect(PublicManifestRecordSchema.safeParse({ ...embargoed, files: open.files }).success).toBe(false);
    expect(PublicManifestRecordSchema.safeParse({ ...embargoed, spec: "s" }).success).toBe(false);
  });
});

describe("PrivateCompanionRecordSchema", () => {
  const base = {
    id: "c_0123456789",
    task_id: "T01",
    variant_id: "T01.v",
    split: "dev",
    kind: "defect",
    group: "G-ASY",
    tag: "missing-await",
    severity: "high",
    origin: "operator:RemoveAwait",
    labels_authority: "builder_dev_not_independent",
    content_sha256: HASH,
    clean_twin_id: "c_abcdefabcd",
    region_policy: "region/v1",
    regions: [{ path: "src/a.ts", start_line: 3, end_line: 4 }],
    witness_test: { path: "hidden/a.test.ts", name: "t" },
    guard_test: null,
  };

  it("accepts a defect companion", () => {
    expect(PrivateCompanionRecordSchema.safeParse(base).success).toBe(true);
  });

  it("enforces per-kind label rules", () => {
    expect(PrivateCompanionRecordSchema.safeParse({ ...base, regions: [] }).success).toBe(false);
    expect(PrivateCompanionRecordSchema.safeParse({ ...base, group: null }).success).toBe(false);
    expect(PrivateCompanionRecordSchema.safeParse({ ...base, regions: [{ path: "src/a.ts", start_line: 5, end_line: 4 }] }).success).toBe(false);
    const clean = { ...base, kind: "clean", group: null, tag: null, severity: null, origin: null, clean_twin_id: null, regions: [], witness_test: null };
    expect(PrivateCompanionRecordSchema.safeParse(clean).success).toBe(true);
    expect(PrivateCompanionRecordSchema.safeParse({ ...clean, clean_twin_id: "c_abcdefabcd" }).success).toBe(false);
    expect(PrivateCompanionRecordSchema.safeParse({ ...clean, split: "heldout" }).success).toBe(false);
  });
});

describe("WitnessReceiptSchema", () => {
  const run = (status: string) => ({ status, duration_ms: 12, output_sha256: HASH2 });
  const receipt = {
    schema: "witness-receipt/v1",
    task_id: "T01",
    change_id: "c_0123456789",
    target_sha256: HASH,
    test: { path: "hidden/a.test.ts", name: "t" },
    expectation: "fails",
    runs: [run("assertion_fail"), run("assertion_fail")],
    consistent: true,
    witnessed: true,
    sandbox_image_digest: `sha256:${HASH}`,
    probe_receipt_sha256: HASH2,
    executor: "0818_Claude_Opus55_Sub_M1CoderHigh",
    recorded_at: "2026-10-27T18:00:00Z",
  };

  it("accepts a two-run witness", () => {
    expect(WitnessReceiptSchema.safeParse(receipt).success).toBe(true);
  });

  it("timeouts and inconsistent runs are never a witness", () => {
    expect(WitnessReceiptSchema.safeParse({ ...receipt, runs: [run("timeout"), run("timeout")] }).success).toBe(false);
    const flaky = { ...receipt, runs: [run("assertion_fail"), run("pass")], consistent: false, witnessed: false };
    expect(WitnessReceiptSchema.safeParse(flaky).success).toBe(true);
    expect(WitnessReceiptSchema.safeParse({ ...flaky, witnessed: true }).success).toBe(false);
    expect(WitnessReceiptSchema.safeParse({ ...receipt, runs: [run("assertion_fail")] }).success).toBe(false);
  });

  it("unqualified sandbox runs need no digest; executed runs do", () => {
    const unqualified = {
      ...receipt,
      runs: [run("sandbox_unqualified"), run("sandbox_unqualified")],
      witnessed: false,
      sandbox_image_digest: null,
      probe_receipt_sha256: null,
    };
    expect(WitnessReceiptSchema.safeParse(unqualified).success).toBe(true);
    expect(WitnessReceiptSchema.safeParse({ ...receipt, sandbox_image_digest: null }).success).toBe(false);
  });
});

describe("AdmissionRecordSchema and corpus/ADMISSION.json", () => {
  it("the committed record parses and is PENDING_ROY_APPOINTMENT with every gate null", () => {
    const record = AdmissionRecordSchema.parse(readJson("corpus/ADMISSION.json"));
    expect(record.status).toBe("PENDING_ROY_APPOINTMENT");
    for (const id of GATE_IDS) expect(record.gates[id]).toEqual({ evidence: null, sha256: null });
    expect(record.signers).toEqual({ steward: null, validator: null });
    expect(record.roy_grant).toBeNull();
  });

  it("GO requires all evidence, two distinct signers, a Roy grant and a decision time", () => {
    const pending = AdmissionRecordSchema.parse(readJson("corpus/ADMISSION.json"));
    expect(AdmissionRecordSchema.safeParse({ ...pending, status: "GO" }).success).toBe(false);
    const gates = Object.fromEntries(GATE_IDS.map((id) => [id, { evidence: `evidence/${id}.json`, sha256: HASH }]));
    const go = {
      ...pending,
      status: "GO",
      requires: [],
      gates,
      signers: { steward: "AA01_Gemini_Steward", validator: "AB02_Grok_Validator" },
      roy_grant: { path: "grants/R3.md", sha256: HASH2 },
      decided_at: "2026-11-01T00:00:00Z",
    };
    expect(AdmissionRecordSchema.safeParse(go).success).toBe(true);
    expect(AdmissionRecordSchema.safeParse({ ...go, signers: { steward: "AA01_X", validator: "AA01_X" } }).success).toBe(false);
    expect(AdmissionRecordSchema.safeParse({ ...go, roy_grant: null }).success).toBe(false);
    expect(AdmissionRecordSchema.safeParse({ ...go, requires: ["R3"] }).success).toBe(false);
    expect(AdmissionRecordSchema.safeParse({ ...go, gates: { ...gates, G9: { evidence: null, sha256: null } } }).success).toBe(false);
    expect(AdmissionRecordSchema.safeParse({ ...go, gates: { ...gates, G1: { evidence: "/abs.json", sha256: HASH } } }).success).toBe(false);
  });
});

describe("protocol files: every Roy-dependent field is unset", () => {
  it("model-lock.json is all null and requires R2", () => {
    const lock = readJson("protocol/model-lock.json") as { requires: string[]; locked_at: unknown; roy_grant: unknown; reviewers: Record<string, Record<string, unknown>> };
    expect(lock.requires).toEqual(["R2"]);
    expect(lock.locked_at).toBeNull();
    expect(lock.roy_grant).toBeNull();
    for (const reviewer of Object.values(lock.reviewers)) for (const value of Object.values(reviewer)) expect(value).toBeNull();
  });

  it("prices.json is all null and requires R1 and R2", () => {
    const prices = readJson("protocol/prices.json") as { requires: string[]; retrieved_at: unknown; approved_by_roy: unknown; models: Record<string, Record<string, unknown>> };
    expect(prices.requires).toEqual(["R1", "R2"]);
    expect(prices.retrieved_at).toBeNull();
    expect(prices.approved_by_roy).toBeNull();
    for (const model of Object.values(prices.models)) for (const value of Object.values(model)) expect(value).toBeNull();
  });

  it("budget.json is disabled with every approved cap 0", () => {
    const budget = readJson("protocol/budget.json") as {
      requires: string[];
      enabled: boolean;
      approved_usd: number;
      recommended_usd: number;
      sub_caps: Record<string, { approved_usd: number }>;
    };
    expect(budget.requires).toEqual(["R1"]);
    expect(budget.enabled).toBe(false);
    expect(budget.approved_usd).toBe(0);
    expect(budget.recommended_usd).toBe(150);
    expect(Object.keys(budget.sub_caps).sort()).toEqual(["preparation", "stratum_a", "stratum_b"]);
    for (const cap of Object.values(budget.sub_caps)) expect(cap.approved_usd).toBe(0);
  });

  it("preregistration.json is an unlocked draft with the fixed constants", () => {
    const pre = readJson("protocol/preregistration.json") as {
      status: string;
      localization: { k_primary: number; k_columns: number[]; span_cap_lines: number };
      repeats: { heldout: number; dev: number };
      seeds: Record<string, number>;
      bootstrap: { draws: number };
      tokens: { input_ceiling: number; output_cap: number };
      estimability: { dev_hit_upper: number; dev_hit_lower: number; max_non_valid_share: number };
      slots: { a_dev: number; a_heldout: number; b_dev: number; b_heldout: number; total: number };
    };
    expect(pre.status).toBe("draft_unlocked");
    expect(pre.localization).toMatchObject({ k_primary: 2, k_columns: [0, 5], span_cap_lines: 20 });
    expect(pre.repeats).toEqual({ heldout: 3, dev: 1 });
    expect(pre.seeds).toEqual({ split: 4101, bootstrap_stratum_a: 4102, bootstrap_stratum_b: 4103 });
    expect(pre.bootstrap.draws).toBe(10000);
    expect(pre.tokens).toMatchObject({ input_ceiling: 12000, output_cap: 8000 });
    expect(pre.estimability).toMatchObject({ dev_hit_upper: 0.9, dev_hit_lower: 0.1, max_non_valid_share: 0.15 });
    const s = pre.slots;
    expect(s.a_dev + s.a_heldout + s.b_dev + s.b_heldout).toBe(s.total);
  });
});
