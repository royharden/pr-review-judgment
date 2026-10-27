// Written, never run in Dirty Mode. Every synthetic fixture replays through the real parser to the expected review
// status; every mock envelope is stamped mock/synthetic. The fixtures are NOT claimed to match the live APIs.
import { describe, expect, it } from "vitest";
import { ProviderFixtureSchema, createMockProvider } from "../../../src/core/providers/mock.ts";
import { resolveReviewResult } from "../../../src/core/reviewjudge/response.ts";
import type { ReviewStatus } from "../../../src/core/reviewjudge/contract.ts";
import { FIXTURE_HEAD_FILES, FIXTURE_NAMES, loadFixture, testLock, testRequest, type FixtureName } from "./helpers.ts";

const EXPECTED: Readonly<Record<FixtureName, ReviewStatus>> = {
  openai_text: "valid",
  openai_reasoning_usage: "valid",
  openai_truncated: "truncated",
  openai_refusal: "refusal",
  anthropic_text: "valid",
  anthropic_thinking: "valid",
  anthropic_max_tokens: "truncated",
  anthropic_refusal: "refusal",
  malformed_json: "provider_error",
};

describe("fixtures", () => {
  it("every fixture matches provider-fixture/v1 and is stamped mock + synthetic", () => {
    for (const name of FIXTURE_NAMES) {
      const f = ProviderFixtureSchema.parse(loadFixture(name));
      expect(f.mock).toBe(true);
      expect(f.synthetic).toBe(true);
      expect(f.note).toContain("NOT a recording of a live API call");
    }
  });

  it("each replays to its expected status through the real adapter", async () => {
    for (const name of FIXTURE_NAMES) {
      const fixture = loadFixture(name);
      const provider = createMockProvider(fixture.provider, () => fixture);
      const env = await provider.complete(testRequest(testLock(fixture.provider)));
      expect(env.mock).toBe(true);
      expect(env.synthetic).toBe(true);
      expect(resolveReviewResult(env, FIXTURE_HEAD_FILES).status, name).toBe(EXPECTED[name]);
      expect(resolveReviewResult(env, FIXTURE_HEAD_FILES).mock).toBe(true);
    }
  });

  it("the malformed body has unknown billing and no usage (never zero cost)", async () => {
    const fixture = loadFixture("malformed_json");
    const env = await createMockProvider("openai", () => fixture).complete(testRequest(testLock("openai")));
    expect(env.billing).toBe("unknown");
    expect(env.usage).toBeNull();
    expect(env.outcome).toBe("provider_error");
  });

  it("a truncated reply keeps its reported usage", async () => {
    const fixture = loadFixture("openai_truncated");
    const env = await createMockProvider("openai", () => fixture).complete(testRequest(testLock("openai")));
    expect(env.billing).toBe("reported");
    expect(env.usage!.outputTokens).toBe(8000);
    expect(env.usage!.reasoningTokens).toBe(8000);
  });
});

describe("mock provider", () => {
  it("a missing recording is an error, not a response", async () => {
    await expect(createMockProvider("openai", () => undefined).complete(testRequest(testLock("openai")))).rejects.toThrow(/no recording/);
  });

  it("refuses a recording for the other provider", async () => {
    const fixture = loadFixture("anthropic_text");
    await expect(createMockProvider("openai", () => fixture).complete(testRequest(testLock("openai")))).rejects.toThrow();
  });
});
