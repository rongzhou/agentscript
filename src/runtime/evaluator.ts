import { assertNever } from "../utils/assert.js";
import type { AgentDecl, CallExpr, ConfigDecl, Expr, MemberExpr, SourceRange, Stmt } from "../ast/types.js";
import { RuntimeError } from "./errors.js";
import { GenerateRuntime } from "./generate.js";
import { isAgentBinding, isFunctionBinding, isLlmBinding, isMemoryBinding, isObject, isToolBinding } from "./guards.js";
import { sanitizeForJson } from "./json.js";
import { evaluateBinaryOperator } from "./operators.js";
import { ResourceCallRuntime } from "./resource-calls.js";
import type { RuntimeScope } from "./scope.js";
import { isTruthy } from "./truth.js";
import { evaluateParallelFor } from "./parallel-for.js";
import {
  type ContextUse,
  type MemoryProvider,
  type RuntimeValue,
  type ToolProvider,
  type TraceEvent,
} from "./types.js";

export interface EvaluatorHost {
  callAgent(agentName: string, functionName: string, args: RuntimeValue[], range: SourceRange): Promise<RuntimeValue>;
  callFunction(agent: AgentDecl, name: string, args: RuntimeValue[], range?: SourceRange): Promise<RuntimeValue>;
  concurrency(): number;
  evaluateBlockFinalValue(
    statements: Stmt[],
    scope: RuntimeScope,
    options?: { trace?: TraceEvent[] },
  ): Promise<RuntimeValue>;
  requireAgent(name: string, range?: SourceRange): AgentDecl;
  resolveMainFunction(agent: AgentDecl): { name: string };
}

export class Evaluator {
  private readonly resourceCalls: ResourceCallRuntime;

  constructor(
    toolProvider: ToolProvider,
    memoryProvider: MemoryProvider,
    private readonly trace: TraceEvent[],
    private readonly generateRuntime: GenerateRuntime,
    private readonly host: EvaluatorHost,
  ) {
    this.resourceCalls = new ResourceCallRuntime(toolProvider, memoryProvider, trace);
  }

  async evaluateConfig(config: ConfigDecl, scope: RuntimeScope): Promise<RuntimeValue> {
    switch (config.key) {
      case "model": {
        const value = await this.evaluate(config.value, scope);
        if (!isLlmBinding(value)) {
          throw new RuntimeError("model must reference an imported llm", config.value.range);
        }
        return value;
      }
      case "role":
      case "description": {
        const value = await this.evaluate(config.value, scope);
        if (typeof value !== "string") {
          throw new RuntimeError(`${config.key} must be a string`, config.value.range);
        }
        return value;
      }
    }
  }

  async evaluateAssignmentValue(
    stmt: Extract<Stmt, { kind: "AssignStmt" }>,
    scope: RuntimeScope,
  ): Promise<RuntimeValue> {
    const right = await this.evaluate(stmt.value, scope);
    if (stmt.operator === "=") {
      return right;
    }
    const left = await this.evaluate(stmt.target, scope);
    return evaluateBinaryOperator(stmt.operator === "+=" ? "+" : "-", left, right, stmt.range);
  }

  async evaluate(expr: Expr, scope: RuntimeScope): Promise<RuntimeValue> {
    switch (expr.kind) {
      case "IdentifierExpr":
        return scope.get(expr.name, expr.range);
      case "StringExpr":
        return expr.value;
      case "NumberExpr":
        return expr.value;
      case "BooleanExpr":
        return expr.value;
      case "NullExpr":
        return null;
      case "ListExpr":
        return this.evaluateAll(expr.items, scope);
      case "ObjectExpr": {
        const result: Record<string, RuntimeValue> = {};
        for (const property of expr.properties) {
          result[property.key] = await this.evaluate(property.value, scope);
        }
        return result;
      }
      case "ShapeObjectExpr":
        throw new RuntimeError("Shape object cannot be evaluated as a runtime value", expr.range);
      case "MemberExpr":
        return this.evaluateMember(expr, scope);
      case "IndexExpr":
        return this.evaluateIndex(expr, scope);
      case "UnaryExpr":
        return !isTruthy(await this.evaluate(expr.value, scope));
      case "BinaryExpr":
        return this.evaluateBinary(expr, scope);
      case "CallExpr":
        return this.evaluateCall(expr, scope);
      case "GenerateExpr":
        return this.generateRuntime.evaluateGenerate(expr, scope);
      case "ParallelForExpr":
        return evaluateParallelFor(expr, scope, this.trace, {
          concurrency: () => this.host.concurrency(),
          evaluateExpression: (value, currentScope) => this.evaluate(value, currentScope),
          evaluateBlockFinalValue: (statements, currentScope, trace) =>
            this.host.evaluateBlockFinalValue(statements, currentScope, { trace }),
        });
      default:
        assertNever(expr);
    }
  }

  async resolveContextUses(scope: RuntimeScope): Promise<ContextUse[]> {
    const uses: ContextUse[] = [];
    for (const item of scope.visibleUses()) {
      uses.push({
        source: item.source,
        label: item.label,
        value: await this.evaluate(item.expr, item.scope),
        budget: item.budget,
      });
    }
    return uses;
  }

  private async evaluateBinary(
    expr: Extract<Expr, { kind: "BinaryExpr" }>,
    scope: RuntimeScope,
  ): Promise<RuntimeValue> {
    switch (expr.operator) {
      case "and": {
        const left = await this.evaluate(expr.left, scope);
        return isTruthy(left)
          ? evaluateBinaryOperator(expr.operator, left, await this.evaluate(expr.right, scope), expr.range)
          : false;
      }
      case "or": {
        const left = await this.evaluate(expr.left, scope);
        return isTruthy(left)
          ? true
          : evaluateBinaryOperator(expr.operator, left, await this.evaluate(expr.right, scope), expr.range);
      }
      case "<":
      case "<=":
      case ">":
      case ">=":
      case "+":
      case "-":
      case "*":
      case "/":
      case "==":
      case "!=":
        return evaluateBinaryOperator(
          expr.operator,
          await this.evaluate(expr.left, scope),
          await this.evaluate(expr.right, scope),
          expr.range,
        );
    }
  }

  private async evaluateMember(expr: MemberExpr, scope: RuntimeScope): Promise<RuntimeValue> {
    const object = await this.evaluate(expr.object, scope);
    if (isToolBinding(object)) {
      return this.resourceCalls.readToolMember(object, expr);
    }
    return this.readMember(object, expr.property, expr.range);
  }

  private async evaluateIndex(expr: Extract<Expr, { kind: "IndexExpr" }>, scope: RuntimeScope): Promise<RuntimeValue> {
    const object = await this.evaluate(expr.object, scope);
    const index = await this.evaluate(expr.index, scope);
    if (!Array.isArray(object)) {
      throw new RuntimeError("Index access requires a list value", expr.object.range);
    }
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      throw new RuntimeError("List index must be a non-negative integer", expr.index.range);
    }
    if (index >= object.length) {
      throw new RuntimeError(`List index ${index} is out of range`, expr.index.range);
    }
    return object[index]!;
  }

  private readMember(object: RuntimeValue, property: string, range?: MemberExpr["range"]): RuntimeValue {
    if (Array.isArray(object)) {
      if (property === "summary") {
        return object.map((item) => sanitizeForJson(item));
      }
      if (property === "length") {
        return object.length;
      }
      throw new RuntimeError(`Unknown list property '${property}'`, range);
    }

    if (isObject(object)) {
      if (!(property in object)) {
        throw new RuntimeError(`Unknown object property '${property}'`, range);
      }
      return object[property]!;
    }

    if (isMemoryBinding(object)) return { memory: object.name, method: property };

    throw new RuntimeError(`Cannot read property '${property}'`, range);
  }

  private async evaluateCall(expr: CallExpr, scope: RuntimeScope): Promise<RuntimeValue> {
    if (expr.callee.kind === "IdentifierExpr") {
      const args = await this.evaluateAll(expr.args, scope);
      const callee = scope.get(expr.callee.name, expr.callee.range);
      if (isFunctionBinding(callee)) {
        return this.host.callFunction(this.host.requireAgent(callee.agentName), callee.name, args, expr.range);
      }
      if (isAgentBinding(callee)) {
        const agent = this.host.requireAgent(callee.name, expr.range);
        return this.host.callAgent(callee.name, this.host.resolveMainFunction(agent).name, args, expr.range);
      }
      throw new RuntimeError(`'${expr.callee.name}' is not callable`, expr.callee.range);
    }

    if (expr.callee.kind === "MemberExpr") {
      return this.evaluateMemberCall(expr.callee, expr.args, scope);
    }

    throw new RuntimeError("Unsupported call expression", expr.range);
  }

  private async evaluateMemberCall(callee: MemberExpr, argsExpr: Expr[], scope: RuntimeScope): Promise<RuntimeValue> {
    const object = await this.evaluate(callee.object, scope);
    const args = await this.evaluateAll(argsExpr, scope);

    if (isAgentBinding(object)) {
      return this.host.callAgent(object.name, callee.property, args, callee.range);
    }

    if (isToolBinding(object)) {
      return this.resourceCalls.callTool(object, callee, args);
    }

    if (isMemoryBinding(object)) {
      return this.resourceCalls.callMemory(object, callee, args);
    }

    if (Array.isArray(object) && callee.property === "add") {
      if (args.length !== 1) {
        throw new RuntimeError("list.add expects exactly one argument", callee.range);
      }
      object.push(args[0]!);
      return object;
    }

    throw new RuntimeError(`Unsupported member call '${callee.property}'`, callee.range);
  }

  private async evaluateAll(exprs: Expr[], scope: RuntimeScope): Promise<RuntimeValue[]> {
    const values: RuntimeValue[] = [];
    for (const expr of exprs) {
      values.push(await this.evaluate(expr, scope));
    }
    return values;
  }
}
