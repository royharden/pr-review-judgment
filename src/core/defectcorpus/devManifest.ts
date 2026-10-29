import { changeContentSha256, hashCanonical } from "./hashes.ts";
import { assertUniqueNeutralIds } from "./ids.ts";
import { compareCodeUnits } from "./order.ts";
import { toPublicRecord, touchedFiles } from "./projection.ts";
import { PublicManifestRecordSchema, TaskSchema, VariantSchema, type Task, type Variant } from "./schema.ts";

/** Development-only manifest construction. This does not execute witnesses or assert admission. */
export function buildDevManifest(entries: readonly { task: Task; variants: readonly Variant[] }[]) {
  if (entries.length === 0) throw new Error("empty development corpus");
  const taskIds = new Set<string>();
  const hashes: string[] = [];
  const draft = entries.flatMap((entry) => {
    const task = TaskSchema.parse(entry.task);
    if (task.split !== "dev" || task.labels_authority !== "builder_dev_not_independent") throw new Error("dev builder authority required");
    if (taskIds.has(task.task_id)) throw new Error("duplicate dev task");
    taskIds.add(task.task_id);
    if (entry.variants.length === 0) throw new Error("task without variants");
    const variantIds = new Set<string>();
    return entry.variants.map((input) => {
      const variant = VariantSchema.parse(input);
      if (variant.labels_authority !== "builder_dev_not_independent" || variantIds.has(variant.variant_id)) throw new Error("invalid dev variant authority or duplicate id");
      variantIds.add(variant.variant_id);
      hashes.push(changeContentSha256(task.spec, touchedFiles(variant, task)));
      const { manifestHash: _placeholder, ...record } = toPublicRecord(variant, task, { manifestHash: "0".repeat(64), embargoStatus: "open" });
      void _placeholder;
      return record;
    });
  }).sort((a, b) => compareCodeUnits(a.id, b.id));
  assertUniqueNeutralIds(hashes);
  if (new Set(draft.map((r) => r.id)).size !== draft.length) throw new Error("duplicate public change id");
  const manifestHash = hashCanonical(draft);
  return {
    schema: "public-manifest/v1" as const,
    split: "dev" as const,
    pending_activation: false,
    runtime_validated: false,
    labels_authority: "builder_dev_not_independent" as const,
    license: "MIT" as const,
    hash_policy: "sha256(canonical JSON of id-sorted records with manifestHash omitted)",
    manifest_sha256: manifestHash,
    records: draft.map((record) => PublicManifestRecordSchema.parse({ ...record, manifestHash })),
  };
}
