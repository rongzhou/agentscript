import type { AgentDecl, CallExpr, FuncDecl, Program, Stmt, UseStmt } from "../ast/types.js";
import { formatExpressionSource } from "../ast/format.js";
import { createAgentMap, findFunction, requireAgent, resolveEntryAgent, resolveMainFunction } from "./agents.js";
import { Evaluator } from "./evaluator.js";
import { RuntimeError } from "./errors.js";
import { GenerateRuntime } from "./generate.js";
import { isObject } from "./guards.js";
import { budgetToJson } from "./json.js";
import { prepareEntryInput } from "./input.js";
import { createRuntimeImportBindings, type RuntimeImportBinding } from "./imports.js";
import { createRuntimePaths } from "./paths.js";
import { RuntimeScope } from "./scope.js";
import { buildTraceEvent } from "./trace-event.js";
import { assertNever } from "../utils/assert.js";
import { isTruthy } from "./truth.js";
import { createDefaultMemoryProvider } from "../providers/memory/host.js";
import { MockLlmProvider } from "../providers/mock/provider.js";
import { createDefaultToolProvider } from "../providers/tools/host.js";
import { isDisposable } from "./disposable.js";
import type { InputProvider, LlmProvider, MemoryProvider, RuntimeValue, ToolProvider, TraceEvent } from "./types.js";

export interface ExecuteOptions {
  agentName?: string;
  concurrency?: number;
  functionName?: string;
  llmProvider?: LlmProvider;
  maxCallDepth?: number;
  inputProvider?: InputProvider;
  memoryProvider?: MemoryProvider;
  sourcePath?: string;
  toolProvider?: ToolProvider;
  workspaceRoot?: string;
}

export interface ExecuteResult {
  value: RuntimeValue;
  trace: TraceEvent[];
}

interface ReturnSignal {
  kind: "return";
  value: RuntimeValue;
}

type StatementResult = ReturnSignal | undefined;
const DEFAULT_MAX_CALL_DEPTH = 1000;

export async function executeAgent(
  program: Program,
  input: RuntimeValue,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const interpreter = new Interpreter(program, options);
  const value = await interpreter.execute(input);
  return { value, trace: interpreter.trace };
}

class Interpreter {
  readonly trace: TraceEvent[] = [];
  private readonly llmProvider: LlmProvider;
  private readonly inputProvider?: InputProvider;
  private readonly toolProvider: ToolProvider;
  private readonly memoryProvider: MemoryProvider;
  private readonly entryFunction: string;
  private readonly agent: AgentDecl;
  private readonly agents: Map<string, AgentDecl>;
  private readonly imports: RuntimeImportBinding[];
  private readonly maxCallDepth: number;
  private callDepth = 0;

  constructor(
    program: Program,
    private readonly options: ExecuteOptions,
  ) {
    const paths = createRuntimePaths(options);
    this.llmProvider = options.llmProvider ?? new MockLlmProvider();
    this.inputProvider = options.inputProvider;
    this.toolProvider = options.toolProvider ?? createDefaultToolProvider(paths.workspaceRoot);
    this.memoryProvider =
      options.memoryProvider ??
      createDefaultMemoryProvider({
        baseDir: paths.sourceDir,
        workspaceRoot: paths.workspaceRoot,
      });
    this.agents = createAgentMap(program);
    this.agent = resolveEntryAgent(program, options.agentName);
    this.entryFunction = options.functionName ?? resolveMainFunction(this.agent).name;
    this.imports = createRuntimeImportBindings(program, paths.sourceDir);
    this.maxCallDepth = readMaxCallDepth(options.maxCallDepth);
  }

  async execute(input: RuntimeValue): Promise<RuntimeValue> {
    try {
      const entry = findFunction(this.agent, this.entryFunction);
      if (!entry) {
        throw new RuntimeError(`Unknown function '${this.entryFunction}'`);
      }
      const args =
        entry.params.length === 0 ? [] : [await prepareEntryInput(input, entry, this.inputProvider, this.trace)];
      return await this.callFunction(this.agent, entry.name, args, entry.range, this.trace);
    } finally {
      await Promise.all([
        closeIfDisposable(this.toolProvider),
        closeIfDisposable(this.memoryProvider),
        closeIfDisposable(this.llmProvider),
        closeIfDisposable(this.inputProvider),
      ]);
    }
  }

  private async callFunction(
    agent: AgentDecl,
    name: string,
    args: RuntimeValue[],
    range?: CallExpr["range"],
    trace: TraceEvent[] = this.trace,
  ): Promise<RuntimeValue> {
    const fn = findFunction(agent, name);
    if (!fn) {
      throw new RuntimeError(`Unknown function '${agent.name}.${name}'`, range);
    }
    if (args.length !== fn.params.length) {
      throw new RuntimeError(
        `Function '${agent.name}.${name}' expects ${fn.params.length} argument(s), got ${args.length}`,
        fn.range,
      );
    }
    if (this.callDepth >= this.maxCallDepth) {
      throw new RuntimeError(`Maximum call depth of ${this.maxCallDepth} exceeded`, range ?? fn.range);
    }

    this.callDepth += 1;
    const evaluator = this.createEvaluator(trace, agent);
    const scope = await this.buildFunctionScope(agent, fn, args, evaluator, trace);

    try {
      const signal = await this.executeBlock(fn.body, scope, evaluator, trace, true);
      return signal?.value ?? null;
    } finally {
      this.callDepth -= 1;
    }
  }

  private createEvaluator(trace: TraceEvent[], activeAgent: AgentDecl): Evaluator {
    let evaluator: Evaluator;
    const generateRuntime = new GenerateRuntime(this.llmProvider, trace, {
      currentAgent: () => activeAgent,
      evaluate: (expr, scope) => evaluator.evaluate(expr, scope),
      resolveContextUses: (scope) => evaluator.resolveContextUses(scope),
    });
    evaluator = new Evaluator(this.toolProvider, this.memoryProvider, trace, generateRuntime, {
      callAgent: (agentName, functionName, args, range) => this.callAgent(agentName, functionName, args, range, trace),
      callFunction: (agent, name, args, range) => this.callFunction(agent, name, args, range, trace),
      concurrency: () => this.options.concurrency ?? 4,
      evaluateBlockFinalValue: (statements, scope, blockOptions = {}) => {
        const blockTrace = blockOptions.trace ?? trace;
        const blockEvaluator = blockOptions.trace ? this.createEvaluator(blockTrace, activeAgent) : evaluator;
        return this.evaluateBlockFinalValue(statements, scope, blockEvaluator, blockTrace);
      },
      requireAgent: (name, range) => this.requireAgent(name, range),
      resolveMainFunction,
    });
    return evaluator;
  }

  private async buildFunctionScope(
    agent: AgentDecl,
    fn: FuncDecl,
    args: RuntimeValue[],
    evaluator: Evaluator,
    trace: TraceEvent[],
  ): Promise<RuntimeScope> {
    const agentScope = new RuntimeScope();

    for (const agentName of this.agents.keys()) {
      agentScope.define(agentName, { __agentScriptResource: "agent", name: agentName }, "agent");
    }
    for (const binding of this.imports) {
      agentScope.define(binding.name, binding.value, binding.kind);
    }
    for (const func of agent.functions) {
      agentScope.define(
        func.name,
        { __agentScriptResource: "function", agentName: agent.name, name: func.name },
        "function",
      );
    }
    for (const config of agent.config) {
      const configValue = await evaluator.evaluateConfig(config, agentScope);
      agentScope.setConfig(config.key, configValue);
    }
    for (const use of agent.uses) {
      this.declareUse(use, agentScope, trace);
    }

    const scope = agentScope.child();
    for (const [index, param] of fn.params.entries()) {
      scope.define(param.name, args[index] ?? null, "param");
    }

    return scope;
  }

  private async executeBlock(
    statements: Stmt[],
    scope: RuntimeScope,
    evaluator: Evaluator,
    trace: TraceEvent[],
    allowFinalExpressionReturn = false,
  ): Promise<StatementResult> {
    for (const [index, stmt] of statements.entries()) {
      if (allowFinalExpressionReturn && index === statements.length - 1 && stmt.kind === "ExprStmt") {
        return { kind: "return", value: await evaluator.evaluate(stmt.expr, scope) };
      }
      const result = await this.executeStatement(stmt, scope, evaluator, trace);
      if (result) return result;
    }
    return undefined;
  }

  private async evaluateBlockFinalValue(
    statements: Stmt[],
    scope: RuntimeScope,
    evaluator: Evaluator,
    trace: TraceEvent[],
  ): Promise<RuntimeValue> {
    const signal = await this.executeBlock(statements, scope, evaluator, trace, true);
    if (!signal) {
      throw new RuntimeError("parallel for body must end with a value expression");
    }
    return signal.value;
  }

  private async executeStatement(
    stmt: Stmt,
    scope: RuntimeScope,
    evaluator: Evaluator,
    trace: TraceEvent[],
  ): Promise<StatementResult> {
    switch (stmt.kind) {
      case "ConfigDecl":
        scope.setConfig(stmt.key, await evaluator.evaluateConfig(stmt, scope));
        return undefined;

      case "UseStmt": {
        this.declareUse(stmt, scope, trace);
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
          return this.executeBlock(stmt.thenBody, scope.child(), evaluator, trace);
        }
        if (stmt.elseBody) {
          return this.executeBlock(stmt.elseBody, scope.child(), evaluator, trace);
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
          const result = await this.executeBlock(stmt.body, child, evaluator, trace);
          if (result) return result;
        }
        return undefined;
      }

      case "LoopUntilStmt": {
        for (let index = 0; index < stmt.maxIterations; index += 1) {
          if (isTruthy(await evaluator.evaluate(stmt.condition, scope))) {
            return undefined;
          }
          const result = await this.executeBlock(stmt.body, scope.child(), evaluator, trace);
          if (result) return result;
        }
        return undefined;
      }

      case "RepeatStmt": {
        for (let index = 0; index < stmt.maxAttempts; index += 1) {
          const result = await this.executeBlock(stmt.body, scope.child(), evaluator, trace);
          if (result) return result;
        }
        return undefined;
      }

      case "ReturnStmt":
        return { kind: "return", value: await evaluator.evaluate(stmt.value, scope) };
      default:
        assertNever(stmt);
    }
  }

  private async callAgent(
    agentName: string,
    functionName: string,
    args: RuntimeValue[],
    range: CallExpr["range"],
    trace: TraceEvent[],
  ): Promise<RuntimeValue> {
    const childTrace: TraceEvent[] = [];
    const result = await this.callFunction(this.requireAgent(agentName, range), functionName, args, range, childTrace);
    trace.push(
      buildTraceEvent("agent", {
        agent: agentName,
        function: functionName,
        args,
        result,
        trace: childTrace,
      }),
    );
    return result;
  }

  private requireAgent(name: string, range?: CallExpr["range"]): AgentDecl {
    return requireAgent(this.agents, name, range);
  }

  private declareUse(stmt: UseStmt, scope: RuntimeScope, trace: TraceEvent[]): void {
    const source = formatExpressionSource(stmt.value);
    scope.addUse(stmt.value, source, stmt.budget, stmt.label);
    trace.push(buildTraceEvent("use", { source, label: stmt.label ?? null, budget: budgetToJson(stmt.budget) }));
  }
}

function readMaxCallDepth(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_CALL_DEPTH;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new RuntimeError("maxCallDepth must be a positive integer");
  }
  return value;
}

async function closeIfDisposable(value: unknown): Promise<void> {
  if (!isDisposable(value)) return;
  try {
    await value.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`AgentScript cleanup failed: ${message}`);
  }
}
