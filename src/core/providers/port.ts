// Provider port (PLAN §3.1, §3.7, §3.8, K12, M3 acceptance 9). Pure: no SDK, no fetch, no key.
//
// - A Provider turns one ReviewRequest (system prompt, rendered user prompt, locked reviewer config) into one
//   ReviewEnvelope. Exactly one HTTP request per call: there is NO retry, repair or backoff here (the single
//   preregistered transport retry on a confirmed pre-send failure belongs to the run-state machine, M4).
// - The HTTP transport is injected (a fetch-like function). The core builds an UNAUTHENTICATED request and names
//   the auth scheme; the host transport (cli/, M4) adds the credential header from the operator's process env. No API
//   key ever enters src/core.
// - Billing is never inferred from silence: an envelope says `billing: "reported"` only when the provider's usage
//   block was read with integer token counts. Missing or malformed usage, timeouts and unknown transport failures are
//   `billing: "unknown"` (never zero; the ledger keeps the reservation and the run stops, PLAN K24). Only a transport
//   failure the host confirms happened before any byte was sent is `not_sent`, and only that sets `preSendFailure`:
//   once request bytes were sent nothing is pre-send, so no HTTP status (4xx included) is ever transport-retried.
// - HTTP errors (non-2xx), all `outcome: "provider_error"` (review status provider_error):
//     `rejected_unbilled` (billing zero, reservation released) for 400/401/403/404/413/422/429 when the body is
//       exactly the provider's own JSON error object (adapter.isErrorObject) and carries no usage. ASSUMPTION, per
//       provider documentation and unverified: a request the provider rejects with such a body is not billed
//       (DEFERRED-VALIDATION DV-24).
//     `unknown` for everything else: 408, 5xx (incl. Anthropic 529 overloaded), any other non-2xx status, a
//       non-JSON body, a body that is not the provider's error object, or an error body carrying usage.
//   Every 429 also sets `rateLimited: true` so the run-state machine (M4) applies the one-backoff rule (PLAN §6
//   stops: rate limit after one backoff); a 429 with unknown billing is still a K24 stop.
// - Model identity is checked against the lock: the reported model must equal lock.model_id exactly; an unreported
//   model or a provider-side fallback to another model is a mismatch (fail closed).
// Design-informed by S40 `307835b` supabase/functions/run-task/portable/ (untrusted-JSON helpers, usage separate
// from answer parsing, cost never assumed). S40 targets Chat Completions; the OpenAI shape here is the Responses API.
import { z } from "zod";
import { Sha256Hex } from "../defectcorpus/schema.ts";
import { sha256Hex } from "../hash/sha256.ts";

export const ProviderId = z.enum(["openai", "anthropic"]);
export type ProviderId = z.infer<typeof ProviderId>;

export const ProviderApi = z.enum(["responses", "messages"]);
export type ProviderApi = z.infer<typeof ProviderApi>;

export const PROVIDER_API = { openai: "responses", anthropic: "messages" } as const satisfies Record<ProviderId, ProviderApi>;

/**
 * One reviewer's locked configuration (protocol/model-lock.json `reviewers.<X>` once Roy answers R2). Every field is
 * required and non-null; a null lock never reaches a provider. Same-model = byte-identical locked configuration
 * (PLAN §3.1).
 */
export const LockedReviewerSchema = z
  .strictObject({
    provider: ProviderId,
    api: ProviderApi,
    model_id: z.string().min(1),
    api_version: z.string().min(1),
    effort: z.literal("high"),
    tools: z.literal("off"),
    output_cap_tokens: z.number().int().min(1),
    system_prompt_sha256: Sha256Hex,
  })
  .refine((lock) => PROVIDER_API[lock.provider] === lock.api, { message: "api does not match provider" });
export type LockedReviewer = z.infer<typeof LockedReviewerSchema>;

export interface ReviewRequest {
  /** Run-state slot id; recorded in the envelope, never sent to the provider. */
  readonly slotId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly lock: LockedReviewer;
}

/** The credential header the host transport must add: `Authorization: Bearer` or `x-api-key`. */
export type AuthScheme = "bearer" | "x-api-key";

export interface HttpRequest {
  readonly url: string;
  readonly method: "POST";
  /** Never contains a credential. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly auth: AuthScheme;
}

export interface HttpResponse {
  readonly status: number;
  readonly bodyText: string;
}

/**
 * How a transport failed. `pre_send`: the host can PROVE nothing was sent (e.g. DNS failure, connection refused
 * before the request was written). `timeout`: the deadline passed after sending began. `unknown`: anything else,
 * including a crash after the request may have been sent (PLAN K11: no proof of no-send means unknown).
 */
export type TransportPhase = "pre_send" | "timeout" | "unknown";

export class TransportError extends Error {
  readonly phase: TransportPhase;
  constructor(phase: TransportPhase, message: string) {
    super(message);
    this.name = "TransportError";
    this.phase = phase;
  }
}

/** Injected HTTP transport (fetch-like). Must not retry; must throw TransportError on failure. */
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

/** Refused before sending: the request does not match its lock (locked-hash drift is a stop, PLAN §6). */
export class LockMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockMismatchError";
  }
}

export interface Usage {
  /** Billed input tokens not served from a cache. */
  readonly inputTokens: number;
  /** Cache-read input tokens (0 when reported as absent by a provider that always reports them; null if unknown). */
  readonly cachedInputTokens: number | null;
  /** Cache-write input tokens (Anthropic); null when the provider has no such field. */
  readonly cacheWriteInputTokens: number | null;
  /** All output tokens INCLUDING reasoning (both APIs count reasoning inside output). */
  readonly outputTokens: number;
  /** Reasoning tokens when separately reported (OpenAI); null when not reported (Anthropic folds them in). */
  readonly reasoningTokens: number | null;
}

/**
 * reported: usage read from the provider. unknown: may have been billed; keep the reservation (K24 stop).
 * not_sent: host-confirmed pre-send failure. rejected_unbilled: an HTTP 4xx rejection in REJECTED_UNBILLED_HTTP_STATUSES
 * whose body is the provider's own error object with no usage; billed zero under the DV-24 assumption.
 */
export type Billing = "reported" | "unknown" | "not_sent" | "rejected_unbilled";

/** Statuses at which a provider error-object body is a rejection before any generation (assumed unbilled, DV-24). */
export const REJECTED_UNBILLED_HTTP_STATUSES: readonly number[] = [400, 401, 403, 404, 413, 422, 429];
export const RATE_LIMITED_HTTP_STATUS = 429;

/** Transport/provider-level outcome; the review status (8 statuses) is derived from this in reviewjudge/response.ts. */
export type EnvelopeOutcome = "completed" | "timeout" | "provider_error" | "transport_unknown";

/** Why generation stopped, normalized. `other` covers stop reasons that are neither a finish, a cap nor a refusal. */
export type StopKind = "complete" | "truncated" | "refusal" | "other";

export type Identity = "match" | "mismatch" | "unreported";

export interface ReviewEnvelope {
  readonly schema: "review-envelope/v1";
  readonly provider: ProviderId;
  readonly api: ProviderApi;
  readonly slotId: string;
  readonly requestedModel: string;
  readonly reportedModel: string | null;
  readonly identity: Identity;
  readonly outcome: EnvelopeOutcome;
  /**
   * True only for a host-confirmed failure before any byte was sent (the single M4 transport retry). Never true once
   * request bytes were sent: every HTTP response, 4xx and 429 included, has false.
   */
  readonly preSendFailure: boolean;
  readonly httpStatus: number | null;
  /** HTTP 429: M4 applies the one-backoff rule; billing still decides the K24 stop. */
  readonly rateLimited: boolean;
  /** Final answer text only (never reasoning). null when the response carried no text. */
  readonly text: string | null;
  /** Reasoning summaries / thinking text when returned; kept apart from `text`. */
  readonly reasoningText: string | null;
  readonly stopKind: StopKind | null;
  readonly stopReasonRaw: string | null;
  readonly usage: Usage | null;
  readonly billing: Billing;
  readonly responseId: string | null;
  /** sha256 of the exact request body sent. */
  readonly requestSha256: string;
  /** sha256 of the exact response body text; null when no response was received. */
  readonly responseSha256: string | null;
  /** Set by the mock provider; a mock envelope can never enter a measured table (report.ts). */
  readonly mock: boolean;
  readonly synthetic: boolean;
  readonly detail: string | null;
}

export interface Provider {
  readonly provider: ProviderId;
  readonly api: ProviderApi;
  complete(request: ReviewRequest): Promise<ReviewEnvelope>;
}

/** What a provider-specific parser extracts from a 2xx JSON body. */
export interface ParsedProviderBody {
  readonly outcome: "completed" | "provider_error";
  readonly text: string | null;
  readonly reasoningText: string | null;
  readonly stopKind: StopKind | null;
  readonly stopReasonRaw: string | null;
  readonly usage: Usage | null;
  readonly reportedModel: string | null;
  readonly responseId: string | null;
  /** The provider says another model served (part of) the response. */
  readonly servedByOtherModel: boolean;
  readonly detail: string | null;
}

export interface ProviderAdapter {
  readonly provider: ProviderId;
  readonly api: ProviderApi;
  buildRequest(request: ReviewRequest): HttpRequest;
  parseBody(body: unknown): ParsedProviderBody;
  /** True only when a non-2xx body is exactly this provider's documented JSON error object (shape check only). */
  isErrorObject(body: unknown): boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Untrusted JSON helpers
// ---------------------------------------------------------------------------------------------------------------

export type JsonRecord = Readonly<Record<string, unknown>>;

export function asRecord(v: unknown): JsonRecord {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : {};
}

export function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** A non-negative safe integer token count, else null. */
export function asCount(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

export function errorMessageOf(body: unknown): string | null {
  const error = asRecord(asRecord(body).error);
  return asString(error.message) ?? asString(error.type) ?? asString(error.code);
}

/** A plain JSON object (not null, not an array). */
export function isJsonObject(v: unknown): v is JsonRecord {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * True when any key at any depth is `usage` or ends in `_tokens`: an error body that reports usage may have been
 * billed, so it is never `rejected_unbilled` (fail closed).
 */
export function carriesUsage(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(carriesUsage);
  if (!isJsonObject(v)) return false;
  return Object.entries(v).some(([key, child]) => key === "usage" || key.endsWith("_tokens") || carriesUsage(child));
}

export interface HttpErrorBilling {
  readonly billing: "rejected_unbilled" | "unknown";
  /** Why the billing is unknown; null for rejected_unbilled. */
  readonly unknownBecause: string | null;
}

/** Billing of a non-2xx response whose body parsed as JSON (see the header: rejected_unbilled vs unknown). */
export function httpErrorBilling(status: number, body: unknown, adapter: Pick<ProviderAdapter, "isErrorObject">): HttpErrorBilling {
  if (!REJECTED_UNBILLED_HTTP_STATUSES.includes(status)) return { billing: "unknown", unknownBecause: `HTTP ${status} is not a rejected-unbilled status` };
  if (!adapter.isErrorObject(body)) return { billing: "unknown", unknownBecause: "body is not the provider's error object" };
  if (carriesUsage(body)) return { billing: "unknown", unknownBecause: "error body carries usage" };
  return { billing: "rejected_unbilled", unknownBecause: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Shared completion flow
// ---------------------------------------------------------------------------------------------------------------

export interface ProviderOptions {
  readonly mock?: boolean;
  readonly synthetic?: boolean;
}

/** Validate a request against its lock before anything is sent. Throws LockMismatchError. */
export function assertRequestMatchesLock(request: ReviewRequest, adapter: Pick<ProviderAdapter, "provider" | "api">): LockedReviewer {
  const parsed = LockedReviewerSchema.safeParse(request.lock);
  if (!parsed.success) throw new LockMismatchError(`lock is incomplete or invalid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  const lock = parsed.data;
  if (lock.provider !== adapter.provider || lock.api !== adapter.api) {
    throw new LockMismatchError(`lock is for ${lock.provider}/${lock.api}, adapter is ${adapter.provider}/${adapter.api}`);
  }
  if (sha256Hex(request.systemPrompt) !== lock.system_prompt_sha256) {
    throw new LockMismatchError("system prompt sha256 differs from the lock");
  }
  return lock;
}

export function createProvider(adapter: ProviderAdapter, transport: Transport, options: ProviderOptions = {}): Provider {
  const mock = options.mock ?? false;
  const synthetic = options.synthetic ?? false;
  return {
    provider: adapter.provider,
    api: adapter.api,
    async complete(request: ReviewRequest): Promise<ReviewEnvelope> {
      const lock = assertRequestMatchesLock(request, adapter);
      const http = adapter.buildRequest(request);
      const base = {
        schema: "review-envelope/v1" as const,
        provider: adapter.provider,
        api: adapter.api,
        slotId: request.slotId,
        requestedModel: lock.model_id,
        requestSha256: sha256Hex(http.body),
        mock,
        synthetic,
      };
      const empty = {
        reportedModel: null,
        identity: "unreported" as const,
        text: null,
        reasoningText: null,
        stopKind: null,
        stopReasonRaw: null,
        usage: null,
        responseId: null,
      };

      let response: HttpResponse;
      try {
        response = await transport(http);
      } catch (error) {
        const phase: TransportPhase = error instanceof TransportError ? error.phase : "unknown";
        const message = error instanceof Error ? error.message : String(error);
        if (phase === "pre_send") {
          return {
            ...base,
            ...empty,
            outcome: "provider_error",
            preSendFailure: true,
            httpStatus: null,
            rateLimited: false,
            billing: "not_sent",
            responseSha256: null,
            detail: `pre-send transport failure: ${message}`,
          };
        }
        return {
          ...base,
          ...empty,
          outcome: phase === "timeout" ? "timeout" : "transport_unknown",
          preSendFailure: false,
          httpStatus: null,
          rateLimited: false,
          billing: "unknown",
          responseSha256: null,
          detail: `${phase} transport failure: ${message}`,
        };
      }

      // From here on the request was sent: preSendFailure is false on every path.
      const responseSha256 = sha256Hex(response.bodyText);
      const status = response.status;
      const isHttpError = status < 200 || status > 299;
      const rateLimited = status === RATE_LIMITED_HTTP_STATUS;
      let body: unknown;
      try {
        body = JSON.parse(response.bodyText);
      } catch {
        return {
          ...base,
          ...empty,
          outcome: "provider_error",
          preSendFailure: false,
          httpStatus: status,
          rateLimited,
          billing: "unknown",
          responseSha256,
          detail: `${isHttpError ? `HTTP ${status}: ` : ""}response body is not JSON (billing unknown)`,
        };
      }
      if (isHttpError) {
        const { billing, unknownBecause } = httpErrorBilling(status, body, adapter);
        return {
          ...base,
          ...empty,
          outcome: "provider_error",
          preSendFailure: false,
          httpStatus: status,
          rateLimited,
          billing,
          responseSha256,
          detail: `HTTP ${status}: ${errorMessageOf(body) ?? "no error message"} (${unknownBecause === null ? "rejected, unbilled" : `billing unknown: ${unknownBecause}`})`,
        };
      }

      const parsed = adapter.parseBody(body);
      const identity: Identity = parsed.servedByOtherModel
        ? "mismatch"
        : parsed.reportedModel === null
          ? "unreported"
          : parsed.reportedModel === lock.model_id
            ? "match"
            : "mismatch";
      return {
        ...base,
        outcome: parsed.outcome,
        preSendFailure: false,
        httpStatus: status,
        rateLimited: false,
        reportedModel: parsed.reportedModel,
        identity,
        text: parsed.text,
        reasoningText: parsed.reasoningText,
        stopKind: parsed.stopKind,
        stopReasonRaw: parsed.stopReasonRaw,
        usage: parsed.usage,
        billing: parsed.usage === null ? "unknown" : "reported",
        responseId: parsed.responseId,
        responseSha256,
        detail: parsed.detail,
      };
    },
  };
}
