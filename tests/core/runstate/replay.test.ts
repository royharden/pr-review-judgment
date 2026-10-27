import { describe, it, expect } from "vitest";
import { replay } from "../../../cli/replay.ts";
import { loadFixture, testLock } from "../providers/helpers.ts";
const task = { task_id: "T01", split: "dev", spec: "Return the sum.", intent: "A small arithmetic task.", base_files: [{ path: "main.ts", content: "export const sum = (a: number, b: number) => 0;\n" }], hidden_tests: [{ path: "sum.test.ts", content: "// suite bytes are never sent\n" }], executable_lines: 1, labels_authority: "builder_dev_not_independent" };
const clean = { kind: "clean", variant_id: "clean", task_id: "T01", labels_authority: "builder_dev_not_independent", head_files: [{ path: "main.ts", content: "export const sum = (a: number, b: number) => a + b;\n" }] };
const bundle = () => ({ schema: "replay-bundle/v1", run_id: "mock-one", generated_at: "2026-10-27T00:00:00Z", slots: [{ id: "s1", purpose: "review", task, variant: clean, clean_variant: clean, stratum: "A", arm: "A", author: null, defect_ordinal: 1, repeat: 1, lock: testLock("openai"), fixture: loadFixture("openai_text") }] });
describe("keyless report replay", () => {
  it("what_bug_this_catches: time or nondeterministic iteration must not change a replay hash", async () => {
    const a = await replay(bundle()), b = await replay(bundle());
    expect(a.sha256).toBe(b.sha256); expect(a.json).toBe(b.json); expect(a.markdown).toContain("MOCK"); expect(a.markdown).toContain("NOT MEASURED");
  });
  it("what_bug_this_catches: missing recordings cannot be counted as a successful completed run", async () => {
    const b = bundle(); const invalid = { ...b, slots: b.slots.map(({ fixture: _fixture, ...s }) => s) };
    await expect(replay(invalid)).rejects.toThrow();
  });
});
