// Written, never executed in Dirty Mode. Transport/status precedence must not repair or reinterpret replies.
import { describe, expect, it } from "vitest";
import { resolveReviewResult } from "../../../src/core/reviewjudge/response.ts";
import type { ReviewEnvelope } from "../../../src/core/providers/port.ts";

const bounds = [{ path: "src/a.ts", lineCount: 3 }];
const envelope: ReviewEnvelope = {
  schema: "review-envelope/v1", provider: "openai", api: "responses", slotId: "mock-slot", requestedModel: "locked",
  reportedModel: "locked", identity: "match", outcome: "completed", preSendFailure: false, httpStatus: 200,
  rateLimited: false, text: '{"verdict":"approve","findings":[]}', reasoningText: "not the answer",
  stopKind: "complete", stopReasonRaw: "complete", usage: null, billing: "unknown", responseId: "mock-response",
  requestSha256: "a".repeat(64), responseSha256: "b".repeat(64), mock: true, synthetic: true, detail: null,
};
const resolve = (patch: Partial<ReviewEnvelope>) => resolveReviewResult({ ...envelope, ...patch }, bounds);
describe("review response precedence", () => {
  it("parses answer text and preserves MOCK without reading reasoning", () => {
    expect(resolve({})).toEqual({ status: "valid", review: { verdict: "approve", findings: [] }, detail: null, mock: true });
    expect(resolve({ text: null }).status).toBe("schema_invalid");
  });
  it("transport/provider failures win over identity and stop reasons", () => {
    for (const [outcome, status] of [["timeout", "timeout"], ["transport_unknown", "unknown"], ["provider_error", "provider_error"]] as const) {
      expect(resolve({ outcome, identity: "mismatch", stopKind: "refusal" }).status).toBe(status);
    }
  });
  it("identity precedes refusal, which precedes parsing", () => {
    expect(resolve({ identity: "unreported", stopKind: "refusal" }).status).toBe("identity_mismatch");
    expect(resolve({ identity: "mismatch", stopKind: "truncated" }).status).toBe("identity_mismatch");
    expect(resolve({ stopKind: "refusal", text: "bad" }).status).toBe("refusal");
    expect(resolve({ stopKind: "truncated", text: "bad" }).status).toBe("truncated");
    expect(resolve({ stopKind: "other" }).status).toBe("provider_error");
  });
  it("does not repair malformed, fenced, extra-key or out-of-bounds JSON", () => {
    for (const text of ["{", "```json\n{}\n```", '{"verdict":"approve","findings":[],"extra":true}',
      '{"verdict":"request_changes","findings":[{"path":"src/a.ts","startLine":4,"endLine":4,"severity":"high","claim":"x","confidence":1,"disposition":"requires_change"}]}']) {
      const result = resolve({ text });
      expect(result.status).toBe("schema_invalid");
      expect(result.review).toBeNull();
    }
  });
});
