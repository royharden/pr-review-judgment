import { describe, it, expect } from "vitest";
import { reserve, worstCase, liability, usageCost, type Budget, type Attempt } from "../../../src/core/ledger/index.ts";
const budget: Budget = { enabled: true, approved_usd: 1, sub_caps: { stratum_a: { approved_usd: 0.1 }, stratum_b: { approved_usd: 0.9 }, preparation: { approved_usd: 0 } } };
const next = { id: "s.1", slot_id: "s", cap: "stratum_a" as const, reserved_usd: 0.104 };
describe("worst-case ledger", () => {
  it("what_bug_this_catches: aggregate headroom does not permit exceeding a stage cap", () => expect(() => reserve(budget, [], next)).toThrow("cap"));
  it("what_bug_this_catches: disabled committed budget cannot spend even under a positive ceiling", () => expect(() => reserve({ ...budget, enabled: false }, [], next)).toThrow("disabled"));
  it("what_bug_this_catches: unknown attempts retain reservations and stop future calls", () => {
    const unknown: Attempt = { ...next, state: "unknown", actual_usd: null };
    expect(liability(unknown)).toBe(0.104);
    expect(() => reserve(budget, [unknown], { ...next, id: "s.2" })).toThrow("unknown");
  });
  it("what_bug_this_catches: cache writes cannot make actual costs exceed a discounted reservation unnoticed", () => {
    expect(worstCase({ input_usd_per_mtok: 2, output_usd_per_mtok: 10 }, 12000, 8000)).toBe(0.104);
    expect(worstCase({ input_usd_per_mtok: 2, cache_write_usd_per_mtok: 4, output_usd_per_mtok: 10 }, 12000, 8000)).toBe(0.128);
    expect(usageCost({ inputTokens: 1, outputTokens: 1, cachedInputTokens: 10, cacheWriteInputTokens: null, reasoningTokens: 1 }, { input_usd_per_mtok: 2, output_usd_per_mtok: 10 })).toBeNull();
  });
});
