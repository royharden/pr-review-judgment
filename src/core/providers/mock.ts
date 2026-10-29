// Mock provider (PLAN §4 fixtures/, M3 acceptance 9): replays recorded provider responses through the REAL adapter
// parser, so mock envelopes exercise exactly the code a live call would. Every envelope it returns is stamped
// `mock: true` (and `synthetic: true` for hand-written fixtures); report.ts refuses such inputs in measured tables.
// No network: the transport is a pure lookup. A missing recording is a replay error (thrown), never a response.
import { z } from "zod";
import { anthropicMessagesAdapter } from "./anthropic_messages.ts";
import { openAIResponsesAdapter } from "./openai_responses.ts";
import {
  createProvider,
  ProviderApi,
  ProviderId,
  type Provider,
  type ProviderAdapter,
  type ReviewEnvelope,
  type ReviewRequest,
  type Transport,
} from "./port.ts";

/**
 * fixtures/providers/*.json. `body` is a JSON response body; `body_text` is used instead when the recorded body is
 * not valid JSON (malformed fixture). Exactly one of the two is present.
 */
export const ProviderFixtureSchema = z
  .strictObject({
    schema: z.literal("provider-fixture/v1"),
    mock: z.literal(true),
    synthetic: z.boolean(),
    note: z.string().min(1),
    description: z.string().min(1),
    provider: ProviderId,
    api: ProviderApi,
    http_status: z.number().int().min(100).max(599),
    body: z.unknown().optional(),
    body_text: z.string().optional(),
  })
  .refine((f) => (f.body === undefined) !== (f.body_text === undefined), { message: "exactly one of body or body_text" });
export type ProviderFixture = z.infer<typeof ProviderFixtureSchema>;

export function fixtureBodyText(fixture: ProviderFixture): string {
  return fixture.body_text ?? JSON.stringify(fixture.body);
}

/** A transport that answers every request with the fixture's recorded status and body. */
export function createReplayTransport(fixture: ProviderFixture): Transport {
  const bodyText = fixtureBodyText(fixture);
  return async () => ({ status: fixture.http_status, bodyText });
}

export function adapterFor(provider: ProviderId): ProviderAdapter {
  return provider === "openai" ? openAIResponsesAdapter : anthropicMessagesAdapter;
}

/** Chooses the recording for a request (e.g. by slot id). */
export type FixtureLookup = (request: ReviewRequest) => ProviderFixture | undefined;

export function createMockProvider(provider: ProviderId, lookup: FixtureLookup): Provider {
  const adapter = adapterFor(provider);
  return {
    provider: adapter.provider,
    api: adapter.api,
    async complete(request: ReviewRequest): Promise<ReviewEnvelope> {
      const fixture = lookup(request);
      if (fixture === undefined) throw new Error(`mock provider: no recording for slot ${request.slotId}`);
      const checked = ProviderFixtureSchema.parse(fixture);
      if (checked.provider !== adapter.provider || checked.api !== adapter.api) {
        throw new Error(`mock provider: recording is ${checked.provider}/${checked.api}, provider is ${adapter.provider}/${adapter.api}`);
      }
      return createProvider(adapter, createReplayTransport(checked), { mock: true, synthetic: checked.synthetic }).complete(request);
    },
  };
}
