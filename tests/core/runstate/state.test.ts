import { describe, it, expect } from "vitest";
import { newSlot, recover, transition, retryDecision } from "../../../src/core/runstate/index.ts";
import type { ReviewEnvelope } from "../../../src/core/providers/port.ts";
describe("run crash and replay safety", () => {
  it("what_bug_this_catches: reservation before a crash cannot be assumed unbilled", () => {
    const reserved = transition(newSlot("s1"), "reserved");
    expect(recover(reserved).state).toBe("unknown");
    expect(recover(reserved, true).state).toBe("failed_pre_send");
    expect(() => transition(recover(reserved), "planned")).toThrow();
  });
  it("what_bug_this_catches: a reported HTTP response cannot silently trigger a repair retry", () => {
    const envelope = { billing: "reported", preSendFailure: false, rateLimited: false, outcome: "completed", identity: "match" } as ReviewEnvelope;
    expect(retryDecision(newSlot("s"), envelope)).toBe("done");
    expect(retryDecision({ ...newSlot("s"), rate_limit_backoffs: 1 }, { ...envelope, billing: "rejected_unbilled", rateLimited: true })).toBe("stop");
    expect(retryDecision(newSlot("s"), { ...envelope, billing: "unknown", rateLimited: true })).toBe("stop");
  });
  it("what_bug_this_catches: settled and sent slots are never ordinarily reissued", () => {
    const sent = transition(transition(newSlot("s"), "reserved"), "sent");
    expect(() => transition(sent, "planned")).toThrow();
    expect(() => transition(transition(sent, "settled"), "planned")).toThrow();
  });
});
