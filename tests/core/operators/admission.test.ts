// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-14).
import { describe, expect, it } from "vitest";
import type { WitnessReceipt } from "../../../src/core/defectcorpus/schema.ts";
import { MUTANT_ADMISSION_REQUIREMENTS, evaluateMutantAdmission } from "../../../src/core/operators/index.ts";

const run = (status: WitnessReceipt["runs"][number]["status"]) => ({ status, duration_ms: 10, output_sha256: "c".repeat(64) });

function receipt(expectation: "fails" | "passes", target: string, witnessed: boolean): WitnessReceipt {
  const status = expectation === "fails" ? "assertion_fail" : "pass";
  return {
    schema: "witness-receipt/v1",
    task_id: "T01",
    change_id: "c_0123456789",
    target_sha256: target,
    test: { path: "hidden/a.test.ts", name: "rejects the boundary" },
    expectation,
    runs: witnessed ? [run(status), run(status)] : [run(status), run("timeout")],
    consistent: witnessed,
    witnessed,
    sandbox_image_digest: `sha256:${"d".repeat(64)}`,
    probe_receipt_sha256: "e".repeat(64),
    executor: "0900_Grok_X_Validator",
    recorded_at: "2026-10-27T00:00:00Z",
  };
}

describe("mutant admission requirements", () => {
  it("lists compile and witness as deferred requirements", () => {
    expect(MUTANT_ADMISSION_REQUIREMENTS.map((r) => r.id)).toEqual(["MA1", "MA2", "MA3", "MA4"]);
    expect(MUTANT_ADMISSION_REQUIREMENTS.find((r) => r.id === "MA2")?.requirement).toContain("tsc --noEmit");
  });

  it("admits only with compile pass, a twice-failing witness and a twice-passing twin", () => {
    const ok = {
      compile: "pass" as const,
      mutationsApplied: 1,
      defectReceipt: receipt("fails", "a".repeat(64), true),
      twinReceipt: receipt("passes", "b".repeat(64), true),
    };
    expect(evaluateMutantAdmission(ok)).toEqual({ admitted: true, unmet: [] });
    expect(evaluateMutantAdmission({ ...ok, compile: "not_run" }).unmet).toEqual(["MA2"]);
    expect(evaluateMutantAdmission({ ...ok, defectReceipt: receipt("fails", "a".repeat(64), false) }).unmet).toEqual(["MA3"]);
    expect(evaluateMutantAdmission({ ...ok, twinReceipt: null }).unmet).toEqual(["MA3"]);
    expect(evaluateMutantAdmission({ ...ok, twinReceipt: receipt("passes", "a".repeat(64), true) }).unmet).toEqual(["MA3"]);
    expect(evaluateMutantAdmission({ ...ok, mutationsApplied: 2 }).unmet).toEqual(["MA4"]);
  });
});
