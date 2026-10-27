// static-analysis baseline (PLAN §6): `tsc --strict` plus pinned ESLint (incl. @typescript-eslint/no-floating-promises)
// run on the head files INSIDE the qualified witness sandbox (corpus code never runs on the host). Pure adapter:
// - the sandbox run is behind the StaticAnalysisRunner port (implemented by cli/ in M4 on top of the M2 sandbox);
// - its JSON report (`static-diagnostics/v1`) is turned into review findings: one per diagnostic in a touched head
//   file, errors -> requires_change, warnings -> uncertain; verdict request_changes iff any requires_change;
// - any infrastructure problem (no runner, unqualified sandbox, timeout, crash, malformed report) is an OPERATIONAL
//   FAILURE: a non-valid slot (UNAVAILABLE), never an approve and never a MISS.
// ESLint diagnostics use ESLint's native `--format json` shape; tsc diagnostics use a small JSON list the sandbox
// entry emits from the compiler API (`{file, line, end_line, code, category, message}`), since tsc has no JSON output.
import { z } from "zod";
import { CLAIM_MAX_CHARS, type HeadFileBounds, type ReviewFinding } from "../contract.ts";
import { finishBaseline, operationalFailure, type BaselineResult } from "./common.ts";
import type { SourceFile } from "../../defectcorpus/schema.ts";

/** In-container prefix stripped from reported file paths (the sandbox work dir, src/core/sandbox/argv.ts). */
export const STATIC_WORK_PREFIX = "/work/";

const EslintMessage = z.object({
  ruleId: z.string().nullable(),
  severity: z.union([z.literal(1), z.literal(2)]),
  message: z.string(),
  line: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
});

/** ESLint `--format json`: one entry per file. */
export const EslintReport = z.array(
  z.object({
    filePath: z.string(),
    messages: z.array(EslintMessage),
  }),
);

export const TscDiagnostic = z.strictObject({
  file: z.string().nullable(),
  line: z.number().int().min(1).nullable(),
  end_line: z.number().int().min(1).nullable(),
  code: z.number().int(),
  category: z.enum(["error", "warning", "suggestion", "message"]),
  message: z.string(),
});

export const StaticDiagnosticsReportSchema = z.strictObject({
  schema: z.literal("static-diagnostics/v1"),
  status: z.enum(["ok", "infra_error", "timeout", "sandbox_unqualified"]),
  detail: z.string().nullable(),
  tool_versions: z.strictObject({ typescript: z.string().nullable(), eslint: z.string().nullable() }),
  tsc: z.array(TscDiagnostic),
  eslint: EslintReport,
});
export type StaticDiagnosticsReport = z.infer<typeof StaticDiagnosticsReportSchema>;

/** Port: runs both tools on the given head files inside the qualified sandbox; returns the report JSON text. */
export interface StaticAnalysisRunner {
  run(files: readonly SourceFile[]): Promise<string>;
}

export interface Diagnostic {
  readonly tool: "tsc" | "eslint";
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly message: string;
}

function relPath(reported: string): string {
  return reported.startsWith(STATIC_WORK_PREFIX) ? reported.slice(STATIC_WORK_PREFIX.length) : reported;
}

export function diagnosticsFromReport(report: StaticDiagnosticsReport): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const d of report.tsc) {
    if (d.file === null || d.line === null) continue; // global diagnostics have no location
    if (d.category !== "error" && d.category !== "warning") continue;
    out.push({
      tool: "tsc",
      path: relPath(d.file),
      startLine: d.line,
      endLine: Math.max(d.line, d.end_line ?? d.line),
      rule: `TS${d.code}`,
      severity: d.category,
      message: d.message,
    });
  }
  for (const file of report.eslint) {
    for (const m of file.messages) {
      if (m.line === undefined) continue;
      out.push({
        tool: "eslint",
        path: relPath(file.filePath),
        startLine: m.line,
        endLine: Math.max(m.line, m.endLine ?? m.line),
        rule: m.ruleId ?? "eslint-parse",
        severity: m.severity === 2 ? "error" : "warning",
        message: m.message,
      });
    }
  }
  return out;
}

/**
 * At most CLAIM_MAX_CHARS Unicode code points, counted like contract.ts `charCount` (a UTF-16 slice could split a
 * surrogate pair and would cut astral-plane text short).
 */
export function truncateClaim(text: string): string {
  return [...text].slice(0, CLAIM_MAX_CHARS).join("");
}

export function findingsFromDiagnostics(diagnostics: readonly Diagnostic[]): ReviewFinding[] {
  const seen = new Set<string>();
  const findings: ReviewFinding[] = [];
  for (const d of diagnostics) {
    const key = `${d.path}\u0000${d.startLine}\u0000${d.endLine}\u0000${d.tool}\u0000${d.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      path: d.path,
      startLine: d.startLine,
      endLine: d.endLine,
      severity: d.severity === "error" ? "high" : "low",
      claim: truncateClaim(`${d.tool} ${d.rule}: ${d.message}`),
      confidence: d.severity === "error" ? 0.9 : 0.5,
      disposition: d.severity === "error" ? "requires_change" : "uncertain",
    });
  }
  return findings;
}

/** Turn the sandbox report text into a baseline result. Malformed or non-ok reports are operational failures. */
export function staticAnalysisFromReport(reportText: string, headFiles: readonly HeadFileBounds[]): BaselineResult {
  let json: unknown;
  try {
    json = JSON.parse(reportText);
  } catch {
    return operationalFailure("static-analysis", "diagnostics report is not JSON");
  }
  const parsed = StaticDiagnosticsReportSchema.safeParse(json);
  if (!parsed.success) return operationalFailure("static-analysis", "diagnostics report does not match static-diagnostics/v1");
  if (parsed.data.status !== "ok") return operationalFailure("static-analysis", `${parsed.data.status}${parsed.data.detail ? `: ${parsed.data.detail}` : ""}`);
  return finishBaseline("static-analysis", findingsFromDiagnostics(diagnosticsFromReport(parsed.data)), headFiles);
}

/** Run the baseline. Without a runner (no qualified sandbox) the slot is an operational failure, not a review. */
export async function staticAnalysis(
  runner: StaticAnalysisRunner | null,
  files: readonly SourceFile[],
  headFiles: readonly HeadFileBounds[],
): Promise<BaselineResult> {
  if (runner === null) return operationalFailure("static-analysis", "sandbox_unqualified: no static-analysis runner");
  let text: string;
  try {
    text = await runner.run(files);
  } catch (error) {
    return operationalFailure("static-analysis", `runner error: ${error instanceof Error ? error.message : String(error)}`);
  }
  return staticAnalysisFromReport(text, headFiles);
}
