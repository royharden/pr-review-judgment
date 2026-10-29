// Only public, builder-authored development source and synthetic review fixtures enter this bundle.
// The source projection deliberately excludes tests, labels and private companions.
import corpus from "../../corpus/dev.public.json";
import { MOCK_REVIEW_CASES, type MockReviewCase } from "../../fixtures/reviews/index.ts";
import { splitLines } from "../core/defectcorpus/diff.ts";
import { classifyDefectSlot, observeCleanSlot } from "../core/reviewjudge/classify.ts";
import { aggregate, type CleanSlotRecord, type DefectSlotRecord } from "../core/reviewjudge/aggregate.ts";
import { formatValue } from "../core/stats/value.ts";

export { MOCK_REVIEW_CASES, formatValue };
export type { MockReviewCase };
export const DEV_CORPUS = corpus.tasks;

export function boundsOf(item: MockReviewCase) {
  return item.files.map((file) => ({ path: file.path, lineCount: splitLines(file.head).length }));
}

export function outcomeOf(item: MockReviewCase, k = 2): string {
  if (item.reply.status !== "valid") return "INVALID";
  if (item.variantKind !== "defect") return item.reply.review?.verdict === "request_changes" ? "FALSE REJECTION" : "CLEAN";
  return classifyDefectSlot(item.reply, item.regions, boundsOf(item), k).outcome;
}

export function classificationOf(item: MockReviewCase, k: number) {
  return item.variantKind === "defect" ? classifyDefectSlot(item.reply, item.regions, boundsOf(item), k) : null;
}

export function fixtureAggregate() {
  const defectSlots: DefectSlotRecord[] = [];
  const cleanSlots: CleanSlotRecord[] = [];
  for (const [index, item] of MOCK_REVIEW_CASES.entries()) {
    const common = {
      runId: "MOCK-viewer", slotId: item.id, mock: true, stratum: "A" as const,
      arm: "synthetic", taskId: item.taskId, author: null, changeId: item.id, repeat: 1,
    };
    if (item.variantKind === "defect") {
      const primary = classifyDefectSlot(item.reply, item.regions, boundsOf(item), 2);
      defectSlots.push({
        ...common, defectOrdinal: index + 1,
        outcomes: {
          k0: classifyDefectSlot(item.reply, item.regions, boundsOf(item), 0).outcome,
          k2: primary.outcome,
          k5: classifyDefectSlot(item.reply, item.regions, boundsOf(item), 5).outcome,
        },
        findingCount: item.reply.review?.findings.length ?? 0,
        localizedFindingCount: primary.trace?.localizedCount ?? 0,
        requiresChangeFindings: item.reply.review?.findings.filter((f) => f.disposition === "requires_change").length ?? 0,
        outputTokens: item.outputTokens,
      });
    } else {
      cleanSlots.push({ ...common, variantKind: item.variantKind, ...observeCleanSlot(item.reply, item.outputTokens) });
    }
  }
  return aggregate({ defectSlots, cleanSlots });
}
