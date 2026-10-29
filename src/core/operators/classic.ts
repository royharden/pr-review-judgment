// The eight classic operators. Design-informed by S39 `d5f9e40` cli/engines/inhouse.ts (enumerateInhouse); implemented
// here, not vendored (PLAN K13). Differences from S39, each deliberate: ranges are UTF-16 offsets, not line/column;
// Relational emits exactly one boundary flip per site; Arithmetic skips `+` with a syntactic string operand; numeric
// candidates are rendered so they re-parse (negatives and property-access receivers are parenthesised); and
// operator-token replacements are padded with a space only where the neighbouring character would otherwise merge
// into a different token (`a-+b` -> `a + +b`, never `a++b`).
import type * as TS from "typescript";
import type { MutationOperator, OperatorContext } from "./types.ts";

const isWhitespaceOrEdge = (ch: string): boolean => ch === "" || /\s/.test(ch);

/** Replacement text for an operator token at `[start, end)`, padded so it cannot fuse with its neighbours. */
export function paddedToken(source: string, start: number, end: number, text: string): string {
  const before = isWhitespaceOrEdge(source.charAt(start - 1)) ? "" : " ";
  const after = isWhitespaceOrEdge(source.charAt(end)) ? "" : " ";
  return `${before}${text}${after}`;
}

function emitToken(token: TS.Node, ctx: OperatorContext, text: string): void {
  const start = token.getStart(ctx.file);
  ctx.emit(start, token.end, paddedToken(ctx.source, start, token.end, text));
}

function binaryOperatorSite(node: TS.Node, ctx: OperatorContext, table: ReadonlyMap<TS.SyntaxKind, string>): void {
  if (!ctx.ts.isBinaryExpression(node)) return;
  const replacement = table.get(node.operatorToken.kind);
  if (replacement !== undefined) emitToken(node.operatorToken, ctx, replacement);
}

/** True when `node` is the `name` of its parent (property names, member names, enum member names). */
function isNameOfParent(node: TS.Node): boolean {
  const parent = node.parent as TS.Node & { readonly name?: TS.Node };
  return parent !== undefined && parent.name === node;
}

function skipParens(ts: OperatorContext["ts"], node: TS.Expression): TS.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

export const BooleanLiteral: MutationOperator = {
  name: "BooleanLiteral",
  sites:
    "Every `true` / `false` keyword in expression position becomes the other literal. Type positions (`x: true`) are " +
    "never visited.",
  visit(node, ctx) {
    if (node.kind === ctx.ts.SyntaxKind.TrueKeyword) ctx.emit(node.getStart(ctx.file), node.end, "false");
    else if (node.kind === ctx.ts.SyntaxKind.FalseKeyword) ctx.emit(node.getStart(ctx.file), node.end, "true");
  },
};

export const NumericBoundary: MutationOperator = {
  name: "NumericBoundary",
  sites:
    "Every NumericLiteral in expression position (including `case` labels, array indices and initialisers) becomes " +
    "each distinct value of {0, n + 1, n - 1} that differs numerically from n. Excluded: property/member names " +
    "(`{ 1: x }`), type positions (`x: 1`), BigInt literals, and literals whose value is not finite. Negative " +
    "results are written `(-k)`; a literal that is the receiver of a property access is written `(k)`.",
  visit(node, ctx) {
    const { ts } = ctx;
    if (!ts.isNumericLiteral(node) || isNameOfParent(node)) return;
    const value = Number(node.text);
    if (!Number.isFinite(value)) return;
    const receiver = ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node;
    const start = node.getStart(ctx.file);
    const seen = new Set<number>();
    for (const candidate of [0, value + 1, value - 1]) {
      if (candidate === value || seen.has(candidate)) continue;
      seen.add(candidate);
      const text = String(candidate);
      ctx.emit(start, node.end, candidate < 0 || receiver ? `(${text})` : text);
    }
  },
};

const EQUALITY = (ts: OperatorContext["ts"]): ReadonlyMap<TS.SyntaxKind, string> =>
  new Map([
    [ts.SyntaxKind.EqualsEqualsToken, "!="],
    [ts.SyntaxKind.ExclamationEqualsToken, "=="],
    [ts.SyntaxKind.EqualsEqualsEqualsToken, "!=="],
    [ts.SyntaxKind.ExclamationEqualsEqualsToken, "==="],
  ]);

export const Equality: MutationOperator = {
  name: "Equality",
  sites: "The operator token of every binary `==`, `!=`, `===`, `!==` is swapped with its negation (`===` <-> `!==`, `==` <-> `!=`).",
  visit(node, ctx) {
    binaryOperatorSite(node, ctx, EQUALITY(ctx.ts));
  },
};

const RELATIONAL = (ts: OperatorContext["ts"]): ReadonlyMap<TS.SyntaxKind, string> =>
  new Map([
    [ts.SyntaxKind.LessThanToken, "<="],
    [ts.SyntaxKind.LessThanEqualsToken, "<"],
    [ts.SyntaxKind.GreaterThanToken, ">="],
    [ts.SyntaxKind.GreaterThanEqualsToken, ">"],
  ]);

export const Relational: MutationOperator = {
  name: "Relational",
  sites:
    "The operator token of every binary `<`, `<=`, `>`, `>=` gets exactly one boundary flip: `<` -> `<=`, `<=` -> `<`, " +
    "`>` -> `>=`, `>=` -> `>`. Not `instanceof`/`in`; not `<`/`>` of type arguments or JSX (not binary expressions).",
  visit(node, ctx) {
    binaryOperatorSite(node, ctx, RELATIONAL(ctx.ts));
  },
};

const ARITHMETIC = (ts: OperatorContext["ts"]): ReadonlyMap<TS.SyntaxKind, string> =>
  new Map([
    [ts.SyntaxKind.PlusToken, "-"],
    [ts.SyntaxKind.MinusToken, "+"],
    [ts.SyntaxKind.AsteriskToken, "/"],
    [ts.SyntaxKind.SlashToken, "*"],
    [ts.SyntaxKind.PercentToken, "*"],
  ]);

export const Arithmetic: MutationOperator = {
  name: "Arithmetic",
  sites:
    "The operator token of every binary `+` -> `-`, `-` -> `+`, `*` -> `/`, `/` -> `*`, `%` -> `*`. Skipped: `+` " +
    "where either operand (ignoring parentheses) is a string literal or template (string concatenation). Not " +
    "compound assignments (`+=`), not `**`, not unary `+`/`-`, not `++`/`--`.",
  visit(node, ctx) {
    const { ts } = ctx;
    if (!ts.isBinaryExpression(node)) return;
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const stringish = (e: TS.Expression) => {
        const inner = skipParens(ts, e);
        return ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isTemplateExpression(inner);
      };
      if (stringish(node.left) || stringish(node.right)) return;
    }
    binaryOperatorSite(node, ctx, ARITHMETIC(ts));
  },
};

const LOGICAL = (ts: OperatorContext["ts"]): ReadonlyMap<TS.SyntaxKind, string> =>
  new Map([
    [ts.SyntaxKind.AmpersandAmpersandToken, "||"],
    [ts.SyntaxKind.BarBarToken, "&&"],
  ]);

export const Logical: MutationOperator = {
  name: "Logical",
  sites:
    "The operator token of every binary `&&` -> `||` and `||` -> `&&`. Not `??` (see RemoveOptionalChainOrNullish), " +
    "not logical assignments (`&&=`, `||=`, `??=`).",
  visit(node, ctx) {
    binaryOperatorSite(node, ctx, LOGICAL(ctx.ts));
  },
};

export const UnaryNegation: MutationOperator = {
  name: "UnaryNegation",
  sites:
    "Every prefix `!operand` is replaced, whole, by `(operand)` (the negation is removed). `!!x` yields two mutants: " +
    "outer `(!x)` and inner `!(x)`. Not unary `-`, `~`, `+`.",
  visit(node, ctx) {
    const { ts } = ctx;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      ctx.emit(node.getStart(ctx.file), node.end, `(${node.operand.getText(ctx.file)})`);
    }
  },
};

export const Conditional: MutationOperator = {
  name: "Conditional",
  sites:
    "The condition of every ternary `c ? a : b` is replaced by `!(c)`. Only conditional expressions (as in S39); `if`, " +
    "loop and guard conditions are not this operator (RemoveGuardStatement covers early-exit guards).",
  visit(node, ctx) {
    if (ctx.ts.isConditionalExpression(node)) {
      const c = node.condition;
      ctx.emit(c.getStart(ctx.file), c.end, `!(${c.getText(ctx.file)})`);
    }
  },
};

export const CLASSIC: readonly MutationOperator[] = [
  BooleanLiteral,
  NumericBoundary,
  Equality,
  Relational,
  Arithmetic,
  Logical,
  UnaryNegation,
  Conditional,
];
