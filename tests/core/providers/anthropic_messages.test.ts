// Written, never run in Dirty Mode. Anthropic Messages request builder + parser, and the HTTP-error billing rule on
// Anthropic's error shape (429/400 rejected_unbilled; 529 overloaded, 5xx, 408 unknown).
import { describe, expect, it } from "vitest";
import {
  buildAnthropicMessagesRequest,
  createAnthropicMessagesProvider,
  isAnthropicErrorObject,
  parseAnthropicMessagesBody,
} from "../../../src/core/providers/anthropic_messages.ts";
import type { Transport } from "../../../src/core/providers/port.ts";
import { resolveReviewResult } from "../../../src/core/reviewjudge/response.ts";
import { ANTHROPIC_TEST_MODEL, FIXTURE_HEAD_FILES, loadFixture, testLock, testRequest } from "./helpers.ts";

const replay = (body: unknown, status = 200): Transport => async () => ({ status, bodyText: JSON.stringify(body) });

describe("request builder", () => {
  it("builds a Messages request: adaptive thinking, high effort, cap from lock, single user turn, no tools", () => {
    const req = buildAnthropicMessagesRequest(testRequest(testLock("anthropic")));
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.auth).toBe("x-api-key");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(Object.keys(req.headers).map((h) => h.toLowerCase())).not.toContain("x-api-key");
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body.model).toBe(ANTHROPIC_TEST_MODEL);
    expect(body.max_tokens).toBe(8000);
    expect(body.system).toContain("You are reviewing one proposed code change");
    expect(body.messages).toEqual([{ role: "user", content: "Change c_0123456789\n(body)" }]);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
    for (const absent of ["tools", "tool_choice", "temperature", "top_p", "top_k", "fallbacks", "cache_control"]) expect(body).not.toHaveProperty(absent);
  });
});

describe("parser", () => {
  it("keeps thinking apart from the answer text", () => {
    const p = parseAnthropicMessagesBody(loadFixture("anthropic_thinking").body);
    expect(p.reasoningText).toBe("The bound on line 12 excludes the last slot.");
    expect(p.text!.startsWith('{"verdict":"request_changes"')).toBe(true);
    expect(p.text).not.toContain("excludes the last slot");
    expect(p.usage).toEqual({ inputTokens: 1900, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 2750, reasoningTokens: null });
  });

  it("maps stop reasons", () => {
    const stop = (stop_reason: string) => parseAnthropicMessagesBody({ type: "message", content: [{ type: "text", text: "{}" }], stop_reason }).stopKind;
    expect(stop("end_turn")).toBe("complete");
    expect(stop("max_tokens")).toBe("truncated");
    expect(stop("model_context_window_exceeded")).toBe("truncated");
    expect(stop("refusal")).toBe("refusal");
    expect(stop("tool_use")).toBe("other");
    expect(stop("pause_turn")).toBe("other");
    expect(stop("something_new")).toBe("other");
  });

  it("records the refusal category", () => {
    const p = parseAnthropicMessagesBody(loadFixture("anthropic_refusal").body);
    expect(p.stopKind).toBe("refusal");
    expect(p.detail).toContain("cyber");
  });

  it("an error body is a provider error", () => {
    expect(parseAnthropicMessagesBody({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }).outcome).toBe("provider_error");
  });

  it("missing or malformed usage is null", () => {
    expect(parseAnthropicMessagesBody({ type: "message", content: [], stop_reason: "end_turn" }).usage).toBeNull();
    expect(parseAnthropicMessagesBody({ type: "message", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: "x" } }).usage).toBeNull();
  });

  it("fallback evidence marks another serving model", () => {
    expect(parseAnthropicMessagesBody({ type: "message", content: [{ type: "fallback" }], stop_reason: "end_turn" }).servedByOtherModel).toBe(true);
    expect(
      parseAnthropicMessagesBody({ type: "message", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1, iterations: [{ type: "fallback_message" }] } })
        .servedByOtherModel,
    ).toBe(true);
  });
});

describe("completion flow", () => {
  it("text fixture -> valid review", async () => {
    const env = await createAnthropicMessagesProvider(replay(loadFixture("anthropic_text").body)).complete(testRequest(testLock("anthropic")));
    expect(env.identity).toBe("match");
    expect(env.billing).toBe("reported");
    expect(resolveReviewResult(env, FIXTURE_HEAD_FILES).status).toBe("valid");
  });

  const anthropicError = (type: string, message: string): Record<string, unknown> => ({ type: "error", error: { type, message }, request_id: "req_synthetic" });
  const send = (status: number, body: unknown) => createAnthropicMessagesProvider(replay(body, status)).complete(testRequest(testLock("anthropic")));

  it("429 rate_limit_error and 400 invalid_request_error error objects are rejected_unbilled; 529 overloaded and 500 are unknown", async () => {
    const limited = await send(429, anthropicError("rate_limit_error", "Rate limited"));
    expect([limited.outcome, limited.billing, limited.rateLimited, limited.preSendFailure]).toEqual(["provider_error", "rejected_unbilled", true, false]);
    const invalid = await send(400, anthropicError("invalid_request_error", "max_tokens: too large"));
    expect([invalid.billing, invalid.rateLimited, invalid.preSendFailure]).toEqual(["rejected_unbilled", false, false]);
    const overloaded = await send(529, anthropicError("overloaded_error", "Overloaded"));
    expect([overloaded.outcome, overloaded.billing, overloaded.rateLimited, overloaded.preSendFailure]).toEqual(["provider_error", "unknown", false, false]);
    expect((await send(500, anthropicError("api_error", "Internal"))).billing).toBe("unknown");
    expect((await send(408, anthropicError("timeout_error", "Timeout"))).billing).toBe("unknown");
    for (const env of [limited, invalid, overloaded]) expect(resolveReviewResult(env, FIXTURE_HEAD_FILES).status).toBe("provider_error");
  });

  it("a rejected status is billing unknown when the error body carries usage or is not Anthropic's error object", async () => {
    const withUsage = { type: "error", error: { type: "invalid_request_error", message: "x", usage: { input_tokens: 5, output_tokens: 0 } } };
    expect((await send(400, withUsage)).billing).toBe("unknown");
    expect((await send(429, { error: { message: "x" } })).billing).toBe("unknown"); // OpenAI's shape
    expect((await send(429, { ...anthropicError("rate_limit_error", "x"), retry_after: 3 })).billing).toBe("unknown");
  });

  it("matches the Anthropic error object exactly", () => {
    expect(isAnthropicErrorObject(anthropicError("rate_limit_error", "x"))).toBe(true);
    expect(isAnthropicErrorObject({ type: "error", error: { type: "x", message: "y" } })).toBe(true); // request_id optional
    expect(isAnthropicErrorObject({ error: { type: "x", message: "y" } })).toBe(false);
    expect(isAnthropicErrorObject({ type: "error", error: { message: "y" } })).toBe(false);
    expect(isAnthropicErrorObject({ ...anthropicError("x", "y"), request_id: 7 })).toBe(false);
    expect(isAnthropicErrorObject({ ...anthropicError("x", "y"), usage: { input_tokens: 1, output_tokens: 0 } })).toBe(false);
  });

  it("a fallback-served response is an identity mismatch even if the model field matches", async () => {
    const body = { ...(loadFixture("anthropic_text").body as Record<string, unknown>), content: [{ type: "fallback" }, { type: "text", text: '{"verdict":"approve","findings":[]}' }] };
    const env = await createAnthropicMessagesProvider(replay(body)).complete(testRequest(testLock("anthropic")));
    expect(env.identity).toBe("mismatch");
    expect(resolveReviewResult(env, FIXTURE_HEAD_FILES).status).toBe("identity_mismatch");
  });
});
