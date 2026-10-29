import { describe, expect, it } from "vitest";
import taskJson from "../../../corpus/dev/T01/task.json" with { type: "json" };
import correctJson from "../../../corpus/dev/T01/variants/c.json" with { type: "json" };
import defectJson from "../../../corpus/dev/T01/variants/d1.json" with { type: "json" };
import { buildDevManifest } from "../../../src/core/defectcorpus/devManifest.ts";
import { hashCanonical } from "../../../src/core/defectcorpus/hashes.ts";
import { TaskSchema, VariantSchema } from "../../../src/core/defectcorpus/schema.ts";

describe("dev manifest source contract (execution deferred)", () => {
  const task = TaskSchema.parse(taskJson);
  const correct = VariantSchema.parse(correctJson);
  const defect = VariantSchema.parse(defectJson);
  it("binds the id-sorted public records and excludes embedded test data", () => {
    const manifest = buildDevManifest([{ task, variants: [defect, correct] }]);
    const reversed = buildDevManifest([{ task, variants: [correct, defect] }]);
    expect(manifest).toEqual(reversed);
    const contents = manifest.records.map(({ manifestHash: _hash, ...record }) => { void _hash; return record; });
    expect(hashCanonical(contents)).toBe(manifest.manifest_sha256);
    expect(manifest.runtime_validated).toBe(false);
    expect(manifest.records.every((r) => r.manifestHash === manifest.manifest_sha256)).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("hidden_tests");
    expect(JSON.stringify(manifest)).not.toContain("witness_test");
  });
  it("refuses duplicates instead of merging two inventory slots", () => {
    expect(() => buildDevManifest([{ task, variants: [correct, correct] }])).toThrow();
  });
});
