// Projections of a corpus variant (PLAN §3.5, M1 acceptance 4). Pure.
//
// - Reviewer projection: exactly what a reviewer sees: neutral change id, the task spec, a unified diff of the
//   touched files, and the line-numbered full head of each touched file. No tests, labels, counterparts, provenance,
//   author identity, kind, group or regions.
// - Public record: the S45 public payload; embargoed records withhold spec and files.
// The leak scan (leakscan.ts) is applied by callers to the reviewer projection before any use.
import { unifiedDiff, splitLines } from "./diff.ts";
import { changeContentSha256, type ChangeFile } from "./hashes.ts";
import { neutralChangeId } from "./ids.ts";
import { compareCodeUnits } from "./order.ts";
import { PublicManifestRecordSchema, type PublicManifestRecord, type Task, type Variant } from "./schema.ts";

export interface ReviewerFile {
  readonly path: string;
  readonly lineCount: number;
  /** Head text with a right-aligned 1-based line number, " | ", then the line. */
  readonly numberedHead: string;
}

export interface ReviewerProjection {
  readonly changeId: string;
  readonly spec: string;
  readonly diff: string;
  readonly files: readonly ReviewerFile[];
}

/**
 * The touched files of a variant relative to the task base, sorted by path. A head path not in the base is an added
 * file (base null). Every base path must appear in the head (file deletion is unsupported). A variant that touches
 * nothing is rejected.
 */
export function touchedFiles(variant: Variant, task: Task): ChangeFile[] {
  if (variant.task_id !== task.task_id) {
    throw new Error(`projection: variant ${variant.variant_id} belongs to ${variant.task_id}, not ${task.task_id}`);
  }
  const head = new Map(variant.head_files.map((f) => [f.path, f.content]));
  for (const baseFile of task.base_files) {
    if (!head.has(baseFile.path)) throw new Error(`projection: head of ${variant.variant_id} is missing ${baseFile.path}`);
  }
  const base = new Map(task.base_files.map((f) => [f.path, f.content]));
  const files: ChangeFile[] = [];
  for (const path of [...head.keys()].sort(compareCodeUnits)) {
    const headContent = head.get(path)!;
    const baseContent = base.get(path) ?? null;
    if (baseContent === headContent) continue;
    files.push({ path, base: baseContent, head: headContent });
  }
  if (files.length === 0) throw new Error(`projection: variant ${variant.variant_id} touches no file`);
  return files;
}

/** Neutral id of a variant, computed from reviewer-visible content only. */
export function variantChangeId(variant: Variant, task: Task): string {
  return neutralChangeId(changeContentSha256(task.spec, touchedFiles(variant, task)));
}

export function numberLines(content: string): { lineCount: number; numberedHead: string } {
  const lines = splitLines(content);
  const width = String(Math.max(1, lines.length)).length;
  const numbered = lines.map((line, i) => `${String(i + 1).padStart(width, " ")} | ${line}`);
  return { lineCount: lines.length, numberedHead: numbered.join("\n") };
}

export function toReviewerProjection(variant: Variant, task: Task): ReviewerProjection {
  const files = touchedFiles(variant, task);
  return {
    changeId: neutralChangeId(changeContentSha256(task.spec, files)),
    spec: task.spec,
    diff: files.map((f) => unifiedDiff(f.path, f.base, f.head)).join(""),
    files: files.map((f) => ({ path: f.path, ...numberLines(f.head) })),
  };
}

export interface PublicRecordOptions {
  /** Hash of the manifest the record belongs to (computed by the manifest builder, M5). */
  readonly manifestHash: string;
  readonly embargoStatus: "open" | "embargoed";
}

/** The public manifest record; validated against the strict schema so no label field can slip in. */
export function toPublicRecord(variant: Variant, task: Task, options: PublicRecordOptions): PublicManifestRecord {
  const files = touchedFiles(variant, task);
  const id = neutralChangeId(changeContentSha256(task.spec, files));
  const common = { id, taskId: task.task_id, manifestHash: options.manifestHash, license: "MIT" as const };
  const record =
    options.embargoStatus === "open"
      ? {
          ...common,
          embargoStatus: "open" as const,
          spec: task.spec,
          files: files.map((f) => ({ path: f.path, base: f.base, head: f.head })),
        }
      : { ...common, embargoStatus: "embargoed" as const, spec: null, files: null };
  return PublicManifestRecordSchema.parse(record);
}
