// Written, never run in Dirty Mode. OpenAI Responses request builder + parser, and the shared completion flow
// (lock checks before send, no retry, transport failure phases, billing never inferred, HTTP-error billing rule:
// rejected_unbilled only for 400/401/403/404/413/422/429 with the provider's own usage-free error object).
import { describe, expect, it } from "vitest";
import {
  buildOpenAIResponsesRequest,
  createOpenAIResponsesProvider,
  isOpenAIErrorObject,
  parseOpenAIResponsesBody,
} from "../../../src/core/providers/openai_responses.ts";
import { fixtureBodyText } from "../../../src/core/providers/mock.ts";
import {
  LockMismatchError,
  REJECTED_UNBILLED_HTTP_STATUSES,
  TransportError,
  carriesUsage,
  httpErrorBilling,
  type HttpRequest,
  type Transport,
} from "../../../src/core/providers/port.ts";
import { resolveReviewResult } from "../../../src/core/reviewjudge/response.ts";
import { FIXTURE_HEAD_FILES, OPENAI_TEST_MODEL, loadFixture, testLock, testRequest } from "./helpers.ts";

function recordingTransport(status: number, bodyText: string): { transport: Transport; calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  return {
    calls,
    transport: async (req) => {
      calls.push(req);
      return { status, bodyText };
    },
  };
}

describe("request builder", () => {
  it("builds a Responses API request: high effort, cap from lock, no tools, no history, no credential", () => {
    const req = buildOpenAIResponsesRequest(testRequest(testLock("openai")));
    expect(req.url).toBe("https://api.openai.com/v1/responses");
    expect(req.method).toBe("POST");
    expect(req.auth).toBe("bearer");
    expect(Object.keys(req.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body.model).toBe(OPENAI_TEST_MODEL);
    expect(body.instructions).toContain("You are reviewing one proposed code change");
    expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "Change c_0123456789\n(body)" }] }]);
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.max_output_tokens).toBe(8000);
    expect(body.store).toBe(false);
    expect(body.stream).toBe(false);
    for (const absent of ["tools", "tool_choice", "previous_response_id", "temperature", "top_p", "messages"]) expect(body).not.toHaveProperty(absent);
  });

  it("honours a base URL override without a trailing slash problem", () => {
    expect(buildOpenAIResponsesRequest(testRequest(testLock("openai")), "http://127.0.0.1:9/").url).toBe("http://127.0.0.1:9/v1/responses");
  });
});

describe("parser", () => {
  it("separates answer text from reasoning summaries and reads reasoning usage", () => {
    const p = parseOpenAIResponsesBody(loadFixture("openai_reasoning_usage").body);
    expect(p.text).toBe('{"verdict":"approve","findings":[]}');
    expect(p.reasoningText).toBe("Checked the loop bounds against the specification.");
    expect(p.usage).toEqual({ inputTokens: 1376, cachedInputTokens: 1024, cacheWriteInputTokens: null, outputTokens: 3100, reasoningTokens: 2600 });
    expect(p.stopKind).toBe("complete");
  });

  it("incomplete: max_output_tokens -> truncated; content_filter -> refusal", () => {
    expect(parseOpenAIResponsesBody(loadFixture("openai_truncated").body).stopKind).toBe("truncated");
    expect(parseOpenAIResponsesBody({ status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] }).stopKind).toBe("refusal");
  });

  it("a refusal content part is a refusal", () => {
    const p = parseOpenAIResponsesBody(loadFixture("openai_refusal").body);
    expect(p.stopKind).toBe("refusal");
    expect(p.text).toBeNull();
  });

  it("failed status or an error object is a provider error", () => {
    expect(parseOpenAIResponsesBody({ status: "failed", error: { message: "server" } }).outcome).toBe("provider_error");
    expect(parseOpenAIResponsesBody({ status: "in_progress" }).outcome).toBe("provider_error");
  });

  it("missing or malformed usage is null (billing unknown), never zero", () => {
    expect(parseOpenAIResponsesBody({ status: "completed", output: [] }).usage).toBeNull();
    expect(parseOpenAIResponsesBody({ status: "completed", output: [], usage: { input_tokens: 10 } }).usage).toBeNull();
    expect(parseOpenAIResponsesBody({ status: "completed", output: [], usage: { input_tokens: 10, output_tokens: -1 } }).usage).toBeNull();
    expect(
      parseOpenAIResponsesBody({ status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 5, output_tokens_details: { reasoning_tokens: 6 } } }).usage,
    ).toBeNull();
  });

  it("an unexpected output item (e.g. a tool call) is stop kind other", () => {
    expect(parseOpenAIResponsesBody({ status: "completed", output: [{ type: "function_call" }] }).stopKind).toBe("other");
  });
});

describe("completion flow", () => {
  it("returns a reported-billing envelope with identity match for the text fixture", async () => {
    const { transport, calls } = recordingTransport(200, fixtureBodyText(loadFixture("openai_text")));
    const env = await createOpenAIResponsesProvider(transport).complete(testRequest(testLock("openai")));
    expect(calls).toHaveLength(1);
    expect(env.identity).toBe("match");
    expect(env.billing).toBe("reported");
    expect(env.mock).toBe(false);
    expect(env.requestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveReviewResult(env, FIXTURE_HEAD_FILES).status).toBe("valid");
  });

  it("refuses before sending when the system prompt differs from the lock or the lock is incomplete", async () => {
    const { transport, calls } = recordingTransport(200, "{}");
    const provider = createOpenAIResponsesProvider(transport);
    await expect(provider.complete({ ...testRequest(testLock("openai")), systemPrompt: "changed" })).rejects.toThrow(LockMismatchError);
    await expect(provider.complete(testRequest({ ...testLock("openai"), model_id: null } as never))).rejects.toThrow(LockMismatchError);
    await expect(provider.complete(testRequest(testLock("openai", { effort: "low" } as never)))).rejects.toThrow(LockMismatchError);
    await expect(provider.complete(testRequest(testLock("anthropic")))).rejects.toThrow(LockMismatchError);
    expect(calls).toHaveLength(0);
  });

  it("a reported model other than the lock is an identity mismatch", async () => {
    const body = { ...(loadFixture("openai_text").body as object), model: "some-other-model" };
    const { transport } = recordingTransport(200, JSON.stringify(body));
    const env = await createOpenAIResponsesProvider(transport).complete(testRequest(testLock("openai")));
    expect(env.identity).toBe("mismatch");
    expect(resolveReviewResult(env, FIXTURE_HEAD_FILES).status).toBe("identity_mismatch");
  });

  it("an unreported model is an identity mismatch too (fail closed)", async () => {
    const body = { ...(loadFixture("openai_text").body as Record<string, unknown>) };
    delete body.model;
    const { transport } = recordingTransport(200, JSON.stringify(body));
    const env = await createOpenAIResponsesProvider(transport).complete(testRequest(testLock("openai")));
    expect(env.identity).toBe("unreported");
    expect(resolveReviewResult(env, FIXTURE_HEAD_FILES).status).toBe("identity_mismatch");
  });

  const openAIError = JSON.stringify({ error: { message: "nope", type: "invalid_request_error", param: null, code: null } });

  it("4xx rejections with OpenAI's own error object and no usage are rejected_unbilled, sent once, never pre-send", async () => {
    for (const status of [400, 401, 403, 404, 413, 422, 429]) {
      const { transport, calls } = recordingTransport(status, openAIError);
      const env = await createOpenAIResponsesProvider(transport).complete(testRequest(testLock("openai")));
      expect(calls).toHaveLength(1);
      expect(env.outcome).toBe("provider_error");
      expect(env.billing, String(status)).toBe("rejected_unbilled");
      expect(env.preSendFailure).toBe(false);
      expect(env.rateLimited).toBe(status === 429);
      expect(env.httpStatus).toBe(status);
      expect(env.usage).toBeNull();
      expect(resolveReviewResult(env, FIXTURE_HEAD_FILES).status).toBe("provider_error");
    }
  });

  it("408, 5xx (incl. 529) and any other non-2xx status are billing unknown even with the error object", async () => {
    for (const status of [408, 500, 502, 503, 504, 529, 402, 409, 302]) {
      const { transport, calls } = recordingTransport(status, openAIError);
      const env = await createOpenAIResponsesProvider(transport).complete(testRequest(testLock("openai")));
      expect(calls).toHaveLength(1);
      expect(env.outcome).toBe("provider_error");
      expect(env.billing, String(status)).toBe("unknown");
      expect(env.preSendFailure).toBe(false);
      expect(env.rateLimited).toBe(false);
    }
  });

  it("a rejected status is billing unknown for a non-JSON body, a body that is not OpenAI's error object, or one carrying usage", async () => {
    const bodies = [
      "<html>429 Too Many Requests</html>",
      JSON.stringify({ message: "nope" }),
      JSON.stringify({ error: "nope" }),
      JSON.stringify({ error: { type: "invalid_request_error" } }),
      JSON.stringify({ error: { message: "nope" }, id: "resp_1" }),
      JSON.stringify({ error: { message: "nope" }, usage: { input_tokens: 10, output_tokens: 0 } }),
      JSON.stringify({ error: { message: "nope", usage: { input_tokens: 10, output_tokens: 0 } } }),
      JSON.stringify({ error: { message: "nope", output_tokens: 3 } }),
      JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "nope" } }), // Anthropic's shape
    ];
    for (const bodyText of bodies) {
      const { transport, calls } = recordingTransport(429, bodyText);
      const env = await createOpenAIResponsesProvider(transport).complete(testRequest(testLock("openai")));
      expect(calls).toHaveLength(1);
      expect(env.billing, bodyText).toBe("unknown");
      expect(env.outcome).toBe("provider_error");
      expect(env.preSendFailure).toBe(false);
      expect(env.rateLimited).toBe(true); // still a 429: M4 sees the rate limit, and K24 stops on the unknown billing
    }
  });

  it("isOpenAIErrorObject, carriesUsage and httpErrorBilling agree with the rule", () => {
    expect(isOpenAIErrorObject(JSON.parse(openAIError))).toBe(true);
    expect(isOpenAIErrorObject({ error: { message: "x" } })).toBe(true);
    expect(isOpenAIErrorObject([{ error: { message: "x" } }])).toBe(false);
    expect(carriesUsage({ a: [{ b: { usage: null } }] })).toBe(true);
    expect(carriesUsage({ error: { param: "max_output_tokens" } })).toBe(false); // a value, not a key
    expect(httpErrorBilling(429, { error: { message: "x" } }, { isErrorObject: isOpenAIErrorObject })).toEqual({ billing: "rejected_unbilled", unknownBecause: null });
    expect(httpErrorBilling(503, { error: { message: "x" } }, { isErrorObject: isOpenAIErrorObject }).billing).toBe("unknown");
    expect(REJECTED_UNBILLED_HTTP_STATUSES).toEqual([400, 401, 403, 404, 413, 422, 429]);
  });

  it("a 2xx body is never rate limited and keeps billing from usage", async () => {
    const { transport } = recordingTransport(200, fixtureBodyText(loadFixture("openai_text")));
    const env = await createOpenAIResponsesProvider(transport).complete(testRequest(testLock("openai")));
    expect([env.rateLimited, env.preSendFailure, env.billing]).toEqual([false, false, "reported"]);
  });

  it("transport failures: pre_send -> not_sent; timeout -> timeout; anything else -> unknown", async () => {
    const failing = (error: unknown): Transport => async () => Promise.reject(error);
    const pre = await createOpenAIResponsesProvider(failing(new TransportError("pre_send", "ECONNREFUSED"))).complete(testRequest(testLock("openai")));
    expect([pre.outcome, pre.preSendFailure, pre.billing, pre.rateLimited]).toEqual(["provider_error", true, "not_sent", false]);
    const timeout = await createOpenAIResponsesProvider(failing(new TransportError("timeout", "deadline"))).complete(testRequest(testLock("openai")));
    expect([timeout.outcome, timeout.billing]).toEqual(["timeout", "unknown"]);
    expect(resolveReviewResult(timeout, FIXTURE_HEAD_FILES).status).toBe("timeout");
    const other = await createOpenAIResponsesProvider(failing(new Error("socket hang up"))).complete(testRequest(testLock("openai")));
    expect([other.outcome, other.preSendFailure, other.billing]).toEqual(["transport_unknown", false, "unknown"]);
    expect(resolveReviewResult(other, FIXTURE_HEAD_FILES).status).toBe("unknown");
  });
});
