// Shared test helpers for provider tests (never run in Dirty Mode). Locks here are synthetic test values, not a model
// lock: protocol/model-lock.json stays all-null until Roy answers R2.
import { readFileSync } from "node:fs";
import type { LockedReviewer, ReviewRequest } from "../../../src/core/providers/port.ts";
import type { ProviderFixture } from "../../../src/core/providers/mock.ts";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_SHA256 } from "../../../src/core/reviewjudge/contract.ts";

export const OPENAI_TEST_MODEL = "synthetic-openai-reviewer";
export const ANTHROPIC_TEST_MODEL = "synthetic-anthropic-reviewer";

export function testLock(provider: "openai" | "anthropic", over: Partial<LockedReviewer> = {}): LockedReviewer {
  return {
    provider,
    api: provider === "openai" ? "responses" : "messages",
    model_id: provider === "openai" ? OPENAI_TEST_MODEL : ANTHROPIC_TEST_MODEL,
    api_version: provider === "openai" ? "v1" : "2023-06-01",
    effort: "high",
    tools: "off",
    output_cap_tokens: 8000,
    system_prompt_sha256: SYSTEM_PROMPT_SHA256,
    ...over,
  };
}

export function testRequest(lock: LockedReviewer, slotId = "slot-0001"): ReviewRequest {
  return { slotId, systemPrompt: SYSTEM_PROMPT, userPrompt: "Change c_0123456789\n(body)", lock };
}

export const FIXTURE_NAMES = [
  "openai_text",
  "openai_reasoning_usage",
  "openai_truncated",
  "openai_refusal",
  "anthropic_text",
  "anthropic_thinking",
  "anthropic_max_tokens",
  "anthropic_refusal",
  "malformed_json",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export function loadFixture(name: FixtureName): ProviderFixture {
  return JSON.parse(readFileSync(new URL(`../../../fixtures/providers/${name}.json`, import.meta.url), "utf8")) as ProviderFixture;
}

/** The head file every fixture's review JSON points at. */
export const FIXTURE_HEAD_FILES = [{ path: "src/window.ts", lineCount: 30 }];
