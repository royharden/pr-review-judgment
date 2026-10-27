// Written, never run in Dirty Mode. PLAN M3.6: constant-shift bootstrap returns the shift; repeat duplication leaves
// the cluster count unchanged; zero denominator -> undefined. Also: preregistered seeds/draws match the protocol file.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_CI_LEVEL,
  BOOTSTRAP_DRAWS,
  BOOTSTRAP_SEED_STRATUM_A,
  BOOTSTRAP_SEED_STRATUM_B,
  bootstrapMeanOverTasks,
  bootstrapPairedDifference,
  clusterBootstrap,
  clustersBy,
  drawClusterIndices,
} from "../../../src/core/stats/bootstrap.ts";
import { mean, ratio, undefinedValue } from "../../../src/core/stats/value.ts";

const prereg = JSON.parse(readFileSync(new URL("../../../protocol/preregistration.json", import.meta.url), "utf8")) as {
  seeds: { bootstrap_stratum_a: number; bootstrap_stratum_b: number };
  bootstrap: { draws: number; ci_level: number; cluster: string; stratum_b_paired: boolean };
};

describe("preregistered constants", () => {
  it("match protocol/preregistration.json", () => {
    expect(BOOTSTRAP_SEED_STRATUM_A).toBe(prereg.seeds.bootstrap_stratum_a);
    expect(BOOTSTRAP_SEED_STRATUM_B).toBe(prereg.seeds.bootstrap_stratum_b);
    expect(BOOTSTRAP_DRAWS).toBe(prereg.bootstrap.draws);
    expect(BOOTSTRAP_CI_LEVEL).toBe(prereg.bootstrap.ci_level);
    expect(prereg.bootstrap.cluster).toBe("task");
    expect(prereg.bootstrap.stratum_b_paired).toBe(true);
  });
});

describe("constant shift", () => {
  it("paired difference of x + c vs x returns exactly c for point and both bounds", () => {
    const xs = [0, 0.5, 1, 0.25, 0.75, 0.5, 0, 1, 0.25, 0.5];
    const shift = 0.25;
    const pairs = xs.map((x, i) => ({ id: `H${String(i + 1).padStart(2, "0")}`, first: x + shift, second: x }));
    const r = bootstrapPairedDifference(pairs, { seed: BOOTSTRAP_SEED_STRATUM_B });
    for (const v of [r.point, r.lower, r.upper, r.drawMean]) {
      expect(v.kind).toBe("value");
      if (v.kind === "value") expect(v.value).toBeCloseTo(shift, 12);
    }
    expect(r.draws).toBe(10_000);
    expect(r.clusterCount).toBe(10);
  });
});

describe("clusters are tasks", () => {
  it("duplicating repeats leaves the cluster count unchanged", () => {
    const one = ["T01", "T02", "T03"].flatMap((t) => [{ task: t, repeat: 1, hit: 1 }]);
    const three = ["T01", "T02", "T03"].flatMap((t) => [1, 2, 3].map((repeat) => ({ task: t, repeat, hit: 1 })));
    expect(clustersBy(one, (r) => r.task)).toHaveLength(3);
    expect(clustersBy(three, (r) => r.task)).toHaveLength(3);
    const stat = (cs: readonly { rows: readonly { hit: number }[] }[]) => mean(cs.map((c) => c.rows.reduce((s, r) => s + r.hit, 0) / c.rows.length));
    const r1 = clusterBootstrap(clustersBy(one, (r) => r.task), stat, { seed: 4102, draws: 200 });
    const r3 = clusterBootstrap(clustersBy(three, (r) => r.task), stat, { seed: 4102, draws: 200 });
    expect(r1.clusterCount).toBe(3);
    expect(r3.clusterCount).toBe(3);
  });

  it("draw indices depend only on (seed, cluster count, draws): paired by construction", () => {
    expect(drawClusterIndices(5, { seed: 4103, draws: 50 })).toEqual(drawClusterIndices(5, { seed: 4103, draws: 50 }));
    expect(drawClusterIndices(5, { seed: 4103, draws: 50 })).not.toEqual(drawClusterIndices(5, { seed: 4102, draws: 50 }));
  });

  it("clusters are sorted by id regardless of input order", () => {
    const cs = clustersBy([{ t: "T02" }, { t: "T01" }, { t: "T02" }], (r) => r.t);
    expect(cs.map((c) => c.id)).toEqual(["T01", "T02"]);
    expect(cs[1]!.rows).toHaveLength(2);
  });
});

describe("undefined", () => {
  it("zero denominator -> undefined", () => {
    const v = ratio(0, 0);
    expect(v.kind).toBe("undefined");
  });

  it("no clusters -> undefined point and interval", () => {
    const r = bootstrapMeanOverTasks([], { seed: 4102 });
    expect(r.point.kind).toBe("undefined");
    expect(r.lower.kind).toBe("undefined");
    expect(r.upper.kind).toBe("undefined");
  });

  it("undefined point -> undefined interval with the reason", () => {
    const r = clusterBootstrap([{ id: "T01", rows: [1] }], () => undefinedValue("zero denominator"), { seed: 4102, draws: 10 });
    expect(r.point.kind).toBe("undefined");
    expect(r.lower.kind === "undefined" && r.lower.reason).toContain("zero denominator");
  });

  it("any undefined draw makes the interval undefined by default", () => {
    // Statistic undefined whenever the draw does not contain cluster T01.
    const clusters = [
      { id: "T01", rows: [1] },
      { id: "T02", rows: [0] },
      { id: "T03", rows: [0] },
    ];
    const r = clusterBootstrap(clusters, (cs) => (cs.some((c) => c.id === "T01") ? mean(cs.map((c) => c.rows[0]!)) : undefinedValue("no T01")), {
      seed: 4102,
      draws: 500,
    });
    expect(r.point.kind).toBe("value");
    expect(r.droppedDraws).toBeGreaterThan(0);
    expect(r.lower.kind).toBe("undefined");
  });

  it("refuses duplicate cluster ids and one task with two values", () => {
    expect(() => clusterBootstrap([{ id: "T01", rows: [] }, { id: "T01", rows: [] }], () => mean([1]), { seed: 1, draws: 1 })).toThrow();
    expect(() => bootstrapMeanOverTasks([{ id: "T01", value: 1 }, { id: "T01", value: 0 }], { seed: 1, draws: 1 })).toThrow();
  });
});
