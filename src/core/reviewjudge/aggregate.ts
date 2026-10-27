// Aggregation (PLAN §1, §6, M3 acceptance 5). Pure. Equations, symbol for symbol:
//
// Stratum A (descriptive only; never a self-review inference):
//   per-task HIT_t(arm, k) = mean over the task's planned seeded slots (defects x repeats) of 1[outcome_k = HIT]
//                            (UNAVAILABLE and missing slots are non-HITs);
//   HIT(arm, k)            = macro mean over tasks of HIT_t; task-cluster bootstrap 95 % CI, 10,000 draws, seed 4102;
//   A - B                  = mean over tasks present for both arms of (HIT_t(A) - HIT_t(B)), paired draws, seed 4102.
// Stratum B (crossed 2 x 2, reviewer R x author X):
//   H_RX(t)  = reviewer R's mean HIT on author X's seeded changes in task t (2 defects x repeats);
//   D_t      = 1/2 [ (H_AA - H_BA) + (H_BB - H_AB) ];
//   Delta_self = mean over included tasks of D_t (positive = same-model review catches more); also printed as
//   -Delta_self (different - same). Task-cluster bootstrap 95 % CI, 10,000 draws, seed 4103.
//   A task enters only when all four cells exist (both authors admitted and reviewed by both reviewers); every
//   other task is excluded and listed with the reason.
//   The same contrast is computed for clean false rejection F_RX(t) and conservative non-approval C_RX(t) on each
//   author's clean substrate: D^F_t = 1/2 [ (F_AA - F_BA) + (F_BB - F_AB) ] (positive = same-model review rejects
//   more clean code), likewise D^C_t. A task whose cell is undefined (e.g. no valid clean reply) is excluded there.
//   Exploratory exact McNemar within each author group X: one observation per task = (reviewer A HIT, reviewer B HIT)
//   on repeat 1 of the first-seeded defect (defectOrdinal 1) of author X; never pooled over repeats.
// Flip rate = share of (arm, change) pairs with >= 2 repeats whose outcomes disagree (seeded: k=2 outcome; clean:
//   valid verdict or non-valid).
// Every cell carries {value, n, unit, source}; source = run ids + slot count + hash of the slot-id set + mock flag.
// The Wilson intervals and each author group's McNemar result carry a source too (report.ts prints one on every number).
import { hashCanonical } from "../defectcorpus/hashes.ts";
import { compareCodeUnits } from "../defectcorpus/order.ts";
import {
  BOOTSTRAP_SEED_STRATUM_A,
  BOOTSTRAP_SEED_STRATUM_B,
  bootstrapMeanOverTasks,
  bootstrapPairedDifference,
  type BootstrapOptions,
  type BootstrapResult,
} from "../stats/bootstrap.ts";
import { mcnemarFromPairs, type McNemarResult } from "../stats/mcnemar.ts";
import { mean, negate, ratio, undefinedValue, value, type Value } from "../stats/value.ts";
import { wilson, type WilsonInterval } from "../stats/wilson.ts";
import { cleanMetrics, DEFECT_OUTCOMES, type CleanSlotObservation, type DefectOutcome } from "./classify.ts";

export type Stratum = "A" | "B";
export type ModelId = "A" | "B";
export type KKey = "k0" | "k2" | "k5";
export const K_KEYS: readonly KKey[] = ["k0", "k2", "k5"];
export const K_PRIMARY_KEY: KKey = "k2";

export const DELTA_SELF_LABEL = "Δ_self (same − different)" as const;
export const NEG_DELTA_SELF_LABEL = "−Δ_self (different − same)" as const;

export interface SlotProvenance {
  readonly runId: string;
  readonly slotId: string;
  readonly mock: boolean;
}

/** One planned seeded slot (a missing slot is recorded with every outcome UNAVAILABLE). */
export interface DefectSlotRecord extends SlotProvenance {
  readonly stratum: Stratum;
  /** Reviewer arm: "A" | "B" for models, or a baseline id. */
  readonly arm: string;
  readonly taskId: string;
  /** Stratum B: whose substrate; stratum A: null. */
  readonly author: ModelId | null;
  readonly changeId: string;
  /** 1-based seeding order within (task, author); used for the McNemar observation. */
  readonly defectOrdinal: number;
  readonly repeat: number;
  readonly outcomes: Readonly<Record<KKey, DefectOutcome>>;
  /** Findings in a valid reply (0 otherwise) and how many were localized at k = 2. */
  readonly findingCount: number;
  readonly localizedFindingCount: number;
  readonly requiresChangeFindings: number;
  readonly outputTokens: number | null;
}

export interface CleanSlotRecord extends SlotProvenance, CleanSlotObservation {
  readonly stratum: Stratum;
  readonly arm: string;
  readonly taskId: string;
  readonly author: ModelId | null;
  readonly changeId: string;
  readonly variantKind: "clean" | "near_miss";
  readonly repeat: number;
}

export interface CellSource {
  readonly runIds: readonly string[];
  readonly slotCount: number;
  /** sha256 of the canonical JSON of the sorted slot ids. */
  readonly slotSetSha256: string;
  /** True when any contributing slot is mock; such a cell may never enter a measured table. */
  readonly mock: boolean;
}

export interface CellInterval {
  readonly lower: Value;
  readonly upper: Value;
  readonly level: number;
  readonly draws: number;
  readonly seed: number;
  readonly droppedDraws: number;
  readonly algorithm: string;
}

export interface Cell {
  readonly value: Value;
  readonly n: number;
  readonly unit: "tasks" | "slots" | "pairs" | "findings";
  readonly source: CellSource;
  readonly ci: CellInterval | null;
}

export function sourceOf(records: readonly SlotProvenance[]): CellSource {
  const runIds = [...new Set(records.map((r) => r.runId))].sort(compareCodeUnits);
  const slotIds = records.map((r) => r.slotId).sort(compareCodeUnits);
  return { runIds, slotCount: slotIds.length, slotSetSha256: hashCanonical(slotIds), mock: records.some((r) => r.mock) };
}

function cell(v: Value, n: number, unit: Cell["unit"], records: readonly SlotProvenance[], ci: CellInterval | null = null): Cell {
  return { value: v, n, unit, source: sourceOf(records), ci };
}

/** A Wilson interval plus the source of the slot set it counts (every printed number carries a source, PLAN §6). */
export type SourcedWilson = WilsonInterval & { readonly source: CellSource };

function sourcedWilson(successes: number, n: number, records: readonly SlotProvenance[]): SourcedWilson {
  return { ...wilson(successes, n), source: sourceOf(records) };
}

function intervalOf(b: BootstrapResult): CellInterval {
  return { lower: b.lower, upper: b.upper, level: b.level, draws: b.draws, seed: b.seed, droppedDraws: b.droppedDraws, algorithm: b.algorithm };
}

function negateInterval(ci: CellInterval | null): CellInterval | null {
  return ci === null ? null : { ...ci, lower: negate(ci.upper), upper: negate(ci.lower) };
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = out.get(key);
    if (list === undefined) out.set(key, [row]);
    else list.push(row);
  }
  return out;
}

const sortedKeys = <T>(m: ReadonlyMap<string, T>): string[] => [...m.keys()].sort(compareCodeUnits);
const hitOf = (r: DefectSlotRecord, k: KKey): number => (r.outcomes[k] === "HIT" ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------------------------------------------

export interface AggregateInput {
  readonly defectSlots: readonly DefectSlotRecord[];
  readonly cleanSlots: readonly CleanSlotRecord[];
  /** Override draws (tests); defaults to the preregistered 10,000. */
  readonly draws?: number;
}

function validate(input: AggregateInput): void {
  const ids = new Set<string>();
  for (const r of [...input.defectSlots, ...input.cleanSlots]) {
    if (ids.has(r.slotId)) throw new Error(`aggregate: duplicate slot id ${r.slotId}`);
    ids.add(r.slotId);
    if (!Number.isInteger(r.repeat) || r.repeat < 1) throw new Error(`aggregate: slot ${r.slotId} repeat must be >= 1`);
    if (r.stratum === "A" && r.author !== null) throw new Error(`aggregate: stratum A slot ${r.slotId} has an author`);
    if (r.stratum === "B") {
      if (r.author === null) throw new Error(`aggregate: stratum B slot ${r.slotId} has no author`);
      if (r.arm !== "A" && r.arm !== "B") throw new Error(`aggregate: stratum B slot ${r.slotId} arm must be A or B`);
    }
  }
  for (const r of input.defectSlots) {
    for (const k of K_KEYS) {
      if (!(DEFECT_OUTCOMES as readonly string[]).includes(r.outcomes[k])) throw new Error(`aggregate: slot ${r.slotId} bad outcome`);
    }
    if (!Number.isInteger(r.defectOrdinal) || r.defectOrdinal < 1) throw new Error(`aggregate: slot ${r.slotId} defectOrdinal must be >= 1`);
    if (r.localizedFindingCount > r.findingCount) throw new Error(`aggregate: slot ${r.slotId} localized > findings`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Shared per-arm pieces
// ---------------------------------------------------------------------------------------------------------------

export interface PerTaskValue {
  readonly taskId: string;
  readonly value: number;
  /** Planned seeded slots in the task. */
  readonly n: number;
}

function perTaskHit(records: readonly DefectSlotRecord[], k: KKey): PerTaskValue[] {
  const byTask = groupBy(records, (r) => r.taskId);
  return sortedKeys(byTask).map((taskId) => {
    const rows = byTask.get(taskId)!;
    return { taskId, value: rows.reduce((s, r) => s + hitOf(r, k), 0) / rows.length, n: rows.length };
  });
}

function macroCell(perTask: readonly PerTaskValue[], records: readonly SlotProvenance[], options: BootstrapOptions): Cell {
  const boot = bootstrapMeanOverTasks(
    perTask.map((t) => ({ id: t.taskId, value: t.value })),
    options,
  );
  return cell(boot.point, perTask.length, "tasks", records, intervalOf(boot));
}

export interface CleanSummary {
  readonly falseRejection: Cell;
  /** Same slot set (and so the same source) as `falseRejection`; n = valid replies. */
  readonly falseRejectionWilson: SourcedWilson;
  readonly conservativeNonApproval: Cell;
  readonly completionCoverage: Cell;
  readonly missing: number;
}

function cleanSummary(records: readonly CleanSlotRecord[]): CleanSummary {
  const m = cleanMetrics(records);
  return {
    falseRejection: cell(m.falseRejection, m.validReplies, "slots", records),
    falseRejectionWilson: sourcedWilson(m.validRequestChanges, m.validReplies, records),
    conservativeNonApproval: cell(m.conservativeNonApproval, m.planned, "slots", records),
    completionCoverage: cell(m.completionCoverage, m.planned, "slots", records),
    missing: m.missing,
  };
}

export interface FlipRates {
  readonly seeded: Cell;
  readonly clean: Cell;
}

function flipCell<T extends SlotProvenance & { readonly changeId: string; readonly repeat: number }>(
  records: readonly T[],
  outcomeOf: (r: T) => string,
): Cell {
  const byChange = groupBy(records, (r) => r.changeId);
  let pairs = 0;
  let flips = 0;
  for (const id of sortedKeys(byChange)) {
    const rows = byChange.get(id)!;
    if (rows.length < 2) continue;
    pairs++;
    if (new Set(rows.map(outcomeOf)).size > 1) flips++;
  }
  return cell(ratio(flips, pairs, "no change with two or more repeats"), pairs, "pairs", records);
}

function flipRates(defects: readonly DefectSlotRecord[], cleans: readonly CleanSlotRecord[]): FlipRates {
  return {
    seeded: flipCell(defects, (r) => r.outcomes[K_PRIMARY_KEY]),
    clean: flipCell(cleans, (r) => (r.status === "valid" ? `valid:${r.verdict}` : "non_valid")),
  };
}

export interface Burden {
  readonly requiresChangeFindingsPerChange: Cell;
  readonly outputTokensPerChange: Cell;
}

function burden(defects: readonly DefectSlotRecord[], cleans: readonly CleanSlotRecord[]): Burden {
  const all: { readonly requiresChangeFindings: number; readonly outputTokens: number | null; readonly slot: SlotProvenance }[] = [
    ...defects.map((r) => ({ requiresChangeFindings: r.requiresChangeFindings, outputTokens: r.outputTokens, slot: r })),
    ...cleans.map((r) => ({ requiresChangeFindings: r.requiresChangeFindings, outputTokens: r.outputTokens, slot: r })),
  ];
  const slots = all.map((x) => x.slot);
  const withUsage = all.filter((x) => x.outputTokens !== null);
  return {
    requiresChangeFindingsPerChange: cell(
      ratio(all.reduce((s, x) => s + x.requiresChangeFindings, 0), all.length, "no slots"),
      all.length,
      "slots",
      slots,
    ),
    outputTokensPerChange: cell(
      ratio(withUsage.reduce((s, x) => s + x.outputTokens!, 0), withUsage.length, "no slot reported usage"),
      withUsage.length,
      "slots",
      withUsage.map((x) => x.slot),
    ),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Stratum A
// ---------------------------------------------------------------------------------------------------------------

export interface ArmSummaryA {
  readonly arm: string;
  readonly tasks: readonly string[];
  readonly hit: Readonly<Record<KKey, Cell>>;
  readonly perTaskHit: Readonly<Record<KKey, readonly PerTaskValue[]>>;
  /** Macro mean over tasks of the share of slots with >= 1 localized finding (HIT or DEFER), k = 2. */
  readonly anyLocalized: Cell;
  /** Pooled share of planned seeded slots per outcome at k = 2. */
  readonly outcomeShares: Readonly<Record<DefectOutcome, Cell>>;
  /** Pooled HITs at k = 2 over the arm's planned seeded slots; same source as `hit.k2`. */
  readonly hitWilsonPooled: SourcedWilson;
  readonly localizationMatchFraction: Cell;
  readonly clean: CleanSummary;
  readonly nearMiss: CleanSummary;
  readonly flipRate: FlipRates;
  readonly burden: Burden;
  /** Seeded HITs at k = 2 (cost per actionable defect found = all-attempt dollars / this count, report.ts). */
  readonly hitCount: number;
}

export interface PairedDifferenceA {
  readonly first: string;
  readonly second: string;
  readonly label: string;
  readonly tasks: readonly string[];
  readonly excludedTasks: readonly string[];
  readonly difference: Cell;
}

function armSummaryA(arm: string, defects: readonly DefectSlotRecord[], cleans: readonly CleanSlotRecord[], options: BootstrapOptions): ArmSummaryA {
  const perTask = { k0: perTaskHit(defects, "k0"), k2: perTaskHit(defects, "k2"), k5: perTaskHit(defects, "k5") };
  const byTask = groupBy(defects, (r) => r.taskId);
  const anyLocalizedPerTask = sortedKeys(byTask).map((taskId) => {
    const rows = byTask.get(taskId)!;
    const loc = rows.filter((r) => r.outcomes.k2 === "HIT" || r.outcomes.k2 === "DEFER").length;
    return { taskId, value: loc / rows.length, n: rows.length };
  });
  const shares = {} as Record<DefectOutcome, Cell>;
  for (const outcome of DEFECT_OUTCOMES) {
    const count = defects.filter((r) => r.outcomes.k2 === outcome).length;
    shares[outcome] = cell(ratio(count, defects.length, "no seeded slots"), defects.length, "slots", defects);
  }
  const findings = defects.reduce((s, r) => s + r.findingCount, 0);
  const localized = defects.reduce((s, r) => s + r.localizedFindingCount, 0);
  const hitCount = defects.filter((r) => r.outcomes.k2 === "HIT").length;
  return {
    arm,
    tasks: perTask.k2.map((t) => t.taskId),
    hit: { k0: macroCell(perTask.k0, defects, options), k2: macroCell(perTask.k2, defects, options), k5: macroCell(perTask.k5, defects, options) },
    perTaskHit: perTask,
    anyLocalized: macroCell(anyLocalizedPerTask, defects, options),
    outcomeShares: shares,
    hitWilsonPooled: sourcedWilson(hitCount, defects.length, defects),
    localizationMatchFraction: cell(ratio(localized, findings, "no findings in valid replies"), findings, "findings", defects),
    clean: cleanSummary(cleans.filter((r) => r.variantKind === "clean")),
    nearMiss: cleanSummary(cleans.filter((r) => r.variantKind === "near_miss")),
    flipRate: flipRates(defects, cleans),
    burden: burden(defects, cleans),
    hitCount,
  };
}

function pairedDifferenceA(first: ArmSummaryA, second: ArmSummaryA, records: readonly SlotProvenance[], options: BootstrapOptions): PairedDifferenceA {
  const a = new Map(first.perTaskHit.k2.map((t) => [t.taskId, t.value]));
  const b = new Map(second.perTaskHit.k2.map((t) => [t.taskId, t.value]));
  const tasks = [...a.keys()].filter((t) => b.has(t)).sort(compareCodeUnits);
  const excluded = [...new Set([...a.keys(), ...b.keys()])].filter((t) => !(a.has(t) && b.has(t))).sort(compareCodeUnits);
  const boot = bootstrapPairedDifference(
    tasks.map((id) => ({ id, first: a.get(id)!, second: b.get(id)! })),
    options,
  );
  return {
    first: first.arm,
    second: second.arm,
    label: `${first.arm} − ${second.arm} (descriptive paired difference, HIT k=2)`,
    tasks,
    excludedTasks: excluded,
    difference: cell(boot.point, tasks.length, "tasks", records, intervalOf(boot)),
  };
}

export interface StratumASummary {
  readonly arms: readonly ArmSummaryA[];
  readonly modelDifference: PairedDifferenceA | null;
}

function stratumA(defects: readonly DefectSlotRecord[], cleans: readonly CleanSlotRecord[], draws: number | undefined): StratumASummary {
  const options: BootstrapOptions = { seed: BOOTSTRAP_SEED_STRATUM_A, ...(draws === undefined ? {} : { draws }) };
  const armIds = [...new Set([...defects.map((r) => r.arm), ...cleans.map((r) => r.arm)])].sort(compareCodeUnits);
  const arms = armIds.map((arm) =>
    armSummaryA(
      arm,
      defects.filter((r) => r.arm === arm),
      cleans.filter((r) => r.arm === arm),
      options,
    ),
  );
  const modelA = arms.find((a) => a.arm === "A");
  const modelB = arms.find((a) => a.arm === "B");
  const modelRecords = defects.filter((r) => r.arm === "A" || r.arm === "B");
  return {
    arms,
    modelDifference: modelA !== undefined && modelB !== undefined ? pairedDifferenceA(modelA, modelB, modelRecords, options) : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Stratum B
// ---------------------------------------------------------------------------------------------------------------

export const CROSSED_CELLS = ["H_AA", "H_AB", "H_BA", "H_BB"] as const;
export type CrossedCell = (typeof CROSSED_CELLS)[number];

const cellKey = (reviewer: ModelId, author: ModelId): CrossedCell => `H_${reviewer}${author}` as CrossedCell;

/** D_t = 1/2 [ (H_AA - H_BA) + (H_BB - H_AB) ]. */
export function crossedContrast(c: Readonly<Record<CrossedCell, number>>): number {
  return 0.5 * (c.H_AA - c.H_BA + (c.H_BB - c.H_AB));
}

export interface PerTaskCrossed {
  readonly taskId: string;
  readonly cells: Readonly<Record<CrossedCell, number>>;
  readonly d: number;
}

export interface ExcludedTask {
  readonly taskId: string;
  readonly reason: string;
}

export interface CrossedDelta {
  readonly metric: string;
  readonly includedTasks: readonly string[];
  readonly excludedTasks: readonly ExcludedTask[];
  /** Macro means over included tasks, printed before the pooled contrast. */
  readonly cells: Readonly<Record<CrossedCell, Cell>>;
  readonly perTask: readonly PerTaskCrossed[];
  readonly deltaSelf: Cell & { readonly label: typeof DELTA_SELF_LABEL };
  readonly negDeltaSelf: Cell & { readonly label: typeof NEG_DELTA_SELF_LABEL };
}

/**
 * Generic crossed contrast. `taskCell` gives a task's cell value from that cell's records (undefined -> the task is
 * excluded with the reason). Tasks missing any of the four cells are excluded and listed.
 */
function crossedDelta<T extends SlotProvenance & { readonly taskId: string; readonly arm: string; readonly author: ModelId | null }>(
  metric: string,
  records: readonly T[],
  taskCell: (rows: readonly T[]) => Value,
  options: BootstrapOptions,
): CrossedDelta {
  const byTask = groupBy(records, (r) => r.taskId);
  const included: PerTaskCrossed[] = [];
  const excluded: ExcludedTask[] = [];
  const includedRecords: T[] = [];
  for (const taskId of sortedKeys(byTask)) {
    const rows = byTask.get(taskId)!;
    const cells = {} as Record<CrossedCell, number>;
    const problems: string[] = [];
    for (const reviewer of ["A", "B"] as const) {
      for (const author of ["A", "B"] as const) {
        const key = cellKey(reviewer, author);
        const cellRows = rows.filter((r) => r.arm === reviewer && r.author === author);
        if (cellRows.length === 0) {
          problems.push(`${key} missing (paired-task-missing)`);
          continue;
        }
        const v = taskCell(cellRows);
        if (v.kind === "undefined") problems.push(`${key} undefined (${v.reason})`);
        else cells[key] = v.value;
      }
    }
    if (problems.length > 0) {
      excluded.push({ taskId, reason: problems.join("; ") });
      continue;
    }
    included.push({ taskId, cells, d: crossedContrast(cells) });
    includedRecords.push(...rows);
  }
  const boot = bootstrapMeanOverTasks(
    included.map((t) => ({ id: t.taskId, value: t.d })),
    options,
  );
  const cellsOut = {} as Record<CrossedCell, Cell>;
  for (const key of CROSSED_CELLS) {
    const rows = includedRecords.filter((r) => cellKey(r.arm as ModelId, r.author!) === key);
    cellsOut[key] = cell(
      mean(
        included.map((t) => t.cells[key]),
        "no included task",
      ),
      included.length,
      "tasks",
      rows,
    );
  }
  const ci = intervalOf(boot);
  const delta = boot.point.kind === "value" ? boot.point : undefinedValue(included.length === 0 ? "no included task" : boot.point.reason);
  return {
    metric,
    includedTasks: included.map((t) => t.taskId),
    excludedTasks: excluded,
    cells: cellsOut,
    perTask: included,
    deltaSelf: { ...cell(delta, included.length, "tasks", includedRecords, ci), label: DELTA_SELF_LABEL },
    negDeltaSelf: { ...cell(negate(delta), included.length, "tasks", includedRecords, negateInterval(ci)), label: NEG_DELTA_SELF_LABEL },
  };
}

export interface AuthorMcNemar {
  readonly author: ModelId;
  readonly tasks: readonly string[];
  readonly result: McNemarResult;
  /** The slots that formed the pairs (two per included task): b, c and p all come from exactly this set. */
  readonly source: CellSource;
  readonly note: "exploratory; repeat 1 of the first-seeded defect per task; first = reviewer A HIT, second = reviewer B HIT";
}

function mcnemarForAuthor(author: ModelId, defects: readonly DefectSlotRecord[]): AuthorMcNemar {
  const rows = defects.filter((r) => r.author === author && r.repeat === 1 && r.defectOrdinal === 1);
  const byTask = groupBy(rows, (r) => r.taskId);
  const pairs: { unit: string; first: boolean; second: boolean }[] = [];
  const paired: DefectSlotRecord[] = [];
  for (const taskId of sortedKeys(byTask)) {
    const taskRows = byTask.get(taskId)!;
    const a = taskRows.filter((r) => r.arm === "A");
    const b = taskRows.filter((r) => r.arm === "B");
    if (a.length !== 1 || b.length !== 1) continue; // both reviewers' single observation required
    pairs.push({ unit: taskId, first: a[0]!.outcomes.k2 === "HIT", second: b[0]!.outcomes.k2 === "HIT" });
    paired.push(a[0]!, b[0]!);
  }
  return {
    author,
    tasks: pairs.map((p) => p.unit),
    result: mcnemarFromPairs(pairs),
    source: sourceOf(paired),
    note: "exploratory; repeat 1 of the first-seeded defect per task; first = reviewer A HIT, second = reviewer B HIT",
  };
}

export interface StratumBSummary {
  readonly hit: Readonly<Record<KKey, CrossedDelta>>;
  readonly falseRejection: CrossedDelta;
  readonly conservativeNonApproval: CrossedDelta;
  readonly mcnemar: readonly AuthorMcNemar[];
  readonly flipRate: Readonly<Record<ModelId, FlipRates>>;
}

function stratumB(defects: readonly DefectSlotRecord[], cleans: readonly CleanSlotRecord[], draws: number | undefined): StratumBSummary {
  const options: BootstrapOptions = { seed: BOOTSTRAP_SEED_STRATUM_B, ...(draws === undefined ? {} : { draws }) };
  const hitDelta = (k: KKey): CrossedDelta =>
    crossedDelta(`HIT (k=${k.slice(1)})`, defects, (rows) => value(rows.reduce((s, r) => s + hitOf(r, k), 0) / rows.length), options);
  const cleanOnly = cleans.filter((r) => r.variantKind === "clean");
  return {
    hit: { k0: hitDelta("k0"), k2: hitDelta("k2"), k5: hitDelta("k5") },
    falseRejection: crossedDelta("clean false rejection", cleanOnly, (rows) => cleanMetrics(rows).falseRejection, options),
    conservativeNonApproval: crossedDelta("clean conservative non-approval", cleanOnly, (rows) => cleanMetrics(rows).conservativeNonApproval, options),
    mcnemar: [mcnemarForAuthor("A", defects), mcnemarForAuthor("B", defects)],
    flipRate: {
      A: flipRates(defects.filter((r) => r.arm === "A"), cleans.filter((r) => r.arm === "A")),
      B: flipRates(defects.filter((r) => r.arm === "B"), cleans.filter((r) => r.arm === "B")),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------

export interface AggregateResult {
  readonly schema: "aggregate/v1";
  readonly mock: boolean;
  readonly stratumA: StratumASummary;
  readonly stratumB: StratumBSummary | null;
}

export function aggregate(input: AggregateInput): AggregateResult {
  validate(input);
  const aDefects = input.defectSlots.filter((r) => r.stratum === "A");
  const aCleans = input.cleanSlots.filter((r) => r.stratum === "A");
  const bDefects = input.defectSlots.filter((r) => r.stratum === "B");
  const bCleans = input.cleanSlots.filter((r) => r.stratum === "B");
  const all: readonly SlotProvenance[] = [...input.defectSlots, ...input.cleanSlots];
  return {
    schema: "aggregate/v1",
    mock: all.some((r) => r.mock),
    stratumA: stratumA(aDefects, aCleans, input.draws),
    stratumB: bDefects.length + bCleans.length === 0 ? null : stratumB(bDefects, bCleans, input.draws),
  };
}

