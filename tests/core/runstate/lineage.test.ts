// Deferred regression source: network-free recordings and closed envelope validation.
import { describe, it, expect } from "vitest";
import { PlannedSlotSchema, requestFor, scoreRecordings } from "../../../src/core/runstate/recordings.ts";
import { EnvelopeSchema } from "../../../src/core/runstate/evidence.ts";
import { createMockProvider } from "../../../src/core/providers/mock.ts";
import { loadFixture, testLock } from "../providers/helpers.ts";
import { AUTHOR_SYSTEM, authorPrompt } from "../../../src/core/protocol/b.ts";
const task = { task_id: "T01", split: "dev", spec: "Return the sum.", intent: "Public test task.", base_files: [{ path: "main.ts", content: "export const f = (a: number, b: number) => 0;\n" }], hidden_tests: [{ path: "main.test.ts", content: "// public test suite" }], executable_lines: 1, labels_authority: "builder_dev_not_independent" };
const clean = { kind: "clean", variant_id: "clean", task_id: "T01", labels_authority: "builder_dev_not_independent", head_files: [{ path: "main.ts", content: "export const f = (a: number, b: number) => a + b;\n" }] };
const planned = () => PlannedSlotSchema.parse({ id: "s1", purpose: "review", task, variant: clean, clean_variant: clean, stratum: "A", arm: "A", author: null, defect_ordinal: 1, repeat: 1, lock: testLock("openai") });
describe("recording lineage", () => {
  it("what_bug_this_catches: an author needs no fabricated diff and sees only spec/base under author limits", () => {
    const slot = planned(); slot.purpose = "author"; slot.stratum = "B"; slot.author = "A"; slot.fresh_attempt = 1;
    slot.variant = { ...slot.clean_variant, head_files: slot.task.base_files };
    slot.clean_variant = { ...slot.clean_variant, head_files: slot.task.base_files };
    const request = requestFor(slot);
    expect(request.systemPrompt).toBe(AUTHOR_SYSTEM); expect(request.userPrompt).toBe(authorPrompt(slot.task));
    expect(JSON.parse(request.userPrompt)).toEqual({ spec: slot.task.spec, base_files: slot.task.base_files });
    expect(request.userPrompt).not.toContain(slot.task.intent); expect(request.userPrompt).not.toContain("public test suite");
    slot.task = { ...slot.task, spec: "x".repeat(8000) };
    expect(() => requestFor(slot)).toThrow("input exceeds");
    slot.task = planned().task; slot.lock = testLock("openai", { output_cap_tokens: 16001 });
    expect(() => requestFor(slot)).toThrow("output cap");
    slot.lock = testLock("openai"); slot.author = "B";
    expect(() => requestFor(slot)).toThrow("own B author cell");
    slot.purpose = "review"; slot.author = "A";
    expect(() => requestFor(slot)).toThrow();
  });
  it("what_bug_this_catches: same slot/model from a different request cannot be scored", async () => {
    const slot = planned(), provider = createMockProvider("openai", () => loadFixture("openai_text"));
    const envelope = await provider.complete({ ...requestFor(slot), userPrompt: "different request" });
    expect(() => scoreRecordings("r", [{ slot, envelope }])).toThrow("identity/request");
  });
  it("what_bug_this_catches: stripping a MOCK marker or adding unknown envelope fields refuses closed input", async () => {
    const slot = planned(), provider = createMockProvider("openai", () => loadFixture("openai_text"));
    const envelope = await provider.complete(requestFor(slot));
    const { mock: _mock, ...stripped } = envelope;
    expect(() => EnvelopeSchema.parse(stripped)).toThrow();
    expect(() => EnvelopeSchema.parse({ ...envelope, trusted_by_caller: true })).toThrow();
    expect(scoreRecordings("r", [{ slot, envelope }]).cleanSlots[0]!.mock).toBe(true);
  });
});
