// verifyplan tests: receipt change ids are the reviewer-visible projection ids (touched files only), and malformed
// variants are refused. Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-18). Inline data is a tiny synthetic
// dev-style example, not corpus.
import { describe, expect, it } from "vitest";
import { changeContentSha256 } from "../../../src/core/defectcorpus/hashes.ts";
import { neutralChangeId } from "../../../src/core/defectcorpus/ids.ts";
import { variantChangeId } from "../../../src/core/defectcorpus/projection.ts";
import { TaskSchema, VariantSchema } from "../../../src/core/defectcorpus/schema.ts";
import type { Task, Variant } from "../../../src/core/defectcorpus/schema.ts";
import { filesSha256 } from "../../../src/core/sandbox/runner.ts";
import type { WitnessRunResult } from "../../../src/core/sandbox/runner.ts";
import { VerifyPlanError, buildReceipt, planVerification } from "../../../src/core/sandbox/verifyplan.ts";

const A_BASE = "export function a(x: number): number {\n  return x;\n}\n";
const A_GOOD = "export function a(x: number): number {\n  return x + 1;\n}\n";
const A_BAD = "export function a(x: number): number {\n  return x - 1;\n}\n";
const B_BASE = "export const b = 2;\n";
const WITNESS = { path: "hidden/a.test.ts", name: "adds one" };

// Two base files; every variant changes only src/a.ts, so src/b.ts is an UNCHANGED head file.
const task: Task = TaskSchema.parse({
  task_id: "T01",
  split: "dev",
  spec: "a(x) returns x + 1.",
  intent: "Implement a.",
  base_files: [
    { path: "src/a.ts", content: A_BASE },
    { path: "src/b.ts", content: B_BASE },
  ],
  hidden_tests: [{ path: "hidden/a.test.ts", content: "// synthetic\n" }],
  executable_lines: 4,
  labels_authority: "builder_dev_not_independent",
});

const variant = (id: string, aHead: string, extra: Record<string, unknown> = { kind: "clean" }, bHead: string | null = B_BASE): Variant =>
  VariantSchema.parse({
    variant_id: id,
    task_id: "T01",
    head_files: [{ path: "src/a.ts", content: aHead }, ...(bHead === null ? [] : [{ path: "src/b.ts", content: bHead }])],
    labels_authority: "builder_dev_not_independent",
    ...extra,
  });

const clean = variant("T01.clean", A_GOOD);
const defectExtra = { kind: "defect", group: "G-ERR", tag: "wrong-operator", severity: "high", origin: "hand", witness_test: WITNESS };
const defect = variant("T01.d1", A_BAD, defectExtra);

const run = (status: "pass" | "assertion_fail"): WitnessRunResult => ({
  status,
  cause: null,
  durationMs: 12,
  outputSha256: "0".repeat(64),
  imageDigest: `sha256:${"a".repeat(64)}`,
  probeReceiptSha256: "b".repeat(64),
  unqualifiedReasons: [],
});

describe("planVerification change ids", () => {
  it("uses projection.ts variantChangeId (touched files only) for every check and receipt", () => {
    const checks = planVerification(task, [defect, clean]);
    expect(checks.map((c) => c.checkId)).toEqual([
      "T01/T01.clean/passes/hidden/a.test.ts#*",
      "T01/T01.clean/passes/hidden/a.test.ts#adds one",
      "T01/T01.d1/fails/hidden/a.test.ts#adds one",
    ]);
    const projected = new Map([
      ["T01.clean", variantChangeId(clean, task)],
      ["T01.d1", variantChangeId(defect, task)],
    ]);
    for (const c of checks) {
      expect(c.changeId).toBe(projected.get(c.variantId));
      const status = c.expectation === "fails" ? "assertion_fail" : "pass";
      const receipt = buildReceipt(c, [run(status), run(status)], "0900_Grok_X_Validator", "2026-10-27T12:00:00Z");
      expect(receipt.change_id).toBe(projected.get(c.variantId));
      expect(receipt.witnessed).toBe(true);
      // The target hash still covers the complete head (both files) that was executed.
      expect(receipt.target_sha256).toBe(filesSha256(c.variantId === "T01.d1" ? defect.head_files : clean.head_files));
    }
    // The old derivation (every head file, including the unchanged src/b.ts) gives a different id.
    const allHeadFiles = neutralChangeId(
      changeContentSha256(task.spec, [
        { path: "src/a.ts", base: A_BASE, head: A_GOOD },
        { path: "src/b.ts", base: B_BASE, head: B_BASE },
      ]),
    );
    expect(projected.get("T01.clean")).not.toBe(allHeadFiles);
  });
});

describe("planVerification refusals (M1 carry-overs closed here)", () => {
  it("refuses a head that is missing a base path", () => {
    expect(() => planVerification(task, [variant("T01.clean", A_GOOD, { kind: "clean" }, null)])).toThrow(VerifyPlanError);
  });

  it("refuses a touched file whose unified diff is empty (trailing newline only)", () => {
    const noNewline = variant("T01.clean", A_GOOD, { kind: "clean" }, B_BASE.slice(0, -1));
    expect(() => planVerification(task, [noNewline])).toThrow(/empty diff/);
  });

  it("refuses a variant that touches nothing, duplicate variant ids and a second clean", () => {
    expect(() => planVerification(task, [variant("T01.clean", A_BASE)])).toThrow(VerifyPlanError);
    expect(() => planVerification(task, [clean, variant("T01.clean", A_BAD, defectExtra)])).toThrow(/duplicate variant id/);
    expect(() => planVerification(task, [clean, variant("T01.clean2", A_BAD)])).toThrow(/exactly one clean/);
  });
});
