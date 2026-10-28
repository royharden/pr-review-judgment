// Mutation operator types (PLAN §4 `src/core/operators`, M2). Pure: the TypeScript compiler API is a value the host
// injects (`TsApi`); this module imports `typescript` for types only, so src/core never loads the compiler itself and
// the viewer bundle does not pull it in. The CLI and tests pass `import ts from "typescript"`.
import type TS from "typescript";

/** The `typescript` module object (`import ts from "typescript"`), injected by the host. */
export type TsApi = typeof TS;

/** The eight S39-design operators (S39 `d5f9e40` cli/engines/inhouse.ts INHOUSE_OPERATORS). */
export const CLASSIC_OPERATORS = [
  "BooleanLiteral",
  "NumericBoundary",
  "Equality",
  "Relational",
  "Arithmetic",
  "Logical",
  "UnaryNegation",
  "Conditional",
] as const;

/** The four operators added for this study (PLAN §4). */
export const EXTENDED_OPERATORS = ["RemoveAwait", "RemoveOptionalChainOrNullish", "RemoveGuardStatement", "EmptyCatchBody"] as const;

export const OPERATOR_NAMES = [...CLASSIC_OPERATORS, ...EXTENDED_OPERATORS] as const;
export type OperatorName = (typeof OPERATOR_NAMES)[number];

export function isOperatorName(value: string): value is OperatorName {
  return (OPERATOR_NAMES as readonly string[]).includes(value);
}

/**
 * One candidate mutation. `range` is a half-open `[start, end)` pair of UTF-16 code-unit offsets into the exact
 * source text that was enumerated; `original` is `source.slice(start, end)`; applying it replaces that slice with
 * `replacement`. A candidate is NOT an admitted defect: see `admission.ts` (compile + witness, both deferred).
 */
export interface Mutation {
  readonly range: readonly [number, number];
  readonly operator: OperatorName;
  readonly original: string;
  readonly replacement: string;
}

/** What an operator sees while the shared visitor walks the tree. */
export interface OperatorContext {
  readonly ts: TsApi;
  readonly file: TS.SourceFile;
  readonly source: string;
  /** Record `[start, end) -> replacement` for this operator. No-op replacements are dropped by the engine. */
  emit(start: number, end: number, replacement: string): void;
}

export interface MutationOperator {
  readonly name: OperatorName;
  /** Exactly which syntax sites qualify, and what each becomes. Kept beside the code it documents. */
  readonly sites: string;
  /** Called once for every visited node (type-only subtrees are never visited; see enumerate.ts). */
  visit(node: TS.Node, ctx: OperatorContext): void;
}

export class MutationError extends Error {
  readonly code: "parse" | "unknown_operator" | "duplicate_operator" | "range" | "original_mismatch";
  constructor(code: MutationError["code"], message: string) {
    super(message);
    this.name = "MutationError";
    this.code = code;
  }
}
