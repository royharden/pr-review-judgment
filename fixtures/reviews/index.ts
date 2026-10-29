// Public, synthetic dev examples only. No original Task JSON, tests or private companion is imported.
import cases from "./cases.json" with { type: "json" };
import type { FileRegion } from "../../src/core/defectcorpus/region.ts";
import type { SlotReply } from "../../src/core/reviewjudge/classify.ts";

export interface MockReviewCase {
  readonly fixture_schema: "mock-review-case/v1";
  readonly id: string;
  readonly taskId: string;
  readonly label: string;
  readonly mock: true;
  readonly synthetic: true;
  readonly variantKind: "clean" | "near_miss" | "defect";
  readonly spec: string;
  readonly files: readonly { readonly path: string; readonly base: string; readonly head: string }[];
  readonly regions: readonly FileRegion[];
  readonly reply: SlotReply;
  readonly outputTokens: number | null;
  readonly expectedOutcome: string;
  readonly raw_response: string;
}
// JSON parsing is checked statically; contract/classification tests are written but deferred in Dirty Mode.
export const MOCK_REVIEW_CASES: readonly MockReviewCase[] = cases as readonly MockReviewCase[];
