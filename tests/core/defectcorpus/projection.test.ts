// Written, never run in Dirty Mode (DEFERRED-VALIDATION DV-07). Inline data is a tiny synthetic example, not corpus.
import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../../../src/core/defectcorpus/diff.ts";
import { changeContentSha256 } from "../../../src/core/defectcorpus/hashes.ts";
import { scanReviewerVisible } from "../../../src/core/defectcorpus/leakscan.ts";
import { toPublicRecord, toReviewerProjection, variantChangeId } from "../../../src/core/defectcorpus/projection.ts";
import { TaskSchema, VariantSchema, type Task, type Variant } from "../../../src/core/defectcorpus/schema.ts";

const SIGNATURE = "export function max(a: number, b: number): number {";
const BASE = `${SIGNATURE}\n  return a;\n}\n`;
const GOOD_HEAD = `${SIGNATURE}\n  return a >= b ? a : b;\n}\n`;
const BAD_HEAD = `${SIGNATURE}\n  return a < b ? a : b;\n}\n`;
const MANIFEST_HASH = "0".repeat(64);

const task: Task = TaskSchema.parse({
  task_id: "T01",
  split: "dev",
  spec: "Return the larger of two numbers.",
  intent: "Implement max for two finite numbers.",
  base_files: [{ path: "src/max.ts", content: BASE }],
  hidden_tests: [{ path: "hidden/max.test.ts", content: "// synthetic\n" }],
  executable_lines: 3,
  labels_authority: "builder_dev_not_independent",
});

const goodVariant: Variant = VariantSchema.parse({
  variant_id: "T01.clean",
  task_id: "T01",
  kind: "clean",
  head_files: [{ path: "src/max.ts", content: GOOD_HEAD }],
  labels_authority: "builder_dev_not_independent",
});

const badVariant: Variant = VariantSchema.parse({
  variant_id: "T01.d1",
  task_id: "T01",
  kind: "defect",
  group: "G-ERR",
  tag: "wrong-operator",
  severity: "high",
  origin: "operator:RelationalOperator",
  witness_test: { path: "hidden/max.test.ts", name: "returns the larger value" },
  head_files: [{ path: "src/max.ts", content: BAD_HEAD }],
  labels_authority: "builder_dev_not_independent",
});

describe("toReviewerProjection", () => {
  it("contains only change id, spec, diff and line-numbered touched heads", () => {
    const p = toReviewerProjection(goodVariant, task);
    expect(Object.keys(p).sort()).toEqual(["changeId", "diff", "files", "spec"]);
    expect(p.files.map((f) => Object.keys(f).sort())).toEqual([["lineCount", "numberedHead", "path"]]);
    expect(p.spec).toBe(task.spec);
    expect(p.diff).toBe(
      [
        "--- a/src/max.ts",
        "+++ b/src/max.ts",
        "@@ -1,3 +1,3 @@",
        ` ${SIGNATURE}`,
        "-  return a;",
        "+  return a >= b ? a : b;",
        " }",
        "",
      ].join("\n"),
    );
    expect(p.files[0]).toEqual({
      path: "src/max.ts",
      lineCount: 3,
      numberedHead: `1 | ${SIGNATURE}\n2 |   return a >= b ? a : b;\n3 | }`,
    });
  });

  it("uses a neutral content-derived id and leaks no label", () => {
    const p = toReviewerProjection(badVariant, task);
    const expectedHash = changeContentSha256(task.spec, [{ path: "src/max.ts", base: BASE, head: BAD_HEAD }]);
    expect(p.changeId).toBe(`c_${expectedHash.slice(0, 10)}`);
    const bytes = JSON.stringify(p);
    for (const label of ["T01.d1", "G-ERR", "wrong-operator", "operator:", "hidden/", "returns the larger value"]) {
      expect(bytes).not.toContain(label);
    }
    expect(scanReviewerVisible(p)).toEqual([]);
  });

  it("the id depends on content only, never on labels", () => {
    const relabelled: Variant = { ...goodVariant, variant_id: "T01.other" };
    expect(variantChangeId(relabelled, task)).toBe(variantChangeId(goodVariant, task));
    expect(variantChangeId(badVariant, task)).not.toBe(variantChangeId(goodVariant, task));
  });

  it("rejects a variant from another task, an untouched head and a missing base file", () => {
    expect(() => toReviewerProjection({ ...goodVariant, task_id: "T02" }, task)).toThrow(/belongs to/);
    expect(() =>
      toReviewerProjection({ ...goodVariant, head_files: [{ path: "src/max.ts", content: BASE }] }, task),
    ).toThrow(/touches no file/);
    expect(() =>
      toReviewerProjection({ ...goodVariant, head_files: [{ path: "src/other.ts", content: GOOD_HEAD }] }, task),
    ).toThrow(/missing src\/max.ts/);
  });
});

describe("toPublicRecord", () => {
  it("open record is the S45 payload with no label fields", () => {
    const r = toPublicRecord(badVariant, task, { manifestHash: MANIFEST_HASH, embargoStatus: "open" });
    expect(Object.keys(r).sort()).toEqual(["embargoStatus", "files", "id", "license", "manifestHash", "spec", "taskId"]);
    expect(r.files).toEqual([{ path: "src/max.ts", base: BASE, head: BAD_HEAD }]);
    expect(r.license).toBe("MIT");
    const keys = JSON.stringify(r);
    for (const field of ['"kind"', '"group"', '"tag"', '"region', '"twin', '"clean_twin_id"', '"variant_id"', '"severity"']) {
      expect(keys).not.toContain(field);
    }
  });

  it("embargoed record withholds files and spec", () => {
    const r = toPublicRecord(badVariant, task, { manifestHash: MANIFEST_HASH, embargoStatus: "embargoed" });
    expect(r.embargoStatus).toBe("embargoed");
    expect(r.files).toBeNull();
    expect(r.spec).toBeNull();
    expect(r.id).toBe(toReviewerProjection(badVariant, task).changeId);
  });
});

describe("unifiedDiff", () => {
  it("new file diffs from /dev/null with an empty old range", () => {
    expect(unifiedDiff("src/n.ts", null, "a\nb\n")).toBe("--- /dev/null\n+++ b/src/n.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n");
  });

  it("no change -> empty string", () => {
    expect(unifiedDiff("src/a.ts", "x\n", "x\n")).toBe("");
  });

  it("changes more than 2*context lines apart form separate hunks", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
    const head = lines.map((l) => (l === "l2" ? "x2" : l === "l19" ? "x19" : l));
    const diff = unifiedDiff("src/a.ts", `${lines.join("\n")}\n`, `${head.join("\n")}\n`);
    expect(diff.split("\n").filter((l) => l.startsWith("@@"))).toEqual(["@@ -1,5 +1,5 @@", "@@ -16,5 +16,5 @@"]);
  });
});
