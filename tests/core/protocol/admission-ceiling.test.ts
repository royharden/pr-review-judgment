import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TaskSchema, VariantSchema } from "../../../src/core/defectcorpus/schema.ts";
import { reviewInputCeiling, verifyInputCeiling } from "../../../src/core/protocol/admission-evidence.ts";
import { buildReviewPrompt } from "../../../src/core/reviewjudge/contract.ts";
import { reviewerInput } from "../../../src/core/reviewjudge/projection.ts";
import { sha256Hex } from "../../../src/core/hash/sha256.ts";
const task = TaskSchema.parse(JSON.parse(readFileSync(new URL("../../../corpus/dev/T01/task.json", import.meta.url), "utf8")));
const variant = VariantSchema.parse(JSON.parse(readFileSync(new URL("../../../corpus/dev/T01/variants/c.json", import.meta.url), "utf8")));
const entry = { task_id: "H99", change_id: "c_0123456789", prompt_sha256: "a".repeat(64), utf8_bytes: 12000 };
const record = { schema: "witness-receipt/v1", task_id: entry.task_id, change_id: entry.change_id, target_sha256: "1".repeat(64), test: {path: "hidden/synthetic.test.ts", name: "*"}, expectation: "passes", runs: Array.from({length: 2}, () => ({status: "pass", duration_ms: 1, output_sha256: "2".repeat(64)})), consistent: true, witnessed: true, sandbox_image_digest: `sha256:${"a".repeat(64)}`, probe_receipt_sha256: "3".repeat(64), executor: "ZZ99_Test_Validator", recorded_at: "2026-10-27T00:00:00Z" };
const receipt = JSON.stringify(record) + "\n";
const evidence = (variants = [entry]) => ({ policy: "review-input-ceiling/v1", ceiling: 12000, variants });
describe("admission input ceiling", () => {
  it("what_bug_this_catches: admission counts exact rendered UTF-8 prompt bytes including the system contract", () => {
    const prompt = buildReviewPrompt(reviewerInput(variant, task).projection);
    const check = reviewInputCeiling(task, variant);
    expect(check.utf8_bytes).toBe(Buffer.byteLength(prompt.system + prompt.user, "utf8"));
    expect(check.prompt_sha256).toBe(sha256Hex(prompt.system + prompt.user));
    expect(() => reviewInputCeiling({...task, spec: "plain text ".repeat(2000)}, variant)).toThrow("ceiling");
    expect(() => reviewInputCeiling({...task, spec: "\u6587".repeat(4000)}, variant)).toThrow("ceiling");
  });
  it("what_bug_this_catches: missing, oversized, duplicate and unreceipted variants cannot pass admission", () => {
    expect(() => verifyInputCeiling(evidence(), [receipt, receipt])).not.toThrow();
    for (const invalid of [undefined, evidence([]), evidence([{...entry, utf8_bytes: 12001}]), evidence([entry, entry]), evidence([{...entry, change_id: "c_abcdef0123"}])]) {
      expect(() => verifyInputCeiling(invalid, [receipt, receipt])).toThrow();
    }
    expect(() => verifyInputCeiling(evidence(), [receipt, undefined])).toThrow();
  });
});
