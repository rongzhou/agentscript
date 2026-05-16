import type { Stmt, UseOneOfStmt, UseStmt } from "../../ast/types.js";
import { RuntimeError } from "./errors.js";
import type { Evaluator } from "./evaluator.js";
import { isObject } from "../values/guards.js";
import { buildTraceEvent } from "../trace/trace.js";
import type { RuntimeScope } from "./scope.js";
import { isTruthy } from "./truth.js";
import type { RuntimeValue } from "../values/values.js";
import type { TraceEvent } from "../trace/trace.js";

interface ReturnSignal {
  kind: "return";
  value: RuntimeValue;
}

export type StatementResult = ReturnSignal | undefined;

export interface StatementHost {
  declareUse(stmt: UseStmt | UseOneOfStmt, scope: RuntimeScope, trace: TraceEvent[]): void;
}

export async function executeBlock(
  statements: Stmt[],
  scope: RuntimeScope,
  evaluator: Evaluator,
  trace: TraceEvent[],
  host: StatementHost,
  allowFinalExpressionReturn = false,
): Promise<StatementResult> {
  for (const [index, stmt] of statements.entries()) {
    if (allowFinalExpressionReturn && index === statements.length - 1 && stmt.kind === "ExprStmt") {
      return { kind: "return", value: await evaluator.evaluate(stmt.expr, scope) };
    }
    const result = await executeStatement(stmt, scope, evaluator, trace, host);
    if (result) return result;
  }
  return undefined;
}

export async function evaluateBlockFinalValue(
  statements: Stmt[],
  scope: RuntimeScope,
  evaluator: Evaluator,
  trace: TraceEvent[],
  host: StatementHost,
): Promise<RuntimeValue> {
  const signal = await executeBlock(statements, scope, evaluator, trace, host, true);
  if (!signal) {
    throw new RuntimeError("parallel for body must end with a value expression");
  }
  return signal.value;
}

async function executeStatement(
  stmt: Stmt,
  scope: RuntimeScope,
  evaluator: Evaluator,
  trace: TraceEvent[],
  host: StatementHost,
): Promise<StatementResult> {
  switch (stmt.kind) {
    case "ConfigDecl":
      scope.setConfig(stmt.key, await evaluator.evaluateConfig(stmt, scope));
      return undefined;

    case "UseStmt":
    case "UseOneOfStmt": {
      host.declareUse(stmt, scope, trace);
      return undefined;
    }

    case "AssignStmt": {
      const value = await evaluator.evaluateAssignmentValue(stmt, scope);
      if (stmt.target.kind === "IdentifierExpr") {
        scope.set(stmt.target.name, value, stmt.target.range);
        return undefined;
      }
      if (stmt.target.kind === "MemberExpr") {
        const object = await evaluator.evaluate(stmt.target.object, scope);
        if (Array.isArray(object)) {
          throw new RuntimeError("Cannot assign a property on a list value", stmt.target.range);
        }
        if (!isObject(object)) {
          throw new RuntimeError("Cannot assign a property on a non-object value", stmt.target.range);
        }
        object[stmt.target.property] = value;
        return undefined;
      }
      throw new RuntimeError("Invalid assignment target", stmt.target.range);
    }

    case "ExprStmt":
      await evaluator.evaluate(stmt.expr, scope);
      return undefined;

    case "IfStmt": {
      if (isTruthy(await evaluator.evaluate(stmt.condition, scope))) {
        return executeBlock(stmt.thenBody, scope.child(), evaluator, trace, host);
      }
      if (stmt.elseBody) {
        return executeBlock(stmt.elseBody, scope.child(), evaluator, trace, host);
      }
      return undefined;
    }

    case "ForInStmt": {
      const iterable = await evaluator.evaluate(stmt.iterable, scope);
      if (!Array.isArray(iterable)) {
        throw new RuntimeError("for loop requires a list value", stmt.iterable.range);
      }

      const iterations = Math.min(stmt.maxIterations, iterable.length);
      for (let index = 0; index < iterations; index += 1) {
        const item = iterable[index]!;
        trace.push(
          buildTraceEvent("for", {
            item: stmt.item.name,
            index,
            value: item,
            max_items: stmt.maxIterations,
            total_items: iterable.length,
            truncated: iterable.length > stmt.maxIterations,
          }),
        );
        const child = scope.child();
        child.define(stmt.item.name, item);
        const result = await executeBlock(stmt.body, child, evaluator, trace, host);
        if (result) return result;
      }
      return undefined;
    }

    case "LoopUntilStmt": {
      for (let index = 0; index < stmt.maxIterations; index += 1) {
        if (isTruthy(await evaluator.evaluate(stmt.condition, scope))) {
          return undefined;
        }
        const result = await executeBlock(stmt.body, scope.child(), evaluator, trace, host);
        if (result) return result;
      }
      return undefined;
    }

    case "RepeatStmt": {
      for (let index = 0; index < stmt.maxAttempts; index += 1) {
        const result = await executeBlock(stmt.body, scope.child(), evaluator, trace, host);
        if (result) return result;
      }
      return undefined;
    }

    case "ReturnStmt":
      return { kind: "return", value: await evaluator.evaluate(stmt.value, scope) };
  }
}
