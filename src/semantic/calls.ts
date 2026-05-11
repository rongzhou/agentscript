import type { AgentDecl, CallExpr, Expr, FuncDecl, SourceRange } from "../ast/types.js";
import { isMemoryMethod } from "../language/memory.js";
import { type Binding, type SemanticScope, functionBinding } from "./scope.js";

export interface CallCheckHost {
  checkExpression(expr: Expr, scope: SemanticScope): void;
  error(code: string, message: string, range: SourceRange): void;
}

export function checkCallExpression(
  expr: CallExpr,
  scope: SemanticScope,
  agentDecls: Map<string, AgentDecl>,
  host: CallCheckHost,
): void {
  checkCallable(expr.callee, scope, host);
  for (const arg of expr.args) {
    host.checkExpression(arg, scope);
  }
  checkCallArity(expr, scope, agentDecls, host);
}

export function formatArityError(binding: Binding, actual: number): string | undefined {
  if (binding.arity === undefined || binding.arity === actual) {
    return undefined;
  }
  const displayName =
    binding.agentName && binding.functionName ? `${binding.agentName}.${binding.functionName}` : "function";
  return `Function '${displayName}' expects ${binding.arity} argument(s), got ${actual}`;
}

function checkCallable(callee: Expr, scope: SemanticScope, host: CallCheckHost): void {
  if (callee.kind === "IdentifierExpr") {
    const binding = scope.resolve(callee.name);
    if (!binding) {
      host.error("UNKNOWN_FUNCTION", `Unknown function '${callee.name}'`, callee.range);
      return;
    }
    if (binding.kind !== "function" && binding.kind !== "agent") {
      host.error("NOT_CALLABLE", `'${callee.name}' is not an agent function or agent`, callee.range);
    }
    return;
  }

  if (callee.kind === "MemberExpr") {
    host.checkExpression(callee.object, scope);
    if (callee.object.kind === "IdentifierExpr") {
      const binding = scope.resolve(callee.object.name);
      if (binding?.kind === "memory" && !isMemoryMethod(callee.property)) {
        host.error(
          "UNKNOWN_MEMORY_METHOD",
          `Unknown memory method '${callee.object.name}.${callee.property}'`,
          callee.range,
        );
      }
    }
    return;
  }

  host.checkExpression(callee, scope);
  host.error("NOT_CALLABLE", "Only agent functions and member calls can currently be called", callee.range);
}

function checkCallArity(
  expr: CallExpr,
  scope: SemanticScope,
  agentDecls: Map<string, AgentDecl>,
  host: CallCheckHost,
): void {
  if (expr.callee.kind === "IdentifierExpr") {
    const binding = scope.resolve(expr.callee.name);
    if (binding?.kind === "function") {
      checkExpectedArity(binding, expr.args.length, expr.range, host);
    } else if (binding?.kind === "agent" && binding.agentName) {
      const fn = findAgentMainFunction(agentDecls, binding.agentName);
      if (!fn) {
        host.error("UNKNOWN_FUNCTION", `Agent '${binding.agentName}' has no callable main func`, expr.callee.range);
      } else {
        checkExpectedArity(functionBinding(binding.agentName, fn), expr.args.length, expr.range, host);
      }
    }
    return;
  }

  if (expr.callee.kind === "MemberExpr" && expr.callee.object.kind === "IdentifierExpr") {
    const binding = scope.resolve(expr.callee.object.name);
    if (binding?.kind === "agent" && binding.agentName) {
      const fn = findAgentFunction(agentDecls, binding.agentName, expr.callee.property);
      if (!fn) {
        host.error(
          "UNKNOWN_FUNCTION",
          `Unknown function '${binding.agentName}.${expr.callee.property}'`,
          expr.callee.range,
        );
      } else {
        checkExpectedArity(functionBinding(binding.agentName, fn), expr.args.length, expr.range, host);
      }
    } else if (binding?.kind === "memory") {
      checkMemoryMethodArity(expr, host);
    }
  }
}

function checkMemoryMethodArity(expr: CallExpr, host: CallCheckHost): void {
  if (expr.callee.kind !== "MemberExpr" || expr.callee.object.kind !== "IdentifierExpr") {
    return;
  }
  const methodName = `${expr.callee.object.name}.${expr.callee.property}`;
  if (isMemoryMethod(expr.callee.property)) {
    if (expr.args.length !== 1) {
      host.error(
        "INVALID_ARGUMENT_COUNT",
        `Memory method '${methodName}' expects 1 argument(s), got ${expr.args.length}`,
        expr.range,
      );
    }
  } else {
    host.error("UNKNOWN_MEMORY_METHOD", `Unknown memory method '${methodName}'`, expr.callee.range);
  }
}

function checkExpectedArity(binding: Binding, actual: number, range: SourceRange, host: CallCheckHost): void {
  const message = formatArityError(binding, actual);
  if (message) {
    host.error("INVALID_ARGUMENT_COUNT", message, range);
  }
}

function findAgentFunction(
  agentDecls: Map<string, AgentDecl>,
  agentName: string,
  functionName: string,
): FuncDecl | undefined {
  return agentDecls.get(agentName)?.functions.find((fn) => fn.name === functionName);
}

function findAgentMainFunction(agentDecls: Map<string, AgentDecl>, agentName: string): FuncDecl | undefined {
  return agentDecls.get(agentName)?.functions.find((fn) => fn.isMain);
}
