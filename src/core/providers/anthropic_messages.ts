// Anthropic Messages API adapter: request builder + response parser. Pure; no network in M3; raw HTTP, no SDK
// (PLAN §3.7: plain injected fetch, so no SDK-side retries exist by construction).
//
// Request (POST {baseUrl}/v1/messages, auth "x-api-key" added by the host transport, header
// `anthropic-version: <lock.api_version>`):
//   { model, max_tokens: <lock cap>, system: <system prompt>, messages: [{ role: "user", content: <user prompt> }],
//     thinking: { type: "adaptive" }, output_config: { effort: "high" }, stream: false }
// - effort lives in `output_config.effort`; thinking is adaptive (current models reject fixed thinking budgets and,
//   on some, disabling thinking); `max_tokens` caps thinking AND text together (PLAN §6).
// - tools off: no `tools`/`tool_choice`; no history: a single user turn; no sampling parameters; no prompt caching
//   markers; no `fallbacks` parameter (a refusal must stay a refusal, and a different serving model would break
//   the same-model definition, so any fallback evidence in a response is an identity mismatch).
// Response parsing (untrusted JSON):
// - text = concatenated `text` blocks; `thinking` blocks (often empty text by default) go to reasoningText;
//   `redacted_thinking` is counted; a `fallback` block or a `fallback_message` usage iteration marks another model;
// - stop_reason: end_turn -> complete; max_tokens and model_context_window_exceeded -> truncated; refusal -> refusal
//   (stop_details.category recorded); anything else (tool_use, pause_turn, stop_sequence, unknown) -> other;
// - usage: input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens (thinking is billed
//   inside output_tokens and not reported separately, so reasoningTokens is null).
// The exact live response shape has not been checked against the API in Dirty Mode (DEFERRED-VALIDATION).
import {
  asCount,
  asRecord,
  asString,
  createProvider,
  errorMessageOf,
  isJsonObject,
  type HttpRequest,
  type ParsedProviderBody,
  type Provider,
  type ProviderAdapter,
  type ReviewRequest,
  type StopKind,
  type Transport,
  type Usage,
} from "./port.ts";

export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_MESSAGES_PATH = "/v1/messages";

export function buildAnthropicMessagesRequest(request: ReviewRequest, baseUrl = ANTHROPIC_DEFAULT_BASE_URL): HttpRequest {
  const { lock } = request;
  const body = {
    model: lock.model_id,
    max_tokens: lock.output_cap_tokens,
    system: request.systemPrompt,
    messages: [{ role: "user", content: request.userPrompt }],
    thinking: { type: "adaptive" },
    output_config: { effort: lock.effort },
    stream: false,
  };
  return {
    url: `${baseUrl.replace(/\/+$/, "")}${ANTHROPIC_MESSAGES_PATH}`,
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": lock.api_version },
    body: JSON.stringify(body),
    auth: "x-api-key",
  };
}

function parseUsage(raw: unknown): Usage | null {
  if (raw === undefined || raw === null) return null;
  const usage = asRecord(raw);
  const input = asCount(usage.input_tokens);
  const output = asCount(usage.output_tokens);
  if (input === null || output === null) return null;
  const read = usage.cache_read_input_tokens === undefined || usage.cache_read_input_tokens === null ? 0 : asCount(usage.cache_read_input_tokens);
  const write =
    usage.cache_creation_input_tokens === undefined || usage.cache_creation_input_tokens === null ? 0 : asCount(usage.cache_creation_input_tokens);
  if (read === null || write === null) return null;
  return { inputTokens: input, cachedInputTokens: read, cacheWriteInputTokens: write, outputTokens: output, reasoningTokens: null };
}

const STOP_KINDS: Readonly<Record<string, StopKind>> = {
  end_turn: "complete",
  max_tokens: "truncated",
  model_context_window_exceeded: "truncated",
  refusal: "refusal",
};

export function parseAnthropicMessagesBody(body: unknown): ParsedProviderBody {
  const r = asRecord(body);
  const reportedModel = asString(r.model);
  const responseId = asString(r.id);
  const usageRecord = asRecord(r.usage);
  const usage = parseUsage(r.usage);
  const iterations = Array.isArray(usageRecord.iterations) ? usageRecord.iterations : [];
  let servedByOtherModel = iterations.some((it) => asRecord(it).type === "fallback_message");

  if (r.type === "error") {
    return {
      outcome: "provider_error",
      text: null,
      reasoningText: null,
      stopKind: null,
      stopReasonRaw: null,
      usage,
      reportedModel,
      responseId,
      servedByOtherModel,
      detail: `error body: ${errorMessageOf(body) ?? "no message"}`,
    };
  }

  const texts: string[] = [];
  const thoughts: string[] = [];
  const unexpected: string[] = [];
  let redacted = 0;
  const content = Array.isArray(r.content) ? r.content : [];
  for (const blockRaw of content) {
    const block = asRecord(blockRaw);
    if (block.type === "text") {
      const text = asString(block.text);
      if (text !== null) texts.push(text);
    } else if (block.type === "thinking") {
      const thinking = asString(block.thinking);
      if (thinking !== null && thinking.length > 0) thoughts.push(thinking);
    } else if (block.type === "redacted_thinking") {
      redacted++;
    } else if (block.type === "fallback") {
      servedByOtherModel = true;
    } else {
      unexpected.push(String(block.type));
    }
  }

  const stopReasonRaw = asString(r.stop_reason);
  let stopKind: StopKind = stopReasonRaw === null ? "other" : (STOP_KINDS[stopReasonRaw] ?? "other");
  if (stopKind === "complete" && unexpected.length > 0) stopKind = "other";
  const notes: string[] = [];
  if (stopKind === "refusal") {
    const category = asString(asRecord(r.stop_details).category);
    notes.push(`refusal category: ${category ?? "null"}`);
  }
  if (redacted > 0) notes.push(`${redacted} redacted_thinking block(s)`);
  if (unexpected.length > 0) notes.push(`unexpected blocks: ${unexpected.join(", ")}`);
  if (stopReasonRaw === null) notes.push("missing stop_reason");

  return {
    outcome: "completed",
    text: texts.length > 0 ? texts.join("") : null,
    reasoningText: thoughts.length > 0 ? thoughts.join("\n") : null,
    stopKind,
    stopReasonRaw,
    usage,
    reportedModel,
    responseId,
    servedByOtherModel,
    detail: notes.length > 0 ? notes.join("; ") : null,
  };
}

const ANTHROPIC_ERROR_KEYS: ReadonlySet<string> = new Set(["type", "error", "request_id"]);

/**
 * The documented Anthropic error body, exactly: `{ "type": "error", "error": { "type": string, "message": string },
 * "request_id"?: string }` with no other top-level key. Anything else on a non-2xx is billing unknown (port.ts).
 * Shape unverified live (DV-24).
 */
export function isAnthropicErrorObject(body: unknown): boolean {
  if (!isJsonObject(body) || body.type !== "error") return false;
  if (!Object.keys(body).every((key) => ANTHROPIC_ERROR_KEYS.has(key))) return false;
  if (body.request_id !== undefined && typeof body.request_id !== "string") return false;
  const error = body.error;
  return isJsonObject(error) && typeof error.type === "string" && typeof error.message === "string";
}

export const anthropicMessagesAdapter: ProviderAdapter = {
  provider: "anthropic",
  api: "messages",
  buildRequest: (request) => buildAnthropicMessagesRequest(request),
  parseBody: parseAnthropicMessagesBody,
  isErrorObject: isAnthropicErrorObject,
};

export function createAnthropicMessagesProvider(transport: Transport, baseUrl = ANTHROPIC_DEFAULT_BASE_URL): Provider {
  return createProvider({ ...anthropicMessagesAdapter, buildRequest: (request) => buildAnthropicMessagesRequest(request, baseUrl) }, transport);
}
