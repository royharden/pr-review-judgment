// Corpus, admission and receipt schemas (PLAN §5, §3.4, K19, K21). Pure: imports only zod.
// JSON field names are snake_case (docs/CONVENTIONS.md). The one exception here is the public manifest record,
// which follows the S45 public payload verbatim ({id, files:[{path, base, head}], taskId, spec, manifestHash,
// license, embargoStatus}, PLAN §0 [X]).
import { z } from "zod";

// ---------------------------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------------------------

/**
 * A repository-relative POSIX path. Rejects: empty, absolute (`/x`), drive letters (`C:x`, `C:/x`), backslashes,
 * NUL, empty segments (`a//b`, trailing `/`), and `.`/`..` segments. The rejection of `.` keeps paths normalized so
 * the matcher can compare them exactly (PLAN §6 "exact normalized path").
 */
export function isSafeRelPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes("\\") || path.includes("\u0000")) return false;
  if (path.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return false;
  }
  return true;
}

export const RelPath = z.string().refine(isSafeRelPath, {
  message: "path must be relative POSIX: no absolute, drive letter, backslash, empty, '.' or '..' segment",
});

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters");

/** Neutral change id shown to reviewers: `c_` + first 10 hex of the change content hash (PLAN §3.5). */
export const NeutralChangeId = z.string().regex(/^c_[0-9a-f]{10}$/, "expected c_ + 10 lowercase hex");

/** AgentNamer callsign: two base-36 chars + two digits, then `_`-separated parts. */
export const Callsign = z.string().regex(/^[0-9A-Z]{2}[0-9]{2}_[A-Za-z0-9][A-Za-z0-9_.-]*$/, "expected an AgentNamer callsign");

/** Dev tasks are T01..; held-out tasks are H01.. (PLAN §5). */
export const TaskId = z.string().regex(/^[TH][0-9]{2}$/, "expected T## (dev) or H## (held-out)");

export const VariantId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "expected a variant id");

export const IsoDateTime = z.iso.datetime();

export const Split = z.enum(["dev", "heldout"]);
export type Split = z.infer<typeof Split>;

export const VariantKind = z.enum(["clean", "near_miss", "defect"]);
export type VariantKind = z.infer<typeof VariantKind>;

/** Fixed defect groups (PLAN §5). */
export const DefectGroup = z.enum(["G-BND", "G-ACC", "G-ASY", "G-ERR"]);
export type DefectGroup = z.infer<typeof DefectGroup>;

export const Severity = z.enum(["high", "medium", "low"]);
export type Severity = z.infer<typeof Severity>;

/** `operator:<OperatorName>` for mechanically seeded defects, `hand` for hand-written ones. */
export const Origin = z.string().regex(/^(operator:[A-Za-z][A-Za-z0-9]*|hand)$/, "expected operator:<name> or hand");

/** Who wrote the labels. Dev labels are builder-written and never independent (PLAN K15). */
export const LabelsAuthority = z.enum(["builder_dev_not_independent", "steward_heldout"]);
export type LabelsAuthority = z.infer<typeof LabelsAuthority>;

export const DefectTag = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "expected a lowercase kebab-case tag");

/** One whole source file. Content is the exact file text. */
export const SourceFile = z.strictObject({
  path: RelPath,
  content: z.string(),
});
export type SourceFile = z.infer<typeof SourceFile>;

/** A named test inside a hidden test file. */
export const TestRef = z.strictObject({
  path: RelPath,
  name: z.string().min(1),
});
export type TestRef = z.infer<typeof TestRef>;

/** One changed-run interval in defective-head line numbers, 1-based and inclusive (region/v1). */
export const RegionInterval = z
  .strictObject({
    path: RelPath,
    start_line: z.number().int().min(1),
    end_line: z.number().int().min(1),
  })
  .refine((r) => r.end_line >= r.start_line, { message: "end_line must be >= start_line" });
export type RegionIntervalRecord = z.infer<typeof RegionInterval>;

export const RegionPolicy = z.literal("region/v1");

// ---------------------------------------------------------------------------------------------------------------
// Task (PLAN §5: {spec.md, base/*.ts, intent.md, hidden/*.test.ts}; <= 2 files; <= 150 executable lines)
// ---------------------------------------------------------------------------------------------------------------

export const MAX_TASK_FILES = 2;
export const MAX_EXECUTABLE_LINES = 150;

export const TaskSchema = z
  .strictObject({
    task_id: TaskId,
    split: Split,
    spec: z.string().min(1),
    intent: z.string().min(1),
    base_files: z.array(SourceFile).min(1).max(MAX_TASK_FILES),
    hidden_tests: z.array(SourceFile).min(1),
    executable_lines: z.number().int().min(1).max(MAX_EXECUTABLE_LINES),
    labels_authority: LabelsAuthority,
  })
  .superRefine((task, ctx) => {
    const expectedSplit = task.task_id.startsWith("T") ? "dev" : "heldout";
    if (task.split !== expectedSplit) {
      ctx.addIssue({ code: "custom", path: ["split"], message: `task ${task.task_id} must have split ${expectedSplit}` });
    }
    const expectedAuthority = task.split === "dev" ? "builder_dev_not_independent" : "steward_heldout";
    if (task.labels_authority !== expectedAuthority) {
      ctx.addIssue({ code: "custom", path: ["labels_authority"], message: `split ${task.split} requires ${expectedAuthority}` });
    }
    task.base_files.forEach((f, i) => {
      if (!f.path.endsWith(".ts")) ctx.addIssue({ code: "custom", path: ["base_files", i, "path"], message: "base files are .ts" });
    });
    task.hidden_tests.forEach((f, i) => {
      if (!f.path.endsWith(".test.ts")) {
        ctx.addIssue({ code: "custom", path: ["hidden_tests", i, "path"], message: "hidden tests are .test.ts" });
      }
    });
    addDuplicatePathIssues(task.base_files, ["base_files"], ctx);
  });
export type Task = z.infer<typeof TaskSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Variant (clean | near_miss | defect). One defect per change (PLAN §3.3).
// ---------------------------------------------------------------------------------------------------------------

const variantCommon = {
  variant_id: VariantId,
  task_id: TaskId,
  /** The complete head: every base path must appear; a new path is an added file. */
  head_files: z.array(SourceFile).min(1).max(MAX_TASK_FILES),
  labels_authority: LabelsAuthority,
};

export const CleanVariant = z.strictObject({
  ...variantCommon,
  kind: z.literal("clean"),
});

export const NearMissVariant = z.strictObject({
  ...variantCommon,
  kind: z.literal("near_miss"),
  /** The named guard test that keeps the near-miss correct. */
  guard_test: TestRef,
});

export const DefectVariant = z.strictObject({
  ...variantCommon,
  kind: z.literal("defect"),
  group: DefectGroup,
  tag: DefectTag,
  severity: Severity,
  origin: Origin,
  /** The named hidden test that fails on this variant and passes on its clean counterpart. */
  witness_test: TestRef,
});

export const VariantSchema = z
  .discriminatedUnion("kind", [CleanVariant, NearMissVariant, DefectVariant])
  .superRefine((variant, ctx) => addDuplicatePathIssues(variant.head_files, ["head_files"], ctx));
export type Variant = z.infer<typeof VariantSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Public manifest record (S45 public payload, PLAN §0 [X]). No kind/group/tag/region/counterpart fields exist, and
// strictObject rejects any extra key. Embargoed records withhold `files` and `spec` (both null).
// ---------------------------------------------------------------------------------------------------------------

export const PublicFile = z.strictObject({
  path: RelPath,
  /** null when the file is new in the head. */
  base: z.string().nullable(),
  head: z.string(),
});
export type PublicFile = z.infer<typeof PublicFile>;

export const License = z.literal("MIT");

const publicCommon = {
  id: NeutralChangeId,
  taskId: TaskId,
  /** Hash of the manifest this record belongs to (computed by the manifest builder over records without this field). */
  manifestHash: Sha256Hex,
  license: License,
};

export const PublicOpenRecord = z.strictObject({
  ...publicCommon,
  embargoStatus: z.literal("open"),
  spec: z.string().min(1),
  files: z.array(PublicFile).min(1).max(MAX_TASK_FILES),
});

export const PublicEmbargoedRecord = z.strictObject({
  ...publicCommon,
  embargoStatus: z.literal("embargoed"),
  spec: z.null(),
  files: z.null(),
});

export const PublicManifestRecordSchema = z.discriminatedUnion("embargoStatus", [PublicOpenRecord, PublicEmbargoedRecord]);
export type PublicManifestRecord = z.infer<typeof PublicManifestRecordSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Private companion record: the labels. Never reviewer-visible; held-out companions live only in the vault.
// ---------------------------------------------------------------------------------------------------------------

export const PrivateCompanionRecordSchema = z
  .strictObject({
    id: NeutralChangeId,
    task_id: TaskId,
    variant_id: VariantId,
    split: Split,
    kind: VariantKind,
    group: DefectGroup.nullable(),
    tag: DefectTag.nullable(),
    severity: Severity.nullable(),
    origin: Origin.nullable(),
    labels_authority: LabelsAuthority,
    content_sha256: Sha256Hex,
    /** Neutral id of the clean counterpart; null for the clean variant itself. */
    clean_twin_id: NeutralChangeId.nullable(),
    region_policy: RegionPolicy,
    /** Changed runs vs the clean counterpart, in this variant's head line numbers. */
    regions: z.array(RegionInterval),
    witness_test: TestRef.nullable(),
    guard_test: TestRef.nullable(),
  })
  .superRefine((r, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (r.kind === "defect") {
      if (r.group === null) issue("group", "defect requires group");
      if (r.tag === null) issue("tag", "defect requires tag");
      if (r.severity === null) issue("severity", "defect requires severity");
      if (r.origin === null) issue("origin", "defect requires origin");
      if (r.witness_test === null) issue("witness_test", "defect requires witness_test");
      if (r.regions.length === 0) issue("regions", "defect requires at least one region");
    } else {
      if (r.group !== null || r.tag !== null || r.severity !== null || r.origin !== null) {
        issue("group", "only defects carry group/tag/severity/origin");
      }
      if (r.witness_test !== null) issue("witness_test", "only defects carry witness_test");
    }
    if (r.kind === "near_miss" && r.guard_test === null) issue("guard_test", "near_miss requires guard_test");
    if (r.kind !== "near_miss" && r.guard_test !== null) issue("guard_test", "only near_miss carries guard_test");
    if (r.kind === "clean") {
      if (r.clean_twin_id !== null) issue("clean_twin_id", "clean has no counterpart id");
      if (r.regions.length > 0) issue("regions", "clean has no regions");
    } else if (r.clean_twin_id === null) {
      issue("clean_twin_id", `${r.kind} requires clean_twin_id`);
    }
    const expectedAuthority = r.split === "dev" ? "builder_dev_not_independent" : "steward_heldout";
    if (r.labels_authority !== expectedAuthority) issue("labels_authority", `split ${r.split} requires ${expectedAuthority}`);
  });
export type PrivateCompanionRecord = z.infer<typeof PrivateCompanionRecordSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Witness receipt (K18/K19). Each check runs twice; timeout, crash and compile failure are never a witness.
// ---------------------------------------------------------------------------------------------------------------

export const WitnessRunStatus = z.enum(["pass", "assertion_fail", "timeout", "infra_error", "sandbox_unqualified"]);
export type WitnessRunStatus = z.infer<typeof WitnessRunStatus>;

export const WitnessRun = z.strictObject({
  status: WitnessRunStatus,
  duration_ms: z.number().int().min(0),
  output_sha256: Sha256Hex,
});

export const SandboxImageDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/, "expected sha256:<64 hex>");

export const WitnessReceiptSchema = z
  .strictObject({
    schema: z.literal("witness-receipt/v1"),
    task_id: TaskId,
    change_id: NeutralChangeId,
    /** Content hash of the code under test. */
    target_sha256: Sha256Hex,
    test: TestRef,
    /** `fails`: the test must fail on the target (defect); `passes`: it must pass (clean, near-miss guard). */
    expectation: z.enum(["fails", "passes"]),
    runs: z.tuple([WitnessRun, WitnessRun]),
    consistent: z.boolean(),
    witnessed: z.boolean(),
    sandbox_image_digest: SandboxImageDigest.nullable(),
    probe_receipt_sha256: Sha256Hex.nullable(),
    executor: Callsign,
    recorded_at: IsoDateTime,
  })
  .superRefine((r, ctx) => {
    const [first, second] = r.runs;
    const consistent = first.status === second.status;
    if (r.consistent !== consistent) {
      ctx.addIssue({ code: "custom", path: ["consistent"], message: "consistent must equal (runs[0].status === runs[1].status)" });
    }
    const wanted: WitnessRunStatus = r.expectation === "fails" ? "assertion_fail" : "pass";
    const witnessed = consistent && first.status === wanted;
    if (r.witnessed !== witnessed) {
      ctx.addIssue({ code: "custom", path: ["witnessed"], message: `witnessed requires both runs ${wanted}` });
    }
    const unqualified = r.runs.some((run) => run.status === "sandbox_unqualified");
    if (!unqualified && (r.sandbox_image_digest === null || r.probe_receipt_sha256 === null)) {
      ctx.addIssue({ code: "custom", path: ["sandbox_image_digest"], message: "executed runs require image digest and probe receipt" });
    }
  });
export type WitnessReceipt = z.infer<typeof WitnessReceiptSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Admission record (corpus/ADMISSION.json; K21 G1..G9). The builder can never sign; GO needs evidence for every gate,
// two distinct non-builder signers and a hashed Roy grant. Builder-lineage exclusion is checked by `admit` (M2).
// ---------------------------------------------------------------------------------------------------------------

export const AdmissionStatus = z.enum(["PENDING_ROY_APPOINTMENT", "NO-GO", "GO"]);
export type AdmissionStatus = z.infer<typeof AdmissionStatus>;

export const GATE_IDS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"] as const;
export type GateId = (typeof GATE_IDS)[number];

export const GateEvidence = z
  .strictObject({
    evidence: RelPath.nullable(),
    sha256: Sha256Hex.nullable(),
  })
  .refine((g) => (g.evidence === null) === (g.sha256 === null), { message: "evidence and sha256 are both set or both null" });

export const RoyGrant = z.strictObject({
  path: RelPath,
  sha256: Sha256Hex,
});

export const AdmissionRecordSchema = z
  .strictObject({
    schema: z.literal("admission/v1"),
    status: AdmissionStatus,
    status_note: z.string(),
    requires: z.array(z.string().regex(/^R[0-9]+$/)),
    gates: z.strictObject({
      G1: GateEvidence,
      G2: GateEvidence,
      G3: GateEvidence,
      G4: GateEvidence,
      G5: GateEvidence,
      G6: GateEvidence,
      G7: GateEvidence,
      G8: GateEvidence,
      G9: GateEvidence,
    }),
    signers: z.strictObject({
      steward: Callsign.nullable(),
      validator: Callsign.nullable(),
    }),
    roy_grant: RoyGrant.nullable(),
    invoked_by: Callsign.nullable(),
    developer_overlap_disclosed: z.boolean(),
    decided_at: IsoDateTime.nullable(),
  })
  .superRefine((r, ctx) => {
    if (r.status !== "GO") return;
    for (const id of GATE_IDS) {
      if (r.gates[id].evidence === null) ctx.addIssue({ code: "custom", path: ["gates", id], message: `GO requires ${id} evidence` });
    }
    const { steward, validator } = r.signers;
    if (steward === null || validator === null) {
      ctx.addIssue({ code: "custom", path: ["signers"], message: "GO requires steward and validator signers" });
    } else if (steward === validator) {
      ctx.addIssue({ code: "custom", path: ["signers"], message: "steward and validator must be distinct" });
    }
    if (r.roy_grant === null) ctx.addIssue({ code: "custom", path: ["roy_grant"], message: "GO requires a Roy grant reference" });
    if (r.decided_at === null) ctx.addIssue({ code: "custom", path: ["decided_at"], message: "GO requires decided_at" });
    if (r.requires.length > 0) ctx.addIssue({ code: "custom", path: ["requires"], message: "GO cannot have open requirements" });
  });
export type AdmissionRecord = z.infer<typeof AdmissionRecordSchema>;

// ---------------------------------------------------------------------------------------------------------------

/** The subset of zod's refinement context used here (kept structural to avoid depending on zod's generic ctx type). */
interface IssueSink {
  addIssue(issue: { code: "custom"; path: (string | number)[]; message: string }): void;
}

function addDuplicatePathIssues(files: readonly { path: string }[], at: (string | number)[], ctx: IssueSink): void {
  const seen = new Set<string>();
  files.forEach((f, i) => {
    if (seen.has(f.path)) ctx.addIssue({ code: "custom", path: [...at, i, "path"], message: `duplicate path ${f.path}` });
    seen.add(f.path);
  });
}
