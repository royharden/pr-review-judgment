// Results writer (PLAN §6 results table, K20, M3 acceptance 8). Pure: returns the text of results/results.md and
// results/results.json; only `eval` (M4) writes them to disk, and only from a terminal run.
//
// Rules:
// - MOCK never enters a measured table: the measured aggregate is walked and ANY `mock: true` (top level or on a
//   cell source) makes the writer throw MockInMeasuredError. Mock aggregates go to a separate section stamped MOCK on
//   the heading and on every cell.
// - Every number cell prints {value, n, source}: `value [CI] · n=N unit · src=<slot-set id>` (Cells, Wilson intervals,
//   McNemar b/c/p; cost per HIT prints `src=<ledger id>+<HIT slot-set id>`), with a sources table mapping each id
//   (`s` + 8 hex chars of the slot-set hash) to its run ids, slot count and full slot-set hash. An id that would name
//   two different slot sets, or one slot set with conflicting provenance, throws SourceIdConflictError.
// - An undefined value prints `undefined (reason)`, never 0 or NaN.
// - The semantic-judge column prints NOT RUN (PLAN K17). Both Δ labels are printed: Δ_self (same − different) and
//   −Δ_self (different − same) (PLAN K4).
// - With no measured aggregate, the measured section prints NOT MEASURED.
import { formatValue, ratio, undefinedValue, value, type Value } from "../stats/value.ts";
import {
  CROSSED_CELLS,
  DELTA_SELF_LABEL,
  K_KEYS,
  NEG_DELTA_SELF_LABEL,
  type AggregateResult,
  type ArmSummaryA,
  type AuthorMcNemar,
  type Cell,
  type CellSource,
  type CleanSummary,
  type CrossedDelta,
  type SourcedWilson,
} from "./aggregate.ts";
import { DEFECT_OUTCOMES } from "./classify.ts";

export const REPORT_STATES = ["collecting", "terminal_complete", "terminal_partial", "frozen", "published"] as const;
export type ReportState = (typeof REPORT_STATES)[number];

export const SEMANTIC_COLUMN = "NOT RUN" as const;
export const NOT_MEASURED = "NOT MEASURED" as const;
export const MOCK_STAMP = "MOCK" as const;

export class MockInMeasuredError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`MOCK input in a measured table at ${path}`);
    this.name = "MockInMeasuredError";
    this.path = path;
  }
}

/** Throws if any object inside `value` has `mock: true`. */
export function assertNoMock(value: unknown, path = "measured"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoMock(item, `${path}[${i}]`));
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.mock === true) throw new MockInMeasuredError(path);
  for (const [key, child] of Object.entries(record)) assertNoMock(child, `${path}.${key}`);
}

export interface ArmCost {
  readonly arm: string;
  /** All-attempt dollars for the arm's slots (ledger, M4); undefined when any attempt's billing is unknown. */
  readonly allAttemptUsd: Value;
  /** Built with aggregate.ts `sourceOf` over the ledger's slot records, so a slot set shared with a cell agrees. */
  readonly source: CellSource;
}

export interface ReportMeta {
  readonly reportState: ReportState;
  /** ISO time supplied by the host. */
  readonly generatedAt: string;
  readonly promptSha256: string;
  readonly rulesetSha256: string;
  readonly protocolSha256: string | null;
}

export interface ReportInput {
  readonly meta: ReportMeta;
  readonly measured: AggregateResult | null;
  readonly measuredCosts?: readonly ArmCost[];
  readonly mock: AggregateResult | null;
  readonly mockCosts?: readonly ArmCost[];
}

// ---------------------------------------------------------------------------------------------------------------
// Cell rendering
// ---------------------------------------------------------------------------------------------------------------

interface Renderer {
  readonly stamp: string;
  readonly sources: Map<string, CellSource>;
}

export class SourceIdConflictError extends Error {
  readonly id: string;
  constructor(id: string, detail: string) {
    super(`source id ${id}: ${detail}`);
    this.name = "SourceIdConflictError";
    this.id = id;
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * `s` + the first 8 hex chars of the slot-set hash. Registers the source for the sources table and throws if the id
 * already names a different slot set (a 32-bit prefix collision) or the same slot set with different provenance,
 * since one id can resolve to only one sources-table row.
 */
function sourceId(r: Renderer, source: CellSource): string {
  if (!SHA256_HEX.test(source.slotSetSha256)) throw new Error(`report: slot-set hash is not 64 lowercase hex: ${source.slotSetSha256}`);
  const id = `s${source.slotSetSha256.slice(0, 8)}`;
  const known = r.sources.get(id);
  if (known === undefined) {
    r.sources.set(id, source);
    return id;
  }
  if (known.slotSetSha256 !== source.slotSetSha256) {
    throw new SourceIdConflictError(id, `maps to slot sets ${known.slotSetSha256} and ${source.slotSetSha256}`);
  }
  if (known.slotCount !== source.slotCount || known.mock !== source.mock || known.runIds.join("\u0000") !== source.runIds.join("\u0000")) {
    throw new SourceIdConflictError(id, "one slot set with conflicting run ids, slot count or mock flag");
  }
  return id;
}

function renderCell(r: Renderer, c: Cell): string {
  const ci = c.ci === null ? "" : ` [${formatValue(c.ci.lower)}, ${formatValue(c.ci.upper)}]`;
  return `${r.stamp}${formatValue(c.value)}${ci} · n=${c.n} ${c.unit} · src=${sourceId(r, c.source)}`;
}

function renderWilson(r: Renderer, w: SourcedWilson): string {
  const src = sourceId(r, w.source);
  if (w.kind === "undefined") return `${r.stamp}undefined (${w.reason}) · n=${w.n} slots · src=${src}`;
  return `${r.stamp}${w.estimate.toFixed(4)} [${w.lower.toFixed(4)}, ${w.upper.toFixed(4)}] · n=${w.n} slots · src=${src}`;
}

/**
 * All-attempt dollars / HITs. Two inputs, two sources: the ledger summary's (cost) and the arm's seeded slots (the HIT
 * count, same slot set as "HIT, k=2"), printed as `src=<cost>+<HITs>`; without a ledger summary only the HIT source.
 */
function costPerHit(r: Renderer, arm: ArmSummaryA, costs: readonly ArmCost[] | undefined): string {
  const hits = `n=${arm.hitCount} HITs`;
  const hitSrc = sourceId(r, arm.hit.k2.source);
  const cost = costs?.find((c) => c.arm === arm.arm);
  if (cost === undefined) return `${r.stamp}undefined (no ledger summary for this arm) · ${hits} · src=${hitSrc}`;
  const v = cost.allAttemptUsd.kind === "undefined" ? cost.allAttemptUsd : ratio(cost.allAttemptUsd.value, arm.hitCount, "no actionable defect found");
  return `${r.stamp}${formatValue(v)} USD · ${hits} · src=${sourceId(r, cost.source)}+${hitSrc}`;
}

/** One McNemar number (b, c or p): n = paired tasks, source = the paired slots. p is undefined with no paired task. */
function renderMcNemar(r: Renderer, m: AuthorMcNemar, what: "b" | "c" | "p"): string {
  const text = what === "p" ? formatValue(m.result.n === 0 ? undefinedValue("no paired task") : value(m.result.p)) : String(m.result[what]);
  return `${r.stamp}${text} · n=${m.result.n} tasks · src=${sourceId(r, m.source)}`;
}

const escapeCell = (text: string): string => text.replace(/\|/g, "\\|");

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.map(escapeCell).join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function cleanRows(r: Renderer, label: string, arms: readonly ArmSummaryA[], pick: (a: ArmSummaryA) => CleanSummary): string[][] {
  return [
    [`${label} false rejection`, ...arms.map((a) => renderCell(r, pick(a).falseRejection))],
    [`${label} false rejection, Wilson (descriptive; ignores clustering)`, ...arms.map((a) => renderWilson(r, pick(a).falseRejectionWilson))],
    [`${label} conservative non-approval`, ...arms.map((a) => renderCell(r, pick(a).conservativeNonApproval))],
    [`${label} completion coverage`, ...arms.map((a) => renderCell(r, pick(a).completionCoverage))],
  ];
}

function stratumATable(r: Renderer, agg: AggregateResult, costs: readonly ArmCost[] | undefined): string {
  const arms = agg.stratumA.arms;
  if (arms.length === 0) return "No stratum A slots.";
  const rows: string[][] = [
    ["HIT, k=2 (primary; actionable localization)", ...arms.map((a) => renderCell(r, a.hit.k2))],
    ["HIT, k=0", ...arms.map((a) => renderCell(r, a.hit.k0))],
    ["HIT, k=5", ...arms.map((a) => renderCell(r, a.hit.k5))],
    ["any-localized, k=2", ...arms.map((a) => renderCell(r, a.anyLocalized))],
    ...DEFECT_OUTCOMES.map((o) => [`share ${o}, k=2`, ...arms.map((a) => renderCell(r, a.outcomeShares[o]))]),
    ["HIT pooled, Wilson (descriptive; ignores clustering)", ...arms.map((a) => renderWilson(r, a.hitWilsonPooled))],
    ["localization-match fraction (not factual precision)", ...arms.map((a) => renderCell(r, a.localizationMatchFraction))],
    ...cleanRows(r, "clean", arms, (a) => a.clean),
    ...cleanRows(r, "near-miss", arms, (a) => a.nearMiss),
    ["burden: requires_change findings per change", ...arms.map((a) => renderCell(r, a.burden.requiresChangeFindingsPerChange))],
    ["burden: output tokens per change", ...arms.map((a) => renderCell(r, a.burden.outputTokensPerChange))],
    ["flip rate, seeded", ...arms.map((a) => renderCell(r, a.flipRate.seeded))],
    ["flip rate, clean", ...arms.map((a) => renderCell(r, a.flipRate.clean))],
    ["cost per actionable defect found (all-attempt USD / HITs)", ...arms.map((a) => costPerHit(r, a, costs))],
    ["semantic judge", ...arms.map(() => SEMANTIC_COLUMN)],
  ];
  const out = [table(["metric", ...arms.map((a) => `arm ${a.arm}`)], rows)];
  const diff = agg.stratumA.modelDifference;
  if (diff !== null) {
    out.push(
      "",
      `${diff.label}: ${renderCell(r, diff.difference)}`,
      `Tasks: ${diff.tasks.join(", ") || "none"}; excluded (not reviewed by both): ${diff.excludedTasks.join(", ") || "none"}.`,
    );
  }
  return out.join("\n");
}

function crossedBlock(r: Renderer, d: CrossedDelta): string {
  const lines = [
    `#### ${d.metric}`,
    "",
    table(
      ["cell (reviewer R, author X)", "macro mean over included tasks"],
      CROSSED_CELLS.map((key) => [key, renderCell(r, d.cells[key])]),
    ),
    "",
    `- ${DELTA_SELF_LABEL}: ${renderCell(r, d.deltaSelf)}`,
    `- ${NEG_DELTA_SELF_LABEL}: ${renderCell(r, d.negDeltaSelf)}`,
    `- Included tasks: ${d.includedTasks.join(", ") || "none"}`,
    `- Excluded tasks: ${d.excludedTasks.map((e) => `${e.taskId} (${e.reason})`).join("; ") || "none"}`,
  ];
  return lines.join("\n");
}

function stratumBSection(r: Renderer, agg: AggregateResult): string {
  const b = agg.stratumB;
  if (b === null) return "Stratum B: no slots (B NOT RUN).";
  const parts = [
    "D_t = ½[(H_AA − H_BA) + (H_BB − H_AB)]; H_RX = reviewer R's mean HIT on author X's seeded changes in task t. " +
      "Positive Δ_self = same-model review catches more (for false rejection and conservative non-approval: rejects more).",
    "",
    ...K_KEYS.map((k) => crossedBlock(r, b.hit[k])),
    crossedBlock(r, b.falseRejection),
    crossedBlock(r, b.conservativeNonApproval),
    "",
    "#### Exploratory exact McNemar (no p-value gate)",
    "",
    "One observation per task (repeat 1 of the first-seeded defect); n = paired tasks.",
    "",
    table(
      ["author group", "b (A hit, B miss)", "c (A miss, B hit)", "exact two-sided p"],
      b.mcnemar.map((m) => [`${r.stamp}${m.author}`, renderMcNemar(r, m, "b"), renderMcNemar(r, m, "c"), renderMcNemar(r, m, "p")]),
    ),
    "",
    table(
      ["flip rate", "reviewer A", "reviewer B"],
      [
        ["seeded", renderCell(r, b.flipRate.A.seeded), renderCell(r, b.flipRate.B.seeded)],
        ["clean", renderCell(r, b.flipRate.A.clean), renderCell(r, b.flipRate.B.clean)],
      ],
    ),
  ];
  return parts.join("\n");
}

function sourcesTable(r: Renderer): string {
  const ids = [...r.sources.keys()].sort();
  if (ids.length === 0) return "No sources.";
  return table(
    ["src", "run ids", "slots", "slot-set sha256", "mock"],
    ids.map((id) => {
      const s = r.sources.get(id)!;
      return [id, s.runIds.join(", ") || "none", String(s.slotCount), s.slotSetSha256, s.mock ? MOCK_STAMP : "no"];
    }),
  );
}

function aggregateSection(agg: AggregateResult, stamp: string, costs: readonly ArmCost[] | undefined): string {
  const r: Renderer = { stamp, sources: new Map() };
  const a = stratumATable(r, agg, costs);
  const b = stratumBSection(r, agg);
  return [
    "### Stratum A (descriptive only; never a self-review inference)",
    "",
    a,
    "",
    "### Stratum B (crossed author × reviewer)",
    "",
    b,
    "",
    "### Sources",
    "",
    sourcesTable(r),
  ].join("\n");
}

export function renderResultsMarkdown(input: ReportInput): string {
  if (input.measured !== null) {
    assertNoMock(input.measured);
    assertNoMock(input.measuredCosts ?? [], "measuredCosts");
  }
  const { meta } = input;
  const out = [
    "# Results",
    "",
    `Report state: ${meta.reportState}. Generated: ${meta.generatedAt}.`,
    `Prompt sha256: ${meta.promptSha256}. Diff-heuristic rule set sha256: ${meta.rulesetSha256}. Protocol sha256: ${meta.protocolSha256 ?? "unlocked"}.`,
    "Semantic judge: NOT RUN. Labels: " + `${DELTA_SELF_LABEL}; ${NEG_DELTA_SELF_LABEL}.`,
    "",
    "## Measured results",
    "",
    input.measured === null ? `${NOT_MEASURED}: no measured run is included in this report.` : aggregateSection(input.measured, "", input.measuredCosts),
  ];
  if (input.mock !== null) {
    out.push(
      "",
      `## ${MOCK_STAMP}: synthetic fixtures, not a measurement`,
      "",
      `Every value in this section is stamped ${MOCK_STAMP} and comes from recorded or synthetic fixtures. It shows the table layout only.`,
      "",
      aggregateSection(input.mock, `${MOCK_STAMP} `, input.mockCosts),
    );
  }
  return out.join("\n") + "\n";
}

export interface ResultsJson {
  readonly schema: "results/v1";
  readonly meta: ReportMeta;
  readonly labels: { readonly deltaSelf: typeof DELTA_SELF_LABEL; readonly negDeltaSelf: typeof NEG_DELTA_SELF_LABEL };
  readonly semanticJudge: typeof SEMANTIC_COLUMN;
  readonly measured: AggregateResult | typeof NOT_MEASURED;
  readonly measuredCosts: readonly ArmCost[];
  readonly mock: { readonly stamp: typeof MOCK_STAMP; readonly aggregate: AggregateResult; readonly costs: readonly ArmCost[] } | null;
}

export function buildResultsJson(input: ReportInput): ResultsJson {
  if (input.measured !== null) {
    assertNoMock(input.measured);
    assertNoMock(input.measuredCosts ?? [], "measuredCosts");
  }
  return {
    schema: "results/v1",
    meta: input.meta,
    labels: { deltaSelf: DELTA_SELF_LABEL, negDeltaSelf: NEG_DELTA_SELF_LABEL },
    semanticJudge: SEMANTIC_COLUMN,
    measured: input.measured ?? NOT_MEASURED,
    measuredCosts: input.measuredCosts ?? [],
    mock: input.mock === null ? null : { stamp: MOCK_STAMP, aggregate: input.mock, costs: input.mockCosts ?? [] },
  };
}

export function renderResultsJson(input: ReportInput): string {
  return JSON.stringify(buildResultsJson(input), null, 2) + "\n";
}
