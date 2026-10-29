// Pure admission decision (PLAN M2 acceptance 5, K21 G1-G9). cli/admit.ts gathers file facts (existence, sha256,
// parsed grant) and this function decides. Rules:
// - No valid Roy R3 grant file -> PENDING_ROY_APPOINTMENT (nothing can be signed before Roy appoints).
// - Valid grant, GO requested, and every check passes -> GO: all nine gate evidence files present with sha256; the G3
//   and G4 evidence are witness-receipt/v1 JSONL files (corpus-verify's witness-receipts.jsonl) whose every receipt
//   is a witnessed held-out receipt executed by the grant's validator (K19); a steward and a distinct validator, both
//   valid callsigns, neither in builder lineage, both exactly the ones the grant appoints; the grant's path + sha256
//   recorded; `developer_overlap_disclosed` copied from the grant.
// - Otherwise -> NO-GO, with every failed check listed in status_note. Reasons never quote receipt contents (held-out
//   test names), only gate ids, line numbers and callsigns.
// The invoker (possibly a builder) is recorded only as `invoked_by`, never as a signer.
import { AdmissionRecordSchema, Callsign, GATE_IDS, WitnessReceiptSchema, isSafeRelPath } from "../defectcorpus/schema.ts";
import type { AdmissionRecord, GateId } from "../defectcorpus/schema.ts";
import { RoyGrantFileSchema } from "./grant.ts";
import type { RoyGrantFile } from "./grant.ts";
import { callsignId, isBuilderLineage } from "./lineage.ts";
import type { BuilderLineage } from "./lineage.ts";

export interface FileFact {
  /** Path relative to the admission root (repository root), POSIX. */
  readonly path: string;
  readonly sha256: string;
  /** UTF-8 text of the file; cli/admit.ts supplies it for the RECEIPT_GATES (G3, G4) so their content can be checked. */
  readonly text?: string;
}

export interface GrantFact extends FileFact {
  /** Parsed JSON content, or undefined when the file is not JSON. */
  readonly content: unknown;
}

export interface AdmissionInput {
  readonly requested: "GO" | "NO-GO";
  /** Evidence file per gate; null when not supplied or not found. */
  readonly gates: Readonly<Record<GateId, FileFact | null>>;
  readonly steward: string | null;
  readonly validator: string | null;
  readonly grant: GrantFact | null;
  readonly invokedBy: string;
  readonly lineage: BuilderLineage;
  /** ISO 8601 timestamp from the host clock. */
  readonly now: string;
}

export interface AdmissionDecision {
  readonly record: AdmissionRecord;
  /** Every failed check; empty for GO. */
  readonly reasons: readonly string[];
}

const SHA = /^[0-9a-f]{64}$/;
const validFact = (f: FileFact | null): f is FileFact => f !== null && isSafeRelPath(f.path) && SHA.test(f.sha256);

/** Gates whose evidence must be the validator's held-out witness receipts (G3 witnesses, G4 twins; K19). */
export const RECEIPT_GATES = ["G3", "G4"] as const satisfies readonly GateId[];
export type ReceiptGateId = (typeof RECEIPT_GATES)[number];

/**
 * Problems with a G3/G4 evidence file, empty when it is acceptable: it must be non-empty witness-receipt/v1 JSONL,
 * every receipt held-out (task H##), witnessed, and executed by `validator` (the grant's appointee, K19); G3 must
 * contain at least one `fails` receipt (a defect failing its witness), G4 at least one `passes` receipt. Problems are
 * counted, not listed per line, and never quote receipt content.
 */
export function receiptEvidenceProblems(gate: ReceiptGateId, text: string | undefined, validator: string): string[] {
  if (text === undefined) return [`${gate} evidence text was not read`];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [`${gate} evidence contains no witness receipts`];
  let malformed = 0;
  let otherExecutor = 0;
  let notHeldout = 0;
  let notWitnessed = 0;
  let fails = 0;
  let passes = 0;
  for (const line of lines) {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }
    const parsed = WitnessReceiptSchema.safeParse(json);
    if (!parsed.success) {
      malformed++;
      continue;
    }
    const r = parsed.data;
    if (r.executor !== validator) otherExecutor++;
    if (!r.task_id.startsWith("H")) notHeldout++;
    if (!r.witnessed) notWitnessed++;
    if (r.expectation === "fails") fails++;
    else passes++;
  }
  const problems: string[] = [];
  if (malformed > 0) problems.push(`${gate} evidence: ${malformed} line(s) are not witness-receipt/v1 records`);
  if (otherExecutor > 0) problems.push(`${gate} evidence: ${otherExecutor} receipt(s) not executed by the appointed validator ${validator}`);
  if (notHeldout > 0) problems.push(`${gate} evidence: ${notHeldout} receipt(s) are not held-out (H##) receipts`);
  if (notWitnessed > 0) problems.push(`${gate} evidence: ${notWitnessed} receipt(s) are not witnessed`);
  if (gate === "G3" && fails === 0) problems.push("G3 evidence has no defect witness (fails) receipt");
  if (gate === "G4" && passes === 0) problems.push("G4 evidence has no passing (passes) receipt");
  return problems;
}

export function decideAdmission(input: AdmissionInput): AdmissionDecision {
  const reasons: string[] = [];
  if (!Callsign.safeParse(input.invokedBy).success) throw new Error("invoked_by must be a callsign");

  let grant: RoyGrantFile | null = null;
  if (input.grant === null) reasons.push("no Roy R3 grant file supplied");
  else if (!validFact(input.grant)) reasons.push("Roy grant path/sha256 invalid");
  else {
    const parsed = RoyGrantFileSchema.safeParse(input.grant.content);
    if (parsed.success) grant = parsed.data;
    else reasons.push("Roy grant file does not match roy-grant/v1 (R3)");
  }

  const signer = (role: "steward" | "validator", value: string | null): string | null => {
    if (value === null) {
      reasons.push(`no ${role} callsign supplied`);
      return null;
    }
    if (!Callsign.safeParse(value).success) {
      reasons.push(`${role} is not a callsign`);
      return null;
    }
    if (isBuilderLineage(value, input.lineage)) {
      reasons.push(`${role} ${value} is in builder lineage and can never sign`);
      return null;
    }
    if (grant !== null && grant[role] !== value) {
      reasons.push(`${role} ${value} is not the ${role} appointed in the Roy grant`);
      return null;
    }
    return value;
  };
  const steward = signer("steward", input.steward);
  const validator = signer("validator", input.validator);
  if (input.steward !== null && input.validator !== null && callsignId(input.steward) === callsignId(input.validator)) {
    reasons.push("steward and validator must be distinct sessions (same id)");
  }

  const gates = {} as Record<GateId, { evidence: string | null; sha256: string | null }>;
  for (const id of GATE_IDS) {
    const fact = input.gates[id];
    if (validFact(fact)) gates[id] = { evidence: fact.path, sha256: fact.sha256 };
    else {
      gates[id] = { evidence: null, sha256: null };
      reasons.push(`${id} evidence missing`);
    }
  }
  // Receipt content is checked against the grant's validator, so it can only be checked once Roy has appointed one.
  if (grant !== null) {
    for (const id of RECEIPT_GATES) {
      const fact = input.gates[id];
      if (validFact(fact)) reasons.push(...receiptEvidenceProblems(id, fact.text, grant.validator));
    }
  }
  if (input.requested === "NO-GO") reasons.push("NO-GO requested by the invoker");

  const status: AdmissionRecord["status"] = grant === null ? "PENDING_ROY_APPOINTMENT" : reasons.length === 0 ? "GO" : "NO-GO";
  const go = status === "GO";
  const grantRef = grant !== null && input.grant !== null ? { path: input.grant.path, sha256: input.grant.sha256 } : null;
  const note = go
    ? `GO: G1-G9 evidence present; G3/G4 witnessed held-out receipts executed by validator ${validator}; ` +
      `signed by steward ${steward} and validator ${validator}; Roy R3 grant ${grantRef?.path} ` +
      `(sha256 ${grantRef?.sha256}); invoked by ${input.invokedBy}.`
    : status === "PENDING_ROY_APPOINTMENT"
      ? `PENDING - needs Roy to appoint the independent corpus steward and validator (R3). ${reasons.join("; ")}.`
      : `NO-GO: ${reasons.join("; ")}.`;

  const record = AdmissionRecordSchema.parse({
    schema: "admission/v1",
    status,
    status_note: note,
    requires: status === "PENDING_ROY_APPOINTMENT" ? ["R3", "R7"] : [],
    gates,
    signers: { steward: go ? steward : grant === null ? null : steward, validator: go ? validator : grant === null ? null : validator },
    roy_grant: grantRef,
    invoked_by: input.invokedBy,
    developer_overlap_disclosed: grant?.developer_overlap_disclosed ?? false,
    decided_at: status === "PENDING_ROY_APPOINTMENT" ? null : input.now,
  });
  return { record, reasons: go ? [] : reasons };
}
