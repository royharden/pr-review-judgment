// OpenAI Responses API adapter (PLAN K12): request builder + response parser. Pure; no network in M3.
//
// Request (POST {baseUrl}/v1/responses, auth "Authorization: Bearer", added by the host transport):
//   { model, instructions: <system prompt>, input: [{ role: "user", content: [{ type: "input_text", text }] }],
//     reasoning: { effort: "high" }, max_output_tokens: <lock cap>, store: false, stream: false,
//     truncation: "disabled" }
// - tools off: no `tools` field is sent at all; no history: no `previous_response_id`, `store: false`.
// - `max_output_tokens` caps visible output AND reasoning together (PLAN §6: cap includes reasoning).
// Response parsing (untrusted JSON):
// - text = concatenated `output_text` parts of `message` items; reasoning summaries (`reasoning` items) are kept
//   apart in reasoningText and never parsed as the answer;
// - a `refusal` content part, or `status: "incomplete"` with reason `content_filter` -> refusal;
//   `status: "incomplete"` with reason `max_output_tokens` -> truncated; `status: "failed"` or an `error` -> provider
//   error; any other non-`completed` status -> provider error;
// - usage: input_tokens, input_tokens_details.cached_tokens, output_tokens (includes reasoning),
//   output_tokens_details.reasoning_tokens. Usage with missing or non-integer counts is `null` (billing unknown).
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

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com";
export const OPENAI_RESPONSES_PATH = "/v1/responses";

export function buildOpenAIResponsesRequest(request: ReviewRequest, baseUrl = OPENAI_DEFAULT_BASE_URL): HttpRequest {
  const { lock } = request;
  const body = {
    model: lock.model_id,
    instructions: request.systemPrompt,
    input: [{ role: "user", content: [{ type: "input_text", text: request.userPrompt }] }],
    reasoning: { effort: lock.effort },
    max_output_tokens: lock.output_cap_tokens,
    store: false,
    stream: false,
    truncation: "disabled",
  };
  return {
    url: `${baseUrl.replace(/\/+$/, "")}${OPENAI_RESPONSES_PATH}`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    auth: "bearer",
  };
}

function parseUsage(raw: unknown): Usage | null {
  if (raw === undefined || raw === null) return null;
  const usage = asRecord(raw);
  const input = asCount(usage.input_tokens);
  const output = asCount(usage.output_tokens);
  if (input === null || output === null) return null;
  const inputDetails = asRecord(usage.input_tokens_details);
  const outputDetails = asRecord(usage.output_tokens_details);
  const cached = inputDetails.cached_tokens === undefined ? 0 : asCount(inputDetails.cached_tokens);
  const reasoning = outputDetails.reasoning_tokens === undefined ? null : asCount(outputDetails.reasoning_tokens);
  if (cached === null) return null; // present but malformed
  if (outputDetails.reasoning_tokens !== undefined && reasoning === null) return null;
  if (reasoning !== null && reasoning > output) return null; // reasoning is counted inside output
  if (cached > input) return null;
  return {
    inputTokens: input - cached,
    cachedInputTokens: cached,
    cacheWriteInputTokens: null,
    outputTokens: output,
    reasoningTokens: reasoning,
  };
}

export function parseOpenAIResponsesBody(body: unknown): ParsedProviderBody {
  const r = asRecord(body);
  const reportedModel = asString(r.model);
  const responseId = asString(r.id);
  const usage = parseUsage(r.usage);
  const status = asString(r.status);

  const texts: string[] = [];
  const reasoning: string[] = [];
  const unexpected: string[] = [];
  let refusalText: string | null = null;
  const output = Array.isArray(r.output) ? r.output : [];
  for (const itemRaw of output) {
    const item = asRecord(itemRaw);
    if (item.type === "reasoning") {
      const summary = Array.isArray(item.summary) ? item.summary : [];
      for (const partRaw of summary) {
        const text = asString(asRecord(partRaw).text);
        if (text !== null && text.length > 0) reasoning.push(text);
      }
      continue;
    }
    if (item.type === "message") {
      const content = Array.isArray(item.content) ? item.content : [];
      for (const partRaw of content) {
        const part = asRecord(partRaw);
        if (part.type === "output_text") {
          const text = asString(part.text);
          if (text !== null) texts.push(text);
        } else if (part.type === "refusal") {
          refusalText = asString(part.refusal) ?? "";
        } else {
          unexpected.push(`message part ${String(part.type)}`);
        }
      }
      continue;
    }
    unexpected.push(`output item ${String(item.type)}`);
  }

  const common = {
    text: texts.length > 0 ? texts.join("") : null,
    reasoningText: reasoning.length > 0 ? reasoning.join("\n") : null,
    usage,
    reportedModel,
    responseId,
    servedByOtherModel: false,
  };

  const errorMessage = r.error === null || r.error === undefined ? null : errorMessageOf(body) ?? "error object present";
  if (status === "failed" || errorMessage !== null) {
    return { ...common, outcome: "provider_error", stopKind: null, stopReasonRaw: status, detail: `response failed: ${errorMessage ?? "no message"}` };
  }

  let stopKind: StopKind;
  let stopReasonRaw: string | null = status;
  let detail: string | null = unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : null;
  if (status === "completed") {
    stopKind = refusalText !== null ? "refusal" : unexpected.length > 0 ? "other" : "complete";
    if (refusalText !== null) detail = `refusal: ${refusalText}`;
  } else if (status === "incomplete") {
    const reason = asString(asRecord(r.incomplete_details).reason);
    stopReasonRaw = `incomplete:${reason ?? "unknown"}`;
    stopKind = reason === "max_output_tokens" ? "truncated" : reason === "content_filter" ? "refusal" : "other";
  } else {
    return { ...common, outcome: "provider_error", stopKind: null, stopReasonRaw: status, detail: `non-terminal or unknown status ${status ?? "missing"}` };
  }
  return { ...common, outcome: "completed", stopKind, stopReasonRaw, detail };
}

/**
 * The documented OpenAI error body, exactly: `{ "error": { "message": string, "type"?, "param"?, "code"? } }` with no
 * other top-level key. Anything else on a non-2xx is billing unknown (port.ts). Shape unverified live (DV-24).
 */
export function isOpenAIErrorObject(body: unknown): boolean {
  if (!isJsonObject(body)) return false;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "error") return false;
  const error = body.error;
  return isJsonObject(error) && typeof error.message === "string";
}

export const openAIResponsesAdapter: ProviderAdapter = {
  provider: "openai",
  api: "responses",
  buildRequest: (request) => buildOpenAIResponsesRequest(request),
  parseBody: parseOpenAIResponsesBody,
  isErrorObject: isOpenAIErrorObject,
};

export function openAIAdapterWithBaseUrl(baseUrl: string): ProviderAdapter {
  return { ...openAIResponsesAdapter, buildRequest: (request) => buildOpenAIResponsesRequest(request, baseUrl) };
}

export function createOpenAIResponsesProvider(transport: Transport, baseUrl = OPENAI_DEFAULT_BASE_URL): Provider {
  return createProvider(openAIAdapterWithBaseUrl(baseUrl), transport);
}
