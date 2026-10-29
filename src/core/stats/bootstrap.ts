// Task-cluster percentile bootstrap, paired (PLAN §6). Pure.
// Design-informed by S36 `9e281d0` src/core/judgestats/bootstrap.ts (resampling units, seeded draws, exposed draw
// indices for paired comparisons, dropped-draw accounting); implemented here (PLAN K13, not vendored).
//
// Preregistered rules implemented here:
// - The resampling unit is the TASK. A cluster carries every row of its task (all variants, both authors, all
//   repeats), so repeats and variants never act as independent units: duplicating a task's repeats leaves the
//   cluster count unchanged.
// - Each draw resamples whole clusters with replacement (n clusters out of n), from mulberry32(seed). Draw indices
//   depend only on (seed, cluster count, draws), so two statistics bootstrapped over the same clusters with the same
//   seed see identical draws: comparisons are PAIRED by construction (A - B, and D_t which is already a within-task
//   contrast).
// - Point estimate = the statistic on the observed clusters (a MEAN over tasks for every preregistered statistic,
//   never a median). The interval is the type-7 percentile interval of the draw statistics; the mean of the draw
//   statistics is reported alongside, the median never.
// - Defaults: 10,000 draws, 95 %, seeds 4102 (stratum A) and 4103 (stratum B), matching
//   protocol/preregistration.json (a test source asserts the match; src/core cannot read files).
// - A draw whose statistic is undefined is dropped and counted. With the default maxUndefinedShare = 0, any dropped
//   draw makes the interval undefined (with the count as the reason). Preregistered statistics are means of
//   per-task values computed before resampling, so their draws are always defined.
import { mulberry32 } from "./prng.ts";
import { quantileSorted } from "./quantile.ts";
import { compareCodeUnits } from "../defectcorpus/order.ts";
import { mean, undefinedValue, value, type Value } from "./value.ts";

export const BOOTSTRAP_ALGORITHM = "task-cluster-percentile-bootstrap/v1 (mulberry32, type-7, paired draws)" as const;
export const BOOTSTRAP_DRAWS = 10_000;
export const BOOTSTRAP_CI_LEVEL = 0.95;
export const BOOTSTRAP_SEED_STRATUM_A = 4102;
export const BOOTSTRAP_SEED_STRATUM_B = 4103;

export interface Cluster<T> {
  /** Task id. */
  readonly id: string;
  readonly rows: readonly T[];
}

/** Group rows into task clusters, sorted by id (row order inside a cluster is kept). Input order does not matter. */
export function clustersBy<T>(rows: readonly T[], clusterOf: (row: T) => string): Cluster<T>[] {
  const byId = new Map<string, T[]>();
  for (const row of rows) {
    const id = clusterOf(row);
    const list = byId.get(id);
    if (list === undefined) byId.set(id, [row]);
    else list.push(row);
  }
  return [...byId.keys()].sort(compareCodeUnits).map((id) => ({ id, rows: byId.get(id)! }));
}

export interface BootstrapOptions {
  readonly seed: number;
  readonly draws?: number;
  readonly level?: number;
  /** Max share of undefined draws before the interval is undefined. Default 0. */
  readonly maxUndefinedShare?: number;
}

interface Resolved {
  readonly seed: number;
  readonly draws: number;
  readonly level: number;
  readonly maxUndefinedShare: number;
}

function resolve(options: BootstrapOptions): Resolved {
  const r = {
    seed: options.seed,
    draws: options.draws ?? BOOTSTRAP_DRAWS,
    level: options.level ?? BOOTSTRAP_CI_LEVEL,
    maxUndefinedShare: options.maxUndefinedShare ?? 0,
  };
  if (!Number.isInteger(r.draws) || r.draws < 1) throw new Error(`bootstrap: draws must be a positive integer, got ${r.draws}`);
  if (!(r.level > 0 && r.level < 1)) throw new Error(`bootstrap: level must be in (0, 1), got ${r.level}`);
  if (!(r.maxUndefinedShare >= 0 && r.maxUndefinedShare < 1)) throw new Error("bootstrap: maxUndefinedShare must be in [0, 1)");
  return r;
}

/**
 * Cluster indices of every draw (draws x nClusters), fully determined by (seed, nClusters, draws). Exposed so tests
 * and callers can show that two statistics used identical draws.
 */
export function drawClusterIndices(nClusters: number, options: BootstrapOptions): number[][] {
  const r = resolve(options);
  if (!Number.isInteger(nClusters) || nClusters < 1) throw new Error("drawClusterIndices: need at least one cluster");
  const prng = mulberry32(r.seed);
  const out: number[][] = [];
  for (let d = 0; d < r.draws; d++) {
    const draw = new Array<number>(nClusters);
    for (let i = 0; i < nClusters; i++) draw[i] = prng.int(nClusters);
    out.push(draw);
  }
  return out;
}

export interface BootstrapResult {
  readonly algorithm: typeof BOOTSTRAP_ALGORITHM;
  readonly point: Value;
  readonly lower: Value;
  readonly upper: Value;
  /** Mean of the defined draw statistics (reported; never the median). */
  readonly drawMean: Value;
  readonly clusterCount: number;
  readonly draws: number;
  readonly droppedDraws: number;
  readonly seed: number;
  readonly level: number;
}

export type ClusterStatistic<T> = (clusters: readonly Cluster<T>[]) => Value;

export function clusterBootstrap<T>(
  clusters: readonly Cluster<T>[],
  statistic: ClusterStatistic<T>,
  options: BootstrapOptions,
): BootstrapResult {
  const r = resolve(options);
  const base = { algorithm: BOOTSTRAP_ALGORITHM, clusterCount: clusters.length, draws: r.draws, seed: r.seed, level: r.level };
  const ids = new Set<string>();
  for (const c of clusters) {
    if (ids.has(c.id)) throw new Error(`clusterBootstrap: duplicate cluster id ${c.id}`);
    ids.add(c.id);
  }
  if (clusters.length === 0) {
    const u = undefinedValue("no task clusters");
    return { ...base, point: u, lower: u, upper: u, drawMean: u, droppedDraws: 0 };
  }
  const point = statistic(clusters);
  if (point.kind === "undefined") {
    const u = undefinedValue(`point statistic undefined: ${point.reason}`);
    return { ...base, point, lower: u, upper: u, drawMean: u, droppedDraws: 0 };
  }
  const stats: number[] = [];
  let dropped = 0;
  for (const draw of drawClusterIndices(clusters.length, r)) {
    const s = statistic(draw.map((i) => clusters[i]!));
    if (s.kind === "value") stats.push(s.value);
    else dropped++;
  }
  if (stats.length === 0 || dropped / r.draws > r.maxUndefinedShare) {
    const u = undefinedValue(`${dropped} of ${r.draws} draws undefined`);
    return { ...base, point, lower: u, upper: u, drawMean: u, droppedDraws: dropped };
  }
  stats.sort((a, b) => a - b);
  const alpha = (1 - r.level) / 2;
  return {
    ...base,
    point,
    lower: value(quantileSorted(stats, alpha)),
    upper: value(quantileSorted(stats, 1 - alpha)),
    drawMean: mean(stats),
    droppedDraws: dropped,
  };
}

/** One defined number per task (e.g. a task's HIT rate, or its D_t). */
export interface ClusterValue {
  readonly id: string;
  readonly value: number;
}

/** Bootstrap of the macro mean over tasks of per-task values. */
export function bootstrapMeanOverTasks(perTask: readonly ClusterValue[], options: BootstrapOptions): BootstrapResult {
  const clusters = clustersBy(perTask, (row) => row.id);
  for (const c of clusters) {
    if (c.rows.length !== 1) throw new Error(`bootstrapMeanOverTasks: task ${c.id} has ${c.rows.length} values; expected one`);
  }
  return clusterBootstrap(clusters, (cs) => mean(cs.map((c) => c.rows[0]!.value)), options);
}

/** Paired per-task values of two arms (both measured on the same task). */
export interface PairedClusterValue {
  readonly id: string;
  readonly first: number;
  readonly second: number;
}

/** Bootstrap of mean(first) - mean(second) with both arms on identical task draws (paired). */
export function bootstrapPairedDifference(pairs: readonly PairedClusterValue[], options: BootstrapOptions): BootstrapResult {
  const clusters = clustersBy(pairs, (row) => row.id);
  for (const c of clusters) {
    if (c.rows.length !== 1) throw new Error(`bootstrapPairedDifference: task ${c.id} has ${c.rows.length} pairs; expected one`);
  }
  return clusterBootstrap(clusters, (cs) => mean(cs.map((c) => c.rows[0]!.first - c.rows[0]!.second)), options);
}
