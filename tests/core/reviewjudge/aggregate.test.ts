// Written, never run in Dirty Mode. PLAN M3.5: equations match §1/§6 symbol for symbol; Δ_self sign test.
import { describe, expect, it } from "vitest";
import {
  DELTA_SELF_LABEL,
  NEG_DELTA_SELF_LABEL,
  aggregate,
  crossedContrast,
  type CleanSlotRecord,
  type DefectSlotRecord,
  type KKey,
  type ModelId,
} from "../../../src/core/reviewjudge/aggregate.ts";
import type { DefectOutcome } from "../../../src/core/reviewjudge/classify.ts";

let seq = 0;
const outcomes = (o: DefectOutcome): Record<KKey, DefectOutcome> => ({ k0: o, k2: o, k5: o });

function defect(p: {
  stratum: "A" | "B";
  arm: string;
  taskId: string;
  author?: ModelId | null;
  outcome: DefectOutcome;
  repeat?: number;
  ordinal?: number;
  change?: string;
  mock?: boolean;
}): DefectSlotRecord {
  seq++;
  return {
    runId: "run-test",
    slotId: `slot-${seq}`,
    mock: p.mock ?? false,
    stratum: p.stratum,
    arm: p.arm,
    taskId: p.taskId,
    author: p.author ?? null,
    changeId: p.change ?? `c_${String(seq).padStart(10, "0")}`,
    defectOrdinal: p.ordinal ?? 1,
    repeat: p.repeat ?? 1,
    outcomes: outcomes(p.outcome),
    findingCount: p.outcome === "UNAVAILABLE" ? 0 : 1,
    localizedFindingCount: p.outcome === "HIT" || p.outcome === "DEFER" ? 1 : 0,
    requiresChangeFindings: p.outcome === "HIT" ? 1 : 0,
    outputTokens: 100,
  };
}

function clean(p: {
  stratum: "A" | "B";
  arm: string;
  taskId: string;
  author?: ModelId | null;
  status?: CleanSlotRecord["status"];
  verdict?: CleanSlotRecord["verdict"];
  kind?: "clean" | "near_miss";
}): CleanSlotRecord {
  seq++;
  const status = p.status ?? "valid";
  return {
    runId: "run-test",
    slotId: `slot-${seq}`,
    mock: false,
    stratum: p.stratum,
    arm: p.arm,
    taskId: p.taskId,
    author: p.author ?? null,
    changeId: `c_${String(seq).padStart(10, "0")}`,
    variantKind: p.kind ?? "clean",
    repeat: 1,
    status,
    verdict: status === "valid" ? (p.verdict ?? "approve") : null,
    requiresChangeFindings: 0,
    outputTokens: null,
  };
}

/** Stratum B slots for one task: two defects per (reviewer, author); `hit(reviewer, author)` decides the outcome. */
function crossedTask(taskId: string, hit: (reviewer: ModelId, author: ModelId) => boolean): DefectSlotRecord[] {
  const out: DefectSlotRecord[] = [];
  for (const reviewer of ["A", "B"] as const) {
    for (const author of ["A", "B"] as const) {
      for (const ordinal of [1, 2]) {
        out.push(defect({ stratum: "B", arm: reviewer, taskId, author, ordinal, outcome: hit(reviewer, author) ? "HIT" : "MISS" }));
      }
    }
  }
  return out;
}

const DRAWS = 200;

describe("D_t", () => {
  it("D_t = 1/2 [(H_AA - H_BA) + (H_BB - H_AB)]", () => {
    expect(crossedContrast({ H_AA: 1, H_BA: 0.5, H_BB: 0.5, H_AB: 0 })).toBe(0.5);
    expect(crossedContrast({ H_AA: 0, H_BA: 1, H_BB: 0, H_AB: 1 })).toBe(-1);
    // Symmetric reviewers with no self effect -> 0.
    expect(crossedContrast({ H_AA: 0.7, H_BA: 0.7, H_BB: 0.4, H_AB: 0.4 })).toBe(0);
  });
});

describe("Δ_self sign test", () => {
  it("same-model review always catches, different never -> Δ_self = +1, −Δ_self = −1", () => {
    const records = ["H01", "H02", "H03"].flatMap((t) => crossedTask(t, (r, a) => r === a));
    const b = aggregate({ defectSlots: records, cleanSlots: [], draws: DRAWS }).stratumB!;
    expect(b.hit.k2.deltaSelf.label).toBe(DELTA_SELF_LABEL);
    expect(b.hit.k2.negDeltaSelf.label).toBe(NEG_DELTA_SELF_LABEL);
    expect(b.hit.k2.deltaSelf.value).toEqual({ kind: "value", value: 1 });
    expect(b.hit.k2.negDeltaSelf.value).toEqual({ kind: "value", value: -1 });
    expect(b.hit.k2.cells.H_AA.value).toEqual({ kind: "value", value: 1 });
    expect(b.hit.k2.cells.H_AB.value).toEqual({ kind: "value", value: 0 });
    expect(b.hit.k2.includedTasks).toEqual(["H01", "H02", "H03"]);
    // Interval of a constant per-task D_t is the constant; negation swaps the bounds.
    expect(b.hit.k2.deltaSelf.ci!.lower).toEqual({ kind: "value", value: 1 });
    expect(b.hit.k2.negDeltaSelf.ci!.upper).toEqual({ kind: "value", value: -1 });
    expect(b.hit.k2.deltaSelf.ci!.seed).toBe(4103);
  });

  it("different-model review always catches, same never -> Δ_self = −1", () => {
    const records = ["H01", "H02"].flatMap((t) => crossedTask(t, (r, a) => r !== a));
    const b = aggregate({ defectSlots: records, cleanSlots: [], draws: DRAWS }).stratumB!;
    expect(b.hit.k2.deltaSelf.value).toEqual({ kind: "value", value: -1 });
    expect(b.hit.k2.negDeltaSelf.value).toEqual({ kind: "value", value: 1 });
  });

  it("a reviewer that is simply better everywhere has no self effect: Δ_self = 0", () => {
    const records = ["H01", "H02"].flatMap((t) => crossedTask(t, (r) => r === "A"));
    const b = aggregate({ defectSlots: records, cleanSlots: [], draws: DRAWS }).stratumB!;
    expect(b.hit.k2.deltaSelf.value).toEqual({ kind: "value", value: 0 });
  });
});

describe("stratum B task inclusion", () => {
  it("excludes and lists tasks missing an author", () => {
    const full = crossedTask("H01", (r, a) => r === a);
    const partial = crossedTask("H02", () => true).filter((r) => r.author === "A");
    const b = aggregate({ defectSlots: [...full, ...partial], cleanSlots: [], draws: DRAWS }).stratumB!;
    expect(b.hit.k2.includedTasks).toEqual(["H01"]);
    expect(b.hit.k2.excludedTasks).toHaveLength(1);
    expect(b.hit.k2.excludedTasks[0]!.taskId).toBe("H02");
    expect(b.hit.k2.excludedTasks[0]!.reason).toContain("H_AB missing");
    expect(b.hit.k2.excludedTasks[0]!.reason).toContain("paired-task-missing");
  });

  it("no included task -> Δ_self undefined with a reason", () => {
    const partial = crossedTask("H02", () => true).filter((r) => r.author === "B");
    const b = aggregate({ defectSlots: partial, cleanSlots: [], draws: DRAWS }).stratumB!;
    expect(b.hit.k2.deltaSelf.value.kind).toBe("undefined");
  });
});

describe("stratum B clean contrasts", () => {
  it("false rejection Δ uses the same D_t form; an undefined cell excludes the task", () => {
    const cleans: CleanSlotRecord[] = [];
    for (const t of ["H01", "H02"]) {
      for (const reviewer of ["A", "B"] as const) {
        for (const author of ["A", "B"] as const) {
          // Same-model reviewers reject their own clean substrate; different-model reviewers approve.
          cleans.push(clean({ stratum: "B", arm: reviewer, taskId: t, author, verdict: reviewer === author ? "request_changes" : "approve" }));
        }
      }
    }
    // H03: reviewer B's only reply on author A's clean substrate is non-valid -> F_BA undefined -> excluded.
    for (const reviewer of ["A", "B"] as const) {
      for (const author of ["A", "B"] as const) {
        cleans.push(
          reviewer === "B" && author === "A"
            ? clean({ stratum: "B", arm: reviewer, taskId: "H03", author, status: "timeout" })
            : clean({ stratum: "B", arm: reviewer, taskId: "H03", author }),
        );
      }
    }
    const b = aggregate({ defectSlots: [], cleanSlots: cleans, draws: DRAWS }).stratumB!;
    expect(b.falseRejection.deltaSelf.value).toEqual({ kind: "value", value: 1 });
    expect(b.falseRejection.includedTasks).toEqual(["H01", "H02"]);
    expect(b.falseRejection.excludedTasks.map((e) => e.taskId)).toEqual(["H03"]);
    // Conservative non-approval counts the timeout as non-approval, so H03 is included there:
    // D^C = 1/2[(C_AA - C_BA) + (C_BB - C_AB)] = 1/2[(0 - 1) + (0 - 0)] = -0.5 for H03; +1 for H01, H02.
    expect(b.conservativeNonApproval.includedTasks).toEqual(["H01", "H02", "H03"]);
    expect(b.conservativeNonApproval.deltaSelf.value.kind).toBe("value");
    if (b.conservativeNonApproval.deltaSelf.value.kind === "value") {
      expect(b.conservativeNonApproval.deltaSelf.value.value).toBeCloseTo((1 + 1 - 0.5) / 3, 12);
    }
  });
});

describe("stratum A", () => {
  it("per-task HIT is the mean over defects x repeats; HIT is the macro mean over tasks (not pooled)", () => {
    const records = [
      defect({ stratum: "A", arm: "A", taskId: "H01", outcome: "HIT" }),
      defect({ stratum: "A", arm: "A", taskId: "H01", outcome: "MISS" }),
      ...[1, 2, 3, 4].map(() => defect({ stratum: "A", arm: "A", taskId: "H02", outcome: "HIT" })),
    ];
    const arm = aggregate({ defectSlots: records, cleanSlots: [], draws: DRAWS }).stratumA.arms[0]!;
    expect(arm.perTaskHit.k2.map((t) => t.value)).toEqual([0.5, 1]);
    expect(arm.hit.k2.value).toEqual({ kind: "value", value: 0.75 }); // pooled would be 5/6
    expect(arm.hit.k2.n).toBe(2);
    expect(arm.hit.k2.unit).toBe("tasks");
    expect(arm.hit.k2.ci!.seed).toBe(4102);
    expect(arm.hitCount).toBe(5);
  });

  it("UNAVAILABLE slots stay in the denominator as non-HITs", () => {
    const records = [
      defect({ stratum: "A", arm: "A", taskId: "H01", outcome: "HIT" }),
      defect({ stratum: "A", arm: "A", taskId: "H01", outcome: "UNAVAILABLE" }),
    ];
    const arm = aggregate({ defectSlots: records, cleanSlots: [], draws: DRAWS }).stratumA.arms[0]!;
    expect(arm.hit.k2.value).toEqual({ kind: "value", value: 0.5 });
    expect(arm.outcomeShares.UNAVAILABLE.value).toEqual({ kind: "value", value: 0.5 });
  });

  it("A − B is a paired per-task difference over tasks reviewed by both", () => {
    const records = [
      defect({ stratum: "A", arm: "A", taskId: "H01", outcome: "HIT" }),
      defect({ stratum: "A", arm: "B", taskId: "H01", outcome: "MISS" }),
      defect({ stratum: "A", arm: "A", taskId: "H02", outcome: "HIT" }),
      defect({ stratum: "A", arm: "B", taskId: "H02", outcome: "HIT" }),
      defect({ stratum: "A", arm: "A", taskId: "H03", outcome: "HIT" }),
    ];
    const diff = aggregate({ defectSlots: records, cleanSlots: [], draws: DRAWS }).stratumA.modelDifference!;
    expect(diff.tasks).toEqual(["H01", "H02"]);
    expect(diff.excludedTasks).toEqual(["H03"]);
    expect(diff.difference.value).toEqual({ kind: "value", value: 0.5 });
  });

  it("flip rate: share of changes whose repeats disagree", () => {
    const records = [
      defect({ stratum: "A", arm: "A", taskId: "H01", change: "c_aaaaaaaaaa", repeat: 1, outcome: "HIT" }),
      defect({ stratum: "A", arm: "A", taskId: "H01", change: "c_aaaaaaaaaa", repeat: 2, outcome: "HIT" }),
      defect({ stratum: "A", arm: "A", taskId: "H01", change: "c_aaaaaaaaaa", repeat: 3, outcome: "MISS" }),
      defect({ stratum: "A", arm: "A", taskId: "H01", change: "c_bbbbbbbbbb", repeat: 1, outcome: "MISS" }),
      defect({ stratum: "A", arm: "A", taskId: "H01", change: "c_bbbbbbbbbb", repeat: 2, outcome: "MISS" }),
      defect({ stratum: "A", arm: "A", taskId: "H01", change: "c_bbbbbbbbbb", repeat: 3, outcome: "MISS" }),
    ];
    const arm = aggregate({ defectSlots: records, cleanSlots: [], draws: DRAWS }).stratumA.arms[0]!;
    expect(arm.flipRate.seeded.value).toEqual({ kind: "value", value: 0.5 });
    expect(arm.flipRate.seeded.n).toBe(2);
    expect(arm.flipRate.clean.value.kind).toBe("undefined");
  });
});

describe("McNemar observation", () => {
  it("uses repeat 1 of the first-seeded defect per task only", () => {
    const records = [
      ...crossedTask("H01", (r) => r === "A"),
      ...crossedTask("H02", (r) => r === "A"),
      // Repeat 2 rows must be ignored.
      defect({ stratum: "B", arm: "A", taskId: "H01", author: "A", ordinal: 1, repeat: 2, outcome: "MISS" }),
      defect({ stratum: "B", arm: "B", taskId: "H01", author: "A", ordinal: 1, repeat: 2, outcome: "HIT" }),
    ];
    const m = aggregate({ defectSlots: records, cleanSlots: [], draws: DRAWS }).stratumB!.mcnemar;
    const a = m.find((x) => x.author === "A")!;
    expect(a.tasks).toEqual(["H01", "H02"]);
    expect([a.result.b, a.result.c]).toEqual([2, 0]);
    // Source = exactly the paired slots: one per reviewer per included task, never the repeat-2 rows.
    expect(a.source.slotCount).toBe(4);
    expect(a.source.runIds).toEqual(["run-test"]);
    expect(a.source.slotSetSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a task without both reviewers' observation contributes no slot to the source", () => {
    const records = [defect({ stratum: "B", arm: "A", taskId: "H09", author: "B", ordinal: 1, outcome: "HIT" })];
    const b = aggregate({ defectSlots: records, cleanSlots: [], draws: DRAWS }).stratumB!.mcnemar.find((x) => x.author === "B")!;
    expect(b.result.n).toBe(0);
    expect(b.source.slotCount).toBe(0);
  });
});

describe("sources", () => {
  it("every cell carries run ids, slot count, slot-set hash and the mock flag", () => {
    const records = [defect({ stratum: "A", arm: "A", taskId: "H01", outcome: "HIT", mock: true })];
    const r = aggregate({ defectSlots: records, cleanSlots: [], draws: DRAWS });
    const c = r.stratumA.arms[0]!.hit.k2;
    expect(c.source.runIds).toEqual(["run-test"]);
    expect(c.source.slotCount).toBe(1);
    expect(c.source.slotSetSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(c.source.mock).toBe(true);
    expect(r.mock).toBe(true);
  });

  it("Wilson intervals carry the source of their point estimate", () => {
    const defects = [defect({ stratum: "A", arm: "A", taskId: "H01", outcome: "HIT" }), defect({ stratum: "A", arm: "A", taskId: "H02", outcome: "MISS" })];
    const cleans = [clean({ stratum: "A", arm: "A", taskId: "H01", verdict: "request_changes" }), clean({ stratum: "A", arm: "A", taskId: "H01", status: "schema_invalid" })];
    const arm = aggregate({ defectSlots: defects, cleanSlots: cleans, draws: DRAWS }).stratumA.arms[0]!;
    expect(arm.hitWilsonPooled.source).toEqual(arm.hit.k2.source);
    expect(arm.hitWilsonPooled.source.slotCount).toBe(2);
    expect(arm.clean.falseRejectionWilson.source).toEqual(arm.clean.falseRejection.source);
    expect(arm.clean.falseRejectionWilson.n).toBe(1);
    expect(arm.nearMiss.falseRejectionWilson.kind).toBe("undefined");
    expect(arm.nearMiss.falseRejectionWilson.source.slotCount).toBe(0);
  });

  it("refuses duplicate slot ids and malformed strata", () => {
    const d = defect({ stratum: "A", arm: "A", taskId: "H01", outcome: "HIT" });
    expect(() => aggregate({ defectSlots: [d, d], cleanSlots: [] })).toThrow(/duplicate/);
    expect(() => aggregate({ defectSlots: [{ ...d, author: "A" }], cleanSlots: [] })).toThrow();
    expect(() => aggregate({ defectSlots: [{ ...d, stratum: "B" }], cleanSlots: [] })).toThrow();
  });
});
