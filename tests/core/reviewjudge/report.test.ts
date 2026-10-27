// Written, never run in Dirty Mode. PLAN M3.8: MOCK never enters a measured table; every cell carries count/source;
// undefined renders with its reason; semantic column NOT RUN; both Δ labels printed.
import { describe, expect, it } from "vitest";
import { aggregate, sourceOf, type AggregateResult, type CleanSlotRecord, type DefectSlotRecord } from "../../../src/core/reviewjudge/aggregate.ts";
import {
  MockInMeasuredError,
  SourceIdConflictError,
  assertNoMock,
  buildResultsJson,
  renderResultsJson,
  renderResultsMarkdown,
  type ArmCost,
  type ReportMeta,
} from "../../../src/core/reviewjudge/report.ts";

const meta: ReportMeta = {
  reportState: "collecting",
  generatedAt: "2026-10-27T00:00:00.000Z",
  promptSha256: "a".repeat(64),
  rulesetSha256: "b".repeat(64),
  protocolSha256: null,
};

let seq = 0;
function slot(mock: boolean, arm: string, taskId: string, hit: boolean, stratum: "A" | "B" = "A", author: "A" | "B" | null = null): DefectSlotRecord {
  seq++;
  const o = hit ? "HIT" : "MISS";
  return {
    runId: mock ? "fixture-run" : "run-1",
    slotId: `s-${seq}`,
    mock,
    stratum,
    arm,
    taskId,
    author,
    changeId: `c_${String(seq).padStart(10, "0")}`,
    defectOrdinal: 1,
    repeat: 1,
    outcomes: { k0: o, k2: o, k5: o },
    findingCount: 1,
    localizedFindingCount: hit ? 1 : 0,
    requiresChangeFindings: 1,
    outputTokens: null,
  };
}

function cleanSlot(
  mock: boolean,
  arm: string,
  taskId: string,
  verdict: "approve" | "request_changes",
  kind: "clean" | "near_miss" = "clean",
  stratum: "A" | "B" = "A",
  author: "A" | "B" | null = null,
): CleanSlotRecord {
  seq++;
  return {
    runId: mock ? "fixture-run" : "run-1",
    slotId: `s-${seq}`,
    mock,
    stratum,
    arm,
    taskId,
    author,
    changeId: `c_${String(seq).padStart(10, "0")}`,
    variantKind: kind,
    repeat: 1,
    status: "valid",
    verdict,
    requiresChangeFindings: verdict === "request_changes" ? 1 : 0,
    outputTokens: 10,
  };
}

/** Both strata, both arms, clean and near-miss rows, one crossed task: every row kind of the report is rendered. */
function fullAggregate(mock: boolean): AggregateResult {
  const defects = [
    slot(mock, "A", "H01", true),
    slot(mock, "A", "H02", false),
    slot(mock, "B", "H01", false),
    slot(mock, "B", "H02", true),
    slot(mock, "A", "H03", true, "B", "A"),
    slot(mock, "B", "H03", false, "B", "A"),
    slot(mock, "A", "H03", false, "B", "B"),
    slot(mock, "B", "H03", true, "B", "B"),
  ];
  const cleans = [
    cleanSlot(mock, "A", "H01", "approve"),
    cleanSlot(mock, "B", "H01", "request_changes"),
    // Arm A only: arm B's near-miss Wilson has a zero denominator and must still print n and src.
    cleanSlot(mock, "A", "H01", "approve", "near_miss"),
    cleanSlot(mock, "A", "H03", "approve", "clean", "B", "A"),
    cleanSlot(mock, "B", "H03", "request_changes", "clean", "B", "A"),
    cleanSlot(mock, "A", "H03", "approve", "clean", "B", "B"),
    cleanSlot(mock, "B", "H03", "approve", "clean", "B", "B"),
  ];
  return aggregate({ defectSlots: defects, cleanSlots: cleans, draws: 50 });
}

const mockAgg = aggregate({ defectSlots: [slot(true, "A", "T01", true), slot(true, "A", "T02", false)], cleanSlots: [], draws: 50 });
const realAgg = aggregate({ defectSlots: [slot(false, "A", "H01", true), slot(false, "B", "H01", false)], cleanSlots: [], draws: 50 });

// ---- markdown helpers -------------------------------------------------------------------------------------------

const between = (md: string, start: string, end: string): string => {
  const from = md.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = md.indexOf(end, from);
  return md.slice(from, to < 0 ? undefined : to);
};

const splitRow = (line: string): string[] => line.slice(2, -2).split(" | ");

/** Every data cell (all columns but the label column) of every table in `section`; header and separator rows skipped. */
function dataCells(section: string): string[] {
  const lines = section.split("\n");
  const cells: string[] = [];
  lines.forEach((line, i) => {
    if (!line.startsWith("| ")) return;
    if (line.startsWith("| --- ") || (lines[i + 1] ?? "").startsWith("| --- ")) return;
    cells.push(...splitRow(line).slice(1));
  });
  return cells;
}

function row(section: string, label: string): string[] {
  const line = section.split("\n").find((l) => l.startsWith(`| ${label} |`));
  if (line === undefined) throw new Error(`no row "${label}"`);
  return splitRow(line).slice(1);
}

/** All source ids named by `src=` (cost cells name two, joined by `+`). */
const srcIds = (text: string): string[] => [...text.matchAll(/src=([^\s|]+)/g)].flatMap((m) => m[1]!.split("+"));
const srcOf = (cellText: string): string => /src=([^\s|]+)/.exec(cellText)![1]!;

/** value [CI] · n=N unit · src=<id>[+<id>], the format of every number cell. */
const NUMBER_CELL = / · n=\d+ \S+ · src=s[0-9a-f]{8}(\+s[0-9a-f]{8})?$/;

const ledgerSource = sourceOf([{ runId: "run-1", slotId: "ledger-arm-A", mock: false }]);
const armACost: ArmCost = { arm: "A", allAttemptUsd: { kind: "value", value: 1 }, source: ledgerSource };

describe("MOCK isolation", () => {
  it("refuses a mock aggregate in the measured position (markdown and json)", () => {
    expect(() => renderResultsMarkdown({ meta, measured: mockAgg, mock: null })).toThrow(MockInMeasuredError);
    expect(() => buildResultsJson({ meta, measured: mockAgg, mock: null })).toThrow(MockInMeasuredError);
  });

  it("refuses a measured aggregate that contains even one mock slot", () => {
    const mixed = aggregate({ defectSlots: [slot(false, "A", "H01", true), slot(true, "A", "H02", true)], cleanSlots: [], draws: 50 });
    expect(() => assertNoMock(mixed)).toThrow(MockInMeasuredError);
  });

  it("refuses mock cost rows in the measured position", () => {
    const source = { runIds: ["x"], slotCount: 1, slotSetSha256: "c".repeat(64), mock: true };
    expect(() =>
      renderResultsMarkdown({ meta, measured: realAgg, measuredCosts: [{ arm: "A", allAttemptUsd: { kind: "value", value: 1 }, source }], mock: null }),
    ).toThrow(MockInMeasuredError);
  });

  it("renders the mock aggregate in its own section, stamped MOCK on every value", () => {
    const md = renderResultsMarkdown({ meta, measured: null, mock: mockAgg });
    expect(md).toContain("## Measured results\n\nNOT MEASURED");
    expect(md).toContain("## MOCK: synthetic fixtures, not a measurement");
    const mockSection = md.slice(md.indexOf("## MOCK"));
    expect(mockSection).toContain("MOCK 0.5000");
    expect(mockSection).not.toMatch(/\| 0\.\d{4}/); // no unstamped number cell
  });

  it("stamps every data cell of every mock table, including Wilson, McNemar and cost cells", () => {
    const md = renderResultsMarkdown({ meta, measured: null, mock: fullAggregate(true) });
    const mockPart = between(md, "## MOCK", "### Sources");
    const cells = dataCells(mockPart);
    expect(cells.length).toBeGreaterThan(40);
    for (const c of cells) {
      if (c === "NOT RUN") continue;
      expect(c.startsWith("MOCK "), c).toBe(true);
      expect(c, c).toMatch(NUMBER_CELL);
    }
  });
});

describe("cells", () => {
  it("print value, n and source; the sources table resolves every src id", () => {
    const md = renderResultsMarkdown({ meta, measured: realAgg, mock: null });
    const ids = srcIds(md);
    expect(ids.length).toBeGreaterThan(0);
    const sources = md.slice(md.indexOf("### Sources"));
    for (const id of new Set(ids)) {
      expect(id).toMatch(/^s[0-9a-f]{8}$/);
      expect(sources).toMatch(new RegExp(`^\\| ${id} \\| `, "m"));
    }
    expect(md).toMatch(/1\.0000 \[1\.0000, 1\.0000\] · n=1 tasks · src=s[0-9a-f]{8}/);
  });

  it("every number cell and Δ line of a full report carries n and a resolvable source (no unsourced number)", () => {
    const md = renderResultsMarkdown({ meta, measured: fullAggregate(false), measuredCosts: [armACost], mock: null });
    const measured = between(md, "## Measured results", "### Sources");
    const cells = dataCells(measured);
    expect(cells.length).toBeGreaterThan(40);
    for (const c of cells) {
      if (c === "NOT RUN") continue;
      expect(c, c).toMatch(NUMBER_CELL);
    }
    const deltaLines = measured.split("\n").filter((l) => l.startsWith("- Δ_self") || l.startsWith("- −Δ_self") || l.includes("descriptive paired difference"));
    expect(deltaLines.length).toBe(2 * 5 + 1); // 3 HIT k + false rejection + conservative non-approval, and A − B
    for (const l of deltaLines) expect(l, l).toMatch(NUMBER_CELL);
    // A number outside a sourced cell or line would show up here.
    for (const line of measured.split("\n")) if (/\d\.\d{4}/.test(line)) expect(line, line).toContain("src=");
    const sources = md.slice(md.indexOf("### Sources"));
    for (const id of new Set(srcIds(measured))) expect(sources).toMatch(new RegExp(`^\\| ${id} \\| `, "m"));
  });

  it("Wilson rows print n and src; each shares the source of its point estimate", () => {
    const md = renderResultsMarkdown({ meta, measured: fullAggregate(false), mock: null });
    const hitK2 = row(md, "HIT, k=2 (primary; actionable localization)");
    const hitWilson = row(md, "HIT pooled, Wilson (descriptive; ignores clustering)");
    expect(hitWilson[0]).toMatch(/^0\.5000 \[\d\.\d{4}, \d\.\d{4}\] · n=2 slots · src=s[0-9a-f]{8}$/);
    hitWilson.forEach((c, i) => expect(srcOf(c)).toBe(srcOf(hitK2[i]!)));
    const fr = row(md, "clean false rejection");
    const frWilson = row(md, "clean false rejection, Wilson (descriptive; ignores clustering)");
    frWilson.forEach((c, i) => expect(srcOf(c)).toBe(srcOf(fr[i]!)));
    const nearMissWilson = row(md, "near-miss false rejection, Wilson (descriptive; ignores clustering)");
    expect(nearMissWilson[1]).toMatch(/^undefined \(zero denominator\) · n=0 slots · src=s[0-9a-f]{8}$/);
  });

  it("McNemar b, c and p each print n (paired tasks) and the source of the paired slots", () => {
    const agg = fullAggregate(false);
    const md = renderResultsMarkdown({ meta, measured: agg, mock: null });
    const a = row(md, "A");
    expect(a[0]).toMatch(/^1 · n=1 tasks · src=s[0-9a-f]{8}$/);
    expect(a[1]).toMatch(/^0 · n=1 tasks · src=s[0-9a-f]{8}$/);
    expect(a[2]).toMatch(/^1\.0000 · n=1 tasks · src=s[0-9a-f]{8}$/);
    expect(srcOf(a[0]!)).toBe(`s${agg.stratumB!.mcnemar[0]!.source.slotSetSha256.slice(0, 8)}`);
    expect(agg.stratumB!.mcnemar[0]!.source.slotCount).toBe(2);
  });

  it("McNemar p with no paired task is undefined, still with n and src", () => {
    const agg = aggregate({ defectSlots: [slot(false, "A", "H05", true, "B", "A")], cleanSlots: [], draws: 50 });
    const md = renderResultsMarkdown({ meta, measured: agg, mock: null });
    expect(row(md, "A")[2]).toMatch(/^undefined \(no paired task\) · n=0 tasks · src=s[0-9a-f]{8}$/);
  });

  it("cost per HIT names both the ledger and the HIT slot-set sources; without a ledger, the HIT source", () => {
    const agg = fullAggregate(false);
    const md = renderResultsMarkdown({ meta, measured: agg, measuredCosts: [armACost], mock: null });
    const cost = row(md, "cost per actionable defect found (all-attempt USD / HITs)");
    const hitK2 = row(md, "HIT, k=2 (primary; actionable localization)");
    expect(cost[0]).toBe(`1.0000 USD · n=1 HITs · src=s${ledgerSource.slotSetSha256.slice(0, 8)}+${srcOf(hitK2[0]!)}`);
    expect(cost[1]).toBe(`undefined (no ledger summary for this arm) · n=1 HITs · src=${srcOf(hitK2[1]!)}`);
  });

  it("undefined renders as `undefined (reason)`", () => {
    const md = renderResultsMarkdown({ meta, measured: realAgg, mock: null });
    expect(md).toContain("undefined (no valid replies)");
    expect(md).toContain("undefined (no ledger summary for this arm)");
    expect(md).not.toContain("NaN");
  });

  it("prints the semantic column as NOT RUN", () => {
    const md = renderResultsMarkdown({ meta, measured: realAgg, mock: null });
    expect(md).toContain("| semantic judge | NOT RUN | NOT RUN |");
    expect(md).toContain("Semantic judge: NOT RUN.");
  });

  it("prints both Δ labels with opposite signs", () => {
    const records = [slot(false, "A", "H01", true, "B", "A"), slot(false, "B", "H01", false, "B", "A"), slot(false, "A", "H01", false, "B", "B"), slot(false, "B", "H01", true, "B", "B")];
    const md = renderResultsMarkdown({ meta, measured: aggregate({ defectSlots: records, cleanSlots: [], draws: 50 }), mock: null });
    expect(md).toContain("Δ_self (same − different): 1.0000");
    expect(md).toContain("−Δ_self (different − same): -1.0000");
  });
});

describe("source ids", () => {
  const hitSource = realAgg.stratumA.arms[0]!.hit.k2.source;

  it("throw when one 8-hex id would name two different slot sets", () => {
    const h = hitSource.slotSetSha256;
    const collided = `${h.slice(0, 8)}${h[8] === "0" ? "1" : "0"}${h.slice(9)}`;
    const cost: ArmCost = { arm: "A", allAttemptUsd: { kind: "value", value: 1 }, source: { ...ledgerSource, slotSetSha256: collided } };
    expect(() => renderResultsMarkdown({ meta, measured: realAgg, measuredCosts: [cost], mock: null })).toThrow(SourceIdConflictError);
  });

  it("throw when one slot set arrives with conflicting provenance", () => {
    const cost: ArmCost = { arm: "A", allAttemptUsd: { kind: "value", value: 1 }, source: { ...hitSource, runIds: ["another-run"] } };
    expect(() => renderResultsMarkdown({ meta, measured: realAgg, measuredCosts: [cost], mock: null })).toThrow(SourceIdConflictError);
  });

  it("accept the identical source from two cells, and refuse a slot-set hash that is not 64 hex", () => {
    const same: ArmCost = { arm: "A", allAttemptUsd: { kind: "value", value: 1 }, source: { ...hitSource } };
    expect(() => renderResultsMarkdown({ meta, measured: realAgg, measuredCosts: [same], mock: null })).not.toThrow();
    const bad: ArmCost = { arm: "A", allAttemptUsd: { kind: "value", value: 1 }, source: { ...ledgerSource, slotSetSha256: `sha256:${"d".repeat(57)}` } };
    expect(() => renderResultsMarkdown({ meta, measured: realAgg, measuredCosts: [bad], mock: null })).toThrow(/64 lowercase hex/);
  });
});

describe("results.json", () => {
  it("is deterministic and says NOT MEASURED without a measured aggregate", () => {
    const a = renderResultsJson({ meta, measured: null, mock: mockAgg });
    const b = renderResultsJson({ meta, measured: null, mock: mockAgg });
    expect(a).toBe(b);
    const json = JSON.parse(a) as { measured: unknown; semanticJudge: string; mock: { stamp: string } };
    expect(json.measured).toBe("NOT MEASURED");
    expect(json.semanticJudge).toBe("NOT RUN");
    expect(json.mock.stamp).toBe("MOCK");
  });

  it("carries the Wilson and McNemar sources", () => {
    const json = JSON.parse(renderResultsJson({ meta, measured: fullAggregate(false), mock: null })) as {
      measured: { stratumA: { arms: { hitWilsonPooled: { source: { slotCount: number } } }[] }; stratumB: { mcnemar: { source: { slotCount: number } }[] } };
    };
    expect(json.measured.stratumA.arms[0]!.hitWilsonPooled.source.slotCount).toBe(2);
    expect(json.measured.stratumB.mcnemar.map((m) => m.source.slotCount)).toEqual([2, 2]);
  });
});
