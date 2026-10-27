import { describe, it, expect } from "vitest";
import { makeBPin, verifyBPin, type BPinRecordSchema } from "../../../src/core/protocol/b.ts";
import type { z } from "zod";
import { filesSha256 } from "../../../src/core/sandbox/runner.ts";
const hash = "a".repeat(64), other = "b".repeat(64);
function record(author: "A" | "B"): z.infer<typeof BPinRecordSchema> {
  const defects = [1, 2].map((n) => { const head_files = [{ path: "main.ts", content: `export const n = ${n};` }]; return { path: "main.ts", operator: "NumericBoundary", source_sha256: filesSha256(head_files), head_files, mutation_key: (n === 1 ? "c" : "d").repeat(64) }; });
  return { task_id: "T01", author, task_sha256: hash, cell_sha256: hash, qualified_path: `qualified/${author}.json`, audit_path: `audit/${author}.json`, witnesses_path: `witnesses/${author}.json`, qualified_sha256: hash, clean_sha256: hash, defects, audit_sha256: hash, witnesses_sha256: hash, mock: false };
}
describe("paired B pin commitments", () => {
  it("what_bug_this_catches: incomplete/duplicate paired author cells cannot become a pin", () => {
    expect(() => makeBPin([record("A")], hash)).toThrow("paired");
    expect(() => makeBPin([record("A"), record("A")], hash)).toThrow("duplicate");
  });
  it("what_bug_this_catches: self-hash, generation binding and stored mutant heads are enforced", () => {
    const pin = makeBPin([record("A"), record("B")], hash);
    expect(verifyBPin(pin, hash).sha256).toBe(pin.sha256);
    expect(() => verifyBPin(pin, other)).toThrow();
    expect(() => verifyBPin({ ...pin, sha256: other }, hash)).toThrow();
    pin.records[0]!.defects[0]!.head_files[0]!.content = "substitution";
    expect(() => verifyBPin(pin, hash)).toThrow();
  });
  it("what_bug_this_catches: any fixture-derived cell contaminates the entire pin", () => {
    expect(makeBPin([record("A"), { ...record("B"), mock: true }], hash).mock).toBe(true);
  });
});
