// Deterministic mutation-site enumeration and application. Design-informed by S39 `d5f9e40` cli/engines/inhouse.ts
// (one parse with parent pointers, one visitor, refuse sources that do not parse); implemented here (PLAN K13).
import type * as TS from "typescript";
import { hashCanonical } from "../defectcorpus/hashes.ts";
import { compareCodeUnits } from "../defectcorpus/order.ts";
import { CLASSIC } from "./classic.ts";
import { EXTENDED } from "./extended.ts";
import { MutationError, isOperatorName } from "./types.ts";
import type { Mutation, MutationOperator, OperatorName, TsApi } from "./types.ts";

/** All twelve operators, in OPERATOR_NAMES order. */
export const OPERATORS: readonly MutationOperator[] = [...CLASSIC, ...EXTENDED];

export function operatorByName(name: OperatorName): MutationOperator {
  const op = OPERATORS.find((o) => o.name === name);
  if (op === undefined) throw new MutationError("unknown_operator", `unknown operator ${name}`);
  return op;
}

/**
 * Subtrees that are never visited, so no operator can mutate them: type nodes (annotations, type arguments, `as`
 * / `satisfies` targets, heritage `extends`/`implements` expressions), interface and type-alias declarations,
 * import/export declarations, and ambient (`declare`) declarations. Mutating them would not change runtime
 * behaviour, so it could never produce a witnessed defect.
 */
function isSkippedSubtree(ts: TsApi, node: TS.Node): boolean {
  if (ts.isTypeNode(node)) return true;
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return true;
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return true;
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node);
    if (modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) return true;
  }
  return false;
}

function scriptKindFor(ts: TsApi, fileName: string): TS.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

/** Order: range start, then operator name (code units), then range end, then replacement. Total and locale-free. */
export function compareMutations(a: Mutation, b: Mutation): number {
  return (
    a.range[0] - b.range[0] ||
    compareCodeUnits(a.operator, b.operator) ||
    a.range[1] - b.range[1] ||
    compareCodeUnits(a.replacement, b.replacement)
  );
}

function selectOperators(ops: readonly OperatorName[]): readonly MutationOperator[] {
  const wanted = new Set<string>();
  for (const name of ops) {
    if (!isOperatorName(name)) throw new MutationError("unknown_operator", `unknown operator ${String(name)}`);
    if (wanted.has(name)) throw new MutationError("duplicate_operator", `operator ${name} listed twice`);
    wanted.add(name);
  }
  return OPERATORS.filter((o) => wanted.has(o.name));
}

/**
 * Every candidate mutation of `source` for the selected operators, sorted by `compareMutations`. Deterministic: the
 * same (source, fileName, ops) always yields the same array, whatever order `ops` lists the operators in.
 * Throws `MutationError("parse")` if the source has syntax errors. Duplicate (range, replacement) pairs from one
 * operator are emitted once; no-op replacements (replacement === original) are dropped. Pass `OPERATOR_NAMES` for
 * all twelve. `ts` is the injected `typescript` module (see types.ts).
 */
export function enumerateMutations(source: string, fileName: string, ops: readonly OperatorName[], ts: TsApi): Mutation[] {
  const selected = selectOperators(ops);
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKindFor(ts, fileName));
  // `parseDiagnostics` is not in the public typings; S39 relies on the same field. Checked again by tsc at admission.
  const diagnostics = (file as TS.SourceFile & { readonly parseDiagnostics?: readonly TS.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) throw new MutationError("parse", `${fileName} does not parse (${diagnostics.length} syntax error(s))`);

  const out: Mutation[] = [];
  const seen = new Set<string>();
  const contexts = selected.map((op) => ({
    op,
    ctx: {
      ts,
      file,
      source,
      emit(start: number, end: number, replacement: string) {
        const original = source.slice(start, end);
        if (original === replacement) return;
        const key = `${op.name}\u0000${start}\u0000${end}\u0000${replacement}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ range: [start, end], operator: op.name, original, replacement });
      },
    },
  }));

  const visit = (node: TS.Node): void => {
    if (isSkippedSubtree(ts, node)) return;
    for (const { op, ctx } of contexts) op.visit(node, ctx);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);

  return out.sort(compareMutations);
}

/** Apply one mutation. Refuses a range outside the source or a source whose slice no longer equals `original`. */
export function applyMutation(source: string, mutation: Mutation): string {
  const [start, end] = mutation.range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) {
    throw new MutationError("range", `mutation range [${start}, ${end}) is outside the source (length ${source.length})`);
  }
  if (source.slice(start, end) !== mutation.original) {
    throw new MutationError("original_mismatch", `source at [${start}, ${end}) does not equal the mutation's original text`);
  }
  return source.slice(0, start) + mutation.replacement + source.slice(end);
}

/** Stable content key of a mutation of one file (sha256 of canonical JSON). Used to name seeded variants. */
export function mutationKey(fileName: string, sourceSha256: string, mutation: Mutation): string {
  return hashCanonical({
    domain: "pr-review-judgment/mutation/v1",
    file: fileName,
    source_sha256: sourceSha256,
    operator: mutation.operator,
    start: mutation.range[0],
    end: mutation.range[1],
    replacement: mutation.replacement,
  });
}
