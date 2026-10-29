import { describe, it, expect } from "vitest";
import ts from "typescript";
import { authorPrompt, seedCandidates, makeBPin } from "../../../src/core/protocol/b.ts";
import { TaskSchema, CleanVariant } from "../../../src/core/defectcorpus/schema.ts";
const task = TaskSchema.parse({ task_id: "T01", split: "dev", spec: "Compare a pair.", intent: "Public semantics.", base_files: [{ path: "main.ts", content: "export const f = (a: number, b: number) => false;\nexport const untouched = 1;\n" }], hidden_tests: [{ path: "main.test.ts", content: "DO_NOT_SEND_THIS_FAILURE" }], executable_lines: 2, labels_authority: "builder_dev_not_independent" });
const clean = CleanVariant.parse({ task_id: "T01", variant_id: "clean", kind: "clean", labels_authority: "builder_dev_not_independent", head_files: [{ path: "main.ts", content: "export const f = (a: number, b: number) => a < b;\nexport const untouched = 1;\n" }] });
describe("B construction constraints", () => {
  it("what_bug_this_catches: fresh author prompts cannot include hidden suites or failure feedback", () => {
    expect(authorPrompt(task)).not.toContain("DO_NOT_SEND"); expect(JSON.parse(authorPrompt(task))).toEqual({ spec: task.spec, base_files: task.base_files });
  });
  it("what_bug_this_catches: B operators may not modify unchanged substrate lines", () => {
    const candidates = seedCandidates(task, clean, ["Relational", "NumericBoundary"], ts);
    expect(candidates).toHaveLength(1); expect(candidates[0]!.head_files[0]!.content).toContain("a <= b");
    expect(candidates[0]!.head_files[0]!.content).toContain("untouched = 1");
  });
  it("what_bug_this_catches: one or duplicate defects cannot masquerade as the two-defect crossed cell", () => {
    const hash = "a".repeat(64);
    expect(() => makeBPin([{ task_id: "T01", author: "A", task_sha256: hash, cell_sha256: hash, qualified_path: "qualified/a.json", audit_path: "audits/a.json", witnesses_path: "witnesses/a.json", qualified_sha256: hash, clean_sha256: hash, defects: [], audit_sha256: hash, witnesses_sha256: hash, mock: true }], hash)).toThrow("two distinct");
  });
});
