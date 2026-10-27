// Deferred regression source; never executed during Dirty Mode.
import { describe, it, expect } from "vitest";
import { scheduleAuthorGeneration } from "../../../src/core/protocol/b.ts";
import { GenerationHistorySchema, type GenerationHistory } from "../../../src/core/runstate/evidence.ts";
import { authorizeLook, type Look } from "../../../src/core/protocol/index.ts";
const hash = "a".repeat(64), other = "b".repeat(64);
const empty = (): GenerationHistory => ({ schema: "b-generation-history/v1", cells: [] });
const first = { task_id: "H01", author: "A" as const, cell_sha256: hash, run_id: "gen", slot_id: "a1", fresh: 1 };
describe("persisted fresh generations", () => {
  it("what_bug_this_catches: qualification must precede second fresh prompt and success cancels it", () => {
    const issued = scheduleAuthorGeneration(empty(), first);
    expect(scheduleAuthorGeneration(issued.history, { ...first, slot_id: "a2", fresh: 2 }).decision).toBe("wait");
    issued.history.cells[0]!.attempts[0]!.qualification = "pass"; issued.history.cells[0]!.attempts[0]!.qualification_evidence_sha256 = hash; issued.history.cells[0]!.attempts[0]!.qualified_artifact_sha256 = hash;
    expect(scheduleAuthorGeneration(issued.history, { ...first, slot_id: "a2", fresh: 2 }).decision).toBe("cancel");
  });
  it("what_bug_this_catches: confirmed transport retries reuse the same fresh generation entry", () => {
    const issued = scheduleAuthorGeneration(empty(), first);
    const retried = scheduleAuthorGeneration(issued.history, first);
    expect(retried.history.cells[0]!.attempts).toHaveLength(1);
  });
  it("what_bug_this_catches: neither new run/config nor third fresh slot resets the two-output cap", () => {
    const issued = scheduleAuthorGeneration(empty(), first);
    expect(() => scheduleAuthorGeneration(issued.history, { ...first, run_id: "other" })).toThrow();
    expect(() => scheduleAuthorGeneration(issued.history, { ...first, cell_sha256: other })).toThrow();
    issued.history.cells[0]!.attempts[0]!.qualification = "fail"; issued.history.cells[0]!.attempts[0]!.qualification_evidence_sha256 = hash;
    const second = scheduleAuthorGeneration(issued.history, { ...first, slot_id: "a2", fresh: 2 });
    expect(second.decision).toBe("issue");
    expect(() => scheduleAuthorGeneration(second.history, { ...first, slot_id: "a3", fresh: 3 })).toThrow();
  });
  it("what_bug_this_catches: a supplied history cannot omit/reorder the first fresh attempt", () => {
    const issued = scheduleAuthorGeneration(empty(), first);
    issued.history.cells[0]!.attempts[0]!.fresh = 2;
    expect(() => GenerationHistorySchema.parse(issued.history)).toThrow();
  });
});
describe("locked look scopes", () => {
  const look: Look = { run_id: "a", lock_sha256: hash, corpus_sha256: hash, config_sha256: hash, purpose: "review", stage: "A", action: "authorize", at: "2026-10-27T00:00:00Z" };
  it("what_bug_this_catches: preregistered A/B and generation/review can run, but same-purpose resets cannot", () => {
    expect(authorizeLook([look], { ...look, run_id: "b", lock_sha256: other, stage: "B" })).toHaveLength(2);
    expect(authorizeLook([look], { ...look, run_id: "g", lock_sha256: other, purpose: "author" })).toHaveLength(2);
    expect(() => authorizeLook([look], { ...look, run_id: "reset", lock_sha256: other })).toThrow();
    expect(() => authorizeLook([look], { ...look, run_id: "same-lock", purpose: "author", stage: "B" })).toThrow();
  });
  it("what_bug_this_catches: legacy ambiguous scope cannot authorize another fresh look", () => {
    const { purpose: _p, stage: _s, ...legacy } = look;
    expect(() => authorizeLook([legacy], { ...look, run_id: "reset", lock_sha256: other, stage: "B" })).toThrow();
  });
});
