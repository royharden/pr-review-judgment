// The four operators added for this study (PLAN §4): they target the G-ASY, G-BND and G-ERR defect groups that the
// classic set reaches poorly. Implemented here; no upstream exists for them.
import type * as TS from "typescript";
import type { MutationOperator, OperatorContext } from "./types.ts";

export const RemoveAwait: MutationOperator = {
  name: "RemoveAwait",
  sites:
    "Every `await expr` expression (including top-level await) is replaced, whole, by `expr` exactly as written " +
    "(`await f(x)` -> `f(x)`, `(await p).v` -> `(p).v`). Not `for await (...)` (a loop modifier, not an await " +
    "expression). The operand of `await` is a unary expression, so it re-parses in the same position.",
  visit(node, ctx) {
    if (ctx.ts.isAwaitExpression(node)) {
      ctx.emit(node.getStart(ctx.file), node.end, node.expression.getText(ctx.file));
    }
  },
};

export const RemoveOptionalChainOrNullish: MutationOperator = {
  name: "RemoveOptionalChainOrNullish",
  sites:
    "(a) Every optional-chain link loses its `?.` token: property access `a?.b` -> `a.b`, element access `a?.[k]` -> " +
    "`a[k]`, call `f?.(x)` -> `f(x)` (only the link that carries `?.` changes). (b) Every binary `l ?? r` is " +
    "replaced, whole, by `l` (the fallback is removed). Not `??=`.",
  visit(node, ctx) {
    const { ts } = ctx;
    const dropQuestionDot = (token: TS.QuestionDotToken | undefined, replacement: string) => {
      if (token !== undefined) ctx.emit(token.getStart(ctx.file), token.end, replacement);
    };
    if (ts.isPropertyAccessExpression(node)) dropQuestionDot(node.questionDotToken, ".");
    else if (ts.isElementAccessExpression(node)) dropQuestionDot(node.questionDotToken, "");
    else if (ts.isCallExpression(node)) dropQuestionDot(node.questionDotToken, "");
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      ctx.emit(node.getStart(ctx.file), node.end, node.left.getText(ctx.file));
    }
  },
};

/** An early-exit statement: `return [x]`, `throw x`, `continue [l]`, `break [l]`. */
function isExit(ts: OperatorContext["ts"], s: TS.Statement): boolean {
  return ts.isReturnStatement(s) || ts.isThrowStatement(s) || ts.isContinueStatement(s) || ts.isBreakStatement(s);
}

/** Statement lists in which a statement can simply be deleted. */
function inStatementList(ts: OperatorContext["ts"], node: TS.Node): boolean {
  const p = node.parent;
  return ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isModuleBlock(p);
}

export const RemoveGuardStatement: MutationOperator = {
  name: "RemoveGuardStatement",
  sites:
    "Every `if (cond) EXIT` with NO `else` branch, where EXIT is a single `return`/`throw`/`continue`/`break` " +
    "statement or a block containing exactly one such statement, is deleted whole (condition and body). In a " +
    "statement list (block, file, case clause) it becomes the empty string; as the body of another statement " +
    "(`else if (...) return;`, a loop or label body) it becomes `;` so the outer statement still parses. Not guards " +
    "with an `else`, multi-statement bodies, or bodies that only assign.",
  visit(node, ctx) {
    const { ts } = ctx;
    if (!ts.isIfStatement(node) || node.elseStatement !== undefined) return;
    const body = node.thenStatement;
    const exitOnly = ts.isBlock(body)
      ? body.statements.length === 1 && isExit(ts, body.statements[0]!)
      : isExit(ts, body);
    if (!exitOnly) return;
    ctx.emit(node.getStart(ctx.file), node.end, inStatementList(ts, node) ? "" : ";");
  },
};

export const EmptyCatchBody: MutationOperator = {
  name: "EmptyCatchBody",
  sites:
    "The block of every `catch` clause (with or without a binding) that contains at least one statement is " +
    "replaced by `{}` (the error is swallowed). Already-empty catch blocks and `finally` blocks are not sites.",
  visit(node, ctx) {
    if (ctx.ts.isCatchClause(node) && node.block.statements.length > 0) {
      ctx.emit(node.block.getStart(ctx.file), node.block.end, "{}");
    }
  },
};

export const EXTENDED: readonly MutationOperator[] = [RemoveAwait, RemoveOptionalChainOrNullish, RemoveGuardStatement, EmptyCatchBody];
