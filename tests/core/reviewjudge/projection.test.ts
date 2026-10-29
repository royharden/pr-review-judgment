// Written, never run in Dirty Mode. Per-(reviewer, repeat) seeded presentation order (PLAN §3.5).
import { describe, expect, it } from "vitest";
import { headFileBounds, presentationOrder } from "../../../src/core/reviewjudge/projection.ts";
import { deriveSeed } from "../../../src/core/stats/prng.ts";

const ids = ["c_0000000001", "c_0000000002", "c_0000000003", "c_0000000004", "c_0000000005", "c_0000000006", "c_0000000007", "c_0000000008"];

describe("presentationOrder", () => {
  it("is a deterministic permutation with its seed recorded", () => {
    const o = presentationOrder(ids, 4101, "A", 1);
    expect(presentationOrder(ids, 4101, "A", 1)).toEqual(o);
    expect([...o.changeIds].sort()).toEqual(ids);
    expect(o.seed).toBe(deriveSeed(4101, "presentation-order", "A", "1"));
    expect(o.policy).toBe("presentation-order/v1");
  });

  it("does not depend on the caller's input order", () => {
    expect(presentationOrder([...ids].reverse(), 4101, "B", 2).changeIds).toEqual(presentationOrder(ids, 4101, "B", 2).changeIds);
  });

  it("differs by reviewer and by repeat (seeds differ)", () => {
    const a1 = presentationOrder(ids, 4101, "A", 1);
    expect(presentationOrder(ids, 4101, "B", 1).seed).not.toBe(a1.seed);
    expect(presentationOrder(ids, 4101, "A", 2).seed).not.toBe(a1.seed);
  });

  it("refuses duplicate ids, empty reviewer and repeat < 1", () => {
    expect(() => presentationOrder(["c_0000000001", "c_0000000001"], 1, "A", 1)).toThrow();
    expect(() => presentationOrder(ids, 1, "", 1)).toThrow();
    expect(() => presentationOrder(ids, 1, "A", 0)).toThrow();
  });
});

describe("headFileBounds", () => {
  it("lists the projection's files with line counts", () => {
    expect(
      headFileBounds({ changeId: "c_0000000001", spec: "s", diff: "", files: [{ path: "src/a.ts", lineCount: 4, numberedHead: "1 | a" }] }),
    ).toEqual([{ path: "src/a.ts", lineCount: 4 }]);
  });
});
