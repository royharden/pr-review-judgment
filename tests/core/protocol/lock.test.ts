import { describe, it, expect } from "vitest";
import { authorizeLook, rejectNull, qualifyDev, validateLock, type Look } from "../../../src/core/protocol/index.ts";
import { verifySummary, GATE_MEANINGS } from "../../../src/core/protocol/admission-evidence.ts";
import { testLock } from "../providers/helpers.ts";
import { sha256Hex } from "../../../src/core/hash/sha256.ts";
describe("fail-closed protocol", () => {
  it("what_bug_this_catches: a new run id cannot reset a used corpus/config look", () => {
    const look: Look = { action: "authorize", run_id: "one", lock_sha256: "a", corpus_sha256: "c", config_sha256: "f", at: "2026-10-27T00:00:00Z" };
    expect(() => authorizeLook([look], { ...look, run_id: "two", lock_sha256: "b" })).toThrow();
  });
  it("what_bug_this_catches: nested pending lock fields must refuse", () => expect(() => rejectNull({ reviewers: { A: { model_id: null } } })).toThrow("model_id"));
  it("what_bug_this_catches: one-byte input drift cannot reuse the same lock", () => {
    const hash = sha256Hex("abc");
    const lock = { schema: "run-lock/v1", model_lock: { status: "locked", requires: [], reviewers: { A: testLock("openai"), B: testLock("anthropic") } }, inputs: { "input.txt": hash }, corpus_sha256: hash, config_sha256: hash, presentation_seed: 4104, sandbox_qualified: true, sandbox_image: `image@sha256:${hash}`, probe_path: "probe.json", stage_grant_path: "grant.json", dirty_mode: false, stage: "A", stage_grant_sha256: hash };
    expect(validateLock(lock, { "input.txt": "abc" }).inputs["input.txt"]).toBe(hash);
    expect(() => validateLock(lock, { "input.txt": "abd" })).toThrow("drift");
  });
  it("what_bug_this_catches: exact qualification boundaries are stops", () => {
    expect(qualifyDev(0.1, 0, 10)).toBe(false); expect(qualifyDev(0.9, 0, 10)).toBe(false);
    expect(qualifyDev(0.5, 16, 100)).toBe(false); expect(qualifyDev(0.5, 15, 100)).toBe(true);
  });
  it("what_bug_this_catches: admission cannot consume receipts verified under another grant", () => {
    expect(() => verifySummary({ schema: "corpus-verify-summary/v1", split: "heldout", roy_grant: { sha256: "other" }, receipts_sha256: "r", tasks: [] }, "g", ["r", "r"])).toThrow();
    expect(GATE_MEANINGS.G1).toBe("rights"); expect(GATE_MEANINGS.G6).toBe("validation"); expect(GATE_MEANINGS.G7).toBe("leakage"); expect(GATE_MEANINGS.G8).toBe("difficulty_dev_only");
  });
});
