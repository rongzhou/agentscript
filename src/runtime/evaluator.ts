import { assertNever } from "../utils/assert.js";
import { formatExpressionSource } from "../ast/format.js";
import type {
  AgentDecl,
  CallExpr,
  ConfigDecl,
  ConfigStmt,
  Expr,
  MemberExpr,
  ParallelForExpr,
  SourceRange,
  Stmt,
} from "../ast/types.js";
import { RuntimeError } from "./errors.js";
import { GenerateRuntime } from "./generate.js";
import { isAgentBinding, isFunctionBinding, isLlmBinding, isMemoryBinding, isObject, isToolBinding } from "./guards.js";
import { runtimeValuesEqual, sanitizeForJson } from "./json.js";
import type { RuntimeScope } from "./scope.js";
import { uriScheme } from "./uri.js";
import { isTruthy } from "./truth.js";
import {
  type ContextUse,
  type JsonValue,
  type MemoryBinding,
  type MemoryProvider,
  type RuntimeValue,
  type ToolBinding,
  type ToolProvider,
  type TraceEvent,
} from "./types.js";

export interface EvaluatorHost {
  callAgent(agentName: string, functionName: string, args: RuntimeValue[], range: SourceRange): Promise<RuntimeValue>;
  callFunction(agent: AgentDecl, name: string, args: RuntimeValue[], range?: SourceRange): Promise<RuntimeValue>;
  concurrency(): number;
  evaluateBlockFinalValue(statements: Stmt[], scope: RuntimeScope): Promise<RuntimeValue>;
  requireAgent(name: string, range?: SourceRange): AgentDecl;
  resolveMainFunction(agent: AgentDecl): { name: string };
}

export class Evaluator {
  constructor(
    private readonly toolProvider: ToolProvider,
    private readonly memoryProvider: MemoryProvider,
    private readonly trace: TraceEvent[],
    private readonly generateRuntime: GenerateRuntime,
    private readonly host: EvaluatorHost,
  ) {}

  async evaluateConfig(config: ConfigDecl | ConfigStmt, scope: RuntimeScope): Promise<RuntimeValue> {
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
    return this.evaluateArithmetic(stmt.operator === "+=" ? "+" : "-", left, right, stmt.range);
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
        return this.evaluateParallelFor(expr, scope);
      default:
        assertNever(expr);
    }
  }

  private async evaluateParallelFor(expr: ParallelForExpr, scope: RuntimeScope): Promise<RuntimeValue[]> {
    const iterable = await this.evaluate(expr.iterable, scope);
    if (!Array.isArray(iterable)) {
      throw new RuntimeError("parallel for source must be a list", expr.iterable.range);
    }
    const selected = iterable.slice(0, expr.maxIterations);
    const concurrency = Math.max(1, Math.floor(this.host.concurrency()));
    const start = Date.now();
    this.trace.push({
      kind: "parallel_for",
      data: {
        item: expr.itemName,
        source: formatExpressionSource(expr.iterable),
        max_items: expr.maxIterations,
        items: selected.length,
        concurrency,
      },
    });

    const result = await mapLimitWaitAll(selected, concurrency, async (item) => {
      const child = scope.child();
      child.define(expr.itemName, item);
      return this.host.evaluateBlockFinalValue(expr.body, child);
    });
    if (result.failures.length > 0) {
      this.trace.push({
        kind: "parallel_for",
        data: {
          item: expr.itemName,
          source: formatExpressionSource(expr.iterable),
          items: selected.length,
          concurrency,
          duration_ms: Date.now() - start,
          ok: false,
          failed_indices: result.failures.map((failure) => failure.index),
        },
      });
      throw new RuntimeError(
        `parallel for failed: ${result.failures.map((failure) => `[${failure.index}] ${failure.message}`).join("; ")}`,
        expr.range,
      );
    }

    this.trace.push({
      kind: "parallel_for",
      data: {
        item: expr.itemName,
        source: formatExpressionSource(expr.iterable),
        items: selected.length,
        concurrency,
        duration_ms: Date.now() - start,
        ok: true,
      },
    });
    return result.values;
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
      case "and":
        return isTruthy(await this.evaluate(expr.left, scope)) && isTruthy(await this.evaluate(expr.right, scope));
      case "or":
        return isTruthy(await this.evaluate(expr.left, scope)) || isTruthy(await this.evaluate(expr.right, scope));
      case "==":
        return this.valuesEqual(await this.evaluate(expr.left, scope), await this.evaluate(expr.right, scope));
      case "!=":
        return !this.valuesEqual(await this.evaluate(expr.left, scope), await this.evaluate(expr.right, scope));
      case "<":
      case ">":
        return this.evaluateComparison(
          expr.operator,
          await this.evaluate(expr.left, scope),
          await this.evaluate(expr.right, scope),
          expr.range,
        );
      case "+":
      case "-":
        return this.evaluateArithmetic(
          expr.operator,
          await this.evaluate(expr.left, scope),
          await this.evaluate(expr.right, scope),
          expr.range,
        );
    }
  }

  private evaluateComparison(
    operator: "<" | ">",
    left: RuntimeValue,
    right: RuntimeValue,
    range: SourceRange,
  ): boolean {
    if (typeof left !== "number" || typeof right !== "number") {
      throw new RuntimeError(`operator '${operator}' requires number operands`, range);
    }
    return operator === "<" ? left < right : left > right;
  }

  private evaluateArithmetic(
    operator: "+" | "-",
    left: RuntimeValue,
    right: RuntimeValue,
    range: SourceRange,
  ): RuntimeValue {
    if (operator === "+" && (typeof left === "string" || typeof right === "string")) {
      return `${formatArithmeticOperand(left)}${formatArithmeticOperand(right)}`;
    }
    if (typeof left !== "number" || typeof right !== "number") {
      throw new RuntimeError(`operator '${operator}' requires number operands`, range);
    }
    return operator === "+" ? left + right : left - right;
  }

  private valuesEqual(left: RuntimeValue, right: RuntimeValue): boolean {
    return runtimeValuesEqual(left, right);
  }

  private async evaluateMember(expr: MemberExpr, scope: RuntimeScope): Promise<RuntimeValue> {
    const object = await this.evaluate(expr.object, scope);
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

    if (isToolBinding(object)) return { tool: object.name, method: property };
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
      return this.evaluateToolCall(object, callee, args);
    }

    if (isMemoryBinding(object)) {
      return this.evaluateMemoryCall(object, callee, args);
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

  private async evaluateToolCall(object: ToolBinding, callee: MemberExpr, args: RuntimeValue[]): Promise<RuntimeValue> {
    const request = {
      toolName: object.name,
      uri: object.uri,
      method: callee.property,
      args,
    };
    let result: RuntimeValue;
    try {
      result = await this.toolProvider.call(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RuntimeError(`Tool ${object.name}.${callee.property} (${object.uri}) failed: ${message}`, callee.range);
    }
    this.trace.push({
      kind: "tool",
      data: {
        tool: object.name,
        method: callee.property,
        scheme: uriScheme(object.uri),
        uri: object.uri,
        args: sanitizeForJson(args),
        result: sanitizeForJson(result),
        effects: this.readEffects(result),
      },
    });
    return result;
  }

  private async evaluateMemoryCall(
    object: MemoryBinding,
    callee: MemberExpr,
    args: RuntimeValue[],
  ): Promise<RuntimeValue> {
    if (args.length !== 1) {
      throw new RuntimeError(`memory.${callee.property} expects exactly one argument`, callee.range);
    }

    let result: RuntimeValue;
    try {
      if (callee.property === "add") {
        result = await this.memoryProvider.add({
          memoryName: object.name,
          uri: object.uri,
          record: args[0]!,
        });
      } else if (callee.property === "query") {
        result = await this.memoryProvider.query({
          memoryName: object.name,
          uri: object.uri,
          query: args[0]!,
        });
      } else {
        throw new RuntimeError(`Unknown memory method '${callee.property}'`, callee.range);
      }
    } catch (error) {
      if (error instanceof RuntimeError) {
        throw error.range ? error : new RuntimeError(error.message, callee.range);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new RuntimeError(
        `Memory ${object.name}.${callee.property} (${object.uri}) failed: ${message}`,
        callee.range,
      );
    }

    const traceData = {
      memory: object.name,
      operation: callee.property,
      uri: object.uri,
      args: sanitizeForJson(args[0]!),
      result: sanitizeForJson(result),
      count: Array.isArray(result) ? result.length : null,
    };
    if (callee.property === "add" && isObject(result)) {
      Object.assign(traceData, {
        id: typeof result.id === "string" ? result.id : null,
        record: sanitizeForJson(result.record),
      });
    }
    this.trace.push({
      kind: "memory",
      data: traceData,
    });
    return result;
  }

  private async evaluateAll(exprs: Expr[], scope: RuntimeScope): Promise<RuntimeValue[]> {
    const values: RuntimeValue[] = [];
    for (const expr of exprs) {
      values.push(await this.evaluate(expr, scope));
    }
    return values;
  }

  private readEffects(value: RuntimeValue): JsonValue {
    if (isObject(value) && Array.isArray(value.effects)) {
      return sanitizeForJson(value.effects);
    }
    return null;
  }
}

function formatArithmeticOperand(value: RuntimeValue): string {
  return typeof value === "string" ? value : JSON.stringify(sanitizeForJson(value));
}

interface MapLimitFailure {
  index: number;
  message: string;
}

async function mapLimitWaitAll<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<{ values: R[]; failures: MapLimitFailure[] }> {
  const results = new Array<R>(items.length);
  const failures: MapLimitFailure[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index]!, index);
      } catch (error) {
        failures.push({ index, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  failures.sort((left, right) => left.index - right.index);
  return { values: results, failures };
}
