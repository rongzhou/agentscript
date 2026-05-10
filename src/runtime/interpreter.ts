import { readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import type { AgentDecl, CallExpr, FuncDecl, Program, Stmt } from "../ast/types.js";
import { formatExpressionSource } from "../ast/format.js";
import { assertSemanticallyValid } from "../semantic/analyzer.js";
import { Evaluator } from "./evaluator.js";
import { RuntimeError } from "./errors.js";
import { GenerateRuntime } from "./generate.js";
import { isObject } from "./guards.js";
import { budgetToJson, sanitizeForJson } from "./json.js";
import { prepareEntryInput } from "./input.js";
import { RuntimeScope } from "./scope.js";
import { assertNever } from "../utils/assert.js";
import { isTruthy } from "./truth.js";
import { createDefaultMemoryProvider } from "../providers/memory/index.js";
import { MockLlmProvider } from "../providers/mock/index.js";
import { createDefaultToolProvider } from "../providers/tools/index.js";
import { isDisposable } from "./disposable.js";
import type { InputProvider, LlmProvider, MemoryProvider, RuntimeValue, ToolProvider, TraceEvent } from "./types.js";

export interface ExecuteOptions {
  agentName?: string;
  concurrency?: number;
  functionName?: string;
  llmProvider?: LlmProvider;
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

interface ImportBinding {
  name: string;
  kind: "tool" | "llm" | "file" | "memory";
  value: RuntimeValue;
}

type StatementResult = ReturnSignal | undefined;
const MAX_CALL_DEPTH = 1000;

export async function executeAgent(
  program: Program,
  input: RuntimeValue,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  assertSemanticallyValid(program);
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
  private readonly evaluator: Evaluator;
  private readonly entryFunction: string;
  private readonly agent: AgentDecl;
  private currentAgent: AgentDecl;
  private readonly agents = new Map<string, AgentDecl>();
  private readonly imports: ImportBinding[] = [];
  private callDepth = 0;

  constructor(
    private readonly program: Program,
    private readonly options: ExecuteOptions,
  ) {
    this.llmProvider = options.llmProvider ?? new MockLlmProvider();
    this.inputProvider = options.inputProvider;
    this.toolProvider = options.toolProvider ?? createDefaultToolProvider(options.workspaceRoot);
    this.memoryProvider =
      options.memoryProvider ??
      createDefaultMemoryProvider({
        baseDir: this.programSourceDir(),
        workspaceRoot: options.workspaceRoot ?? this.programSourceDir(),
      });
    const generateRuntime = new GenerateRuntime(this.llmProvider, this.trace, {
      currentAgent: () => this.currentAgent,
      evaluate: (expr, scope) => this.evaluator.evaluate(expr, scope),
      resolveContextUses: (scope) => this.evaluator.resolveContextUses(scope),
    });
    this.evaluator = new Evaluator(this.toolProvider, this.memoryProvider, this.trace, generateRuntime, {
      callAgent: (agentName, functionName, args, range) => this.callAgent(agentName, functionName, args, range),
      callFunction: (agent, name, args, range) => this.callFunction(agent, name, args, range),
      concurrency: () => this.options.concurrency ?? 4,
      evaluateBlockFinalValue: (statements, scope) => this.evaluateBlockFinalValue(statements, scope),
      requireAgent: (name, range) => this.requireAgent(name, range),
      resolveMainFunction: (agent) => this.resolveMainFunction(agent),
    });
    for (const agent of program.agents) {
      this.agents.set(agent.name, agent);
    }
    this.agent = this.resolveAgent(options.agentName);
    this.currentAgent = this.agent;
    this.entryFunction = options.functionName ?? this.resolveMainFunction(this.agent).name;

    this.registerImports(program);
  }

  private registerImports(program: Program): void {
    for (const imported of program.imports) {
      switch (imported.resourceKind) {
        case "tool":
          this.imports.push({
            name: imported.name,
            kind: "tool",
            value: { __agentScriptResource: "tool", name: imported.name, uri: imported.uri },
          });
          break;
        case "llm":
          this.imports.push({
            name: imported.name,
            kind: "llm",
            value: { __agentScriptResource: "llm", name: imported.name, uri: imported.uri },
          });
          break;
        case "file":
          this.imports.push({
            name: imported.name,
            kind: "file",
            value: this.loadImportedFile(imported.uri),
          });
          break;
        case "memory":
          this.imports.push({
            name: imported.name,
            kind: "memory",
            value: { __agentScriptResource: "memory", name: imported.name, uri: imported.uri },
          });
          break;
      }
    }
  }

  private loadImportedFile(uri: string): RuntimeValue {
    const path = this.resolveImportPath(uri);
    const content = readFileSync(path, "utf8");
    if (extname(path).toLowerCase() === ".json") {
      return JSON.parse(content) as RuntimeValue;
    }
    return content;
  }

  private resolveImportPath(uri: string): string {
    if (uri.startsWith("file://")) {
      return new URL(uri).pathname;
    }
    if (isAbsolute(uri)) {
      return uri;
    }
    return resolve(this.programSourceDir(), uri);
  }

  private programSourceDir(): string {
    return this.options.sourcePath ? dirname(resolve(this.options.sourcePath)) : process.cwd();
  }

  async execute(input: RuntimeValue): Promise<RuntimeValue> {
    try {
      const entry = this.findFunction(this.agent, this.entryFunction);
      if (!entry) {
        throw new RuntimeError(`Unknown function '${this.entryFunction}'`);
      }
      const args =
        entry.params.length === 0 ? [] : [await prepareEntryInput(input, entry, this.inputProvider, this.trace)];
      return await this.callFunction(this.agent, entry.name, args, entry.range);
    } finally {
      await closeIfDisposable(this.toolProvider);
    }
  }

  private resolveAgent(agentName?: string): AgentDecl {
    if (agentName) {
      const agent = this.program.agents.find((item) => item.name === agentName);
      if (!agent) throw new RuntimeError(`Unknown agent '${agentName}'`);
      return agent;
    }
    const main = this.program.agents.find((item) => item.isMain);
    if (main) return main;
    if (this.program.agents.length !== 1) {
      throw new RuntimeError("main agent is required when a program contains multiple agents");
    }
    return this.program.agents[0]!;
  }

  private resolveMainFunction(agent: AgentDecl): FuncDecl {
    const main = agent.functions.find((fn) => fn.isMain);
    if (main) return main;
    throw new RuntimeError(`Agent '${agent.name}' has no main func`);
  }

  private async callFunction(
    agent: AgentDecl,
    name: string,
    args: RuntimeValue[],
    range?: CallExpr["range"],
  ): Promise<RuntimeValue> {
    const fn = this.findFunction(agent, name);
    if (!fn) {
      throw new RuntimeError(`Unknown function '${agent.name}.${name}'`, range);
    }
    if (args.length !== fn.params.length) {
      throw new RuntimeError(
        `Function '${agent.name}.${name}' expects ${fn.params.length} argument(s), got ${args.length}`,
        fn.range,
      );
    }
    if (this.callDepth >= MAX_CALL_DEPTH) {
      throw new RuntimeError(`Maximum call depth of ${MAX_CALL_DEPTH} exceeded`, range ?? fn.range);
    }

    const previousAgent = this.currentAgent;
    this.currentAgent = agent;
    this.callDepth += 1;
    const scope = await this.buildFunctionScope(agent, fn, args);

    try {
      const signal = await this.executeBlock(fn.body, scope, true);
      return signal?.value ?? null;
    } finally {
      this.callDepth -= 1;
      this.currentAgent = previousAgent;
    }
  }

  private async buildFunctionScope(agent: AgentDecl, fn: FuncDecl, args: RuntimeValue[]): Promise<RuntimeScope> {
    const scope = new RuntimeScope();

    for (const agentName of this.agents.keys()) {
      scope.define(agentName, { __agentScriptResource: "agent", name: agentName }, "agent");
    }
    for (const binding of this.imports) {
      scope.define(binding.name, binding.value, binding.kind);
    }
    for (const func of agent.functions) {
      scope.define(
        func.name,
        { __agentScriptResource: "function", agentName: agent.name, name: func.name },
        "function",
      );
    }
    for (const config of agent.config) {
      const configValue = await this.evaluator.evaluateConfig(config, scope);
      scope.setConfig(config.key, configValue);
    }
    for (const [index, param] of fn.params.entries()) {
      scope.define(param.name, args[index] ?? null, "param");
    }

    return scope;
  }

  private findFunction(agent: AgentDecl, name: string): FuncDecl | undefined {
    return agent.functions.find((fn) => fn.name === name);
  }

  private async executeBlock(
    statements: Stmt[],
    scope: RuntimeScope,
    allowFinalExpressionReturn = false,
  ): Promise<StatementResult> {
    for (const [index, stmt] of statements.entries()) {
      if (allowFinalExpressionReturn && index === statements.length - 1 && stmt.kind === "ExprStmt") {
        return { kind: "return", value: await this.evaluator.evaluate(stmt.expr, scope) };
      }
      const result = await this.executeStatement(stmt, scope);
      if (result) return result;
    }
    return undefined;
  }

  private async evaluateBlockFinalValue(statements: Stmt[], scope: RuntimeScope): Promise<RuntimeValue> {
    const signal = await this.executeBlock(statements, scope, true);
    if (!signal) {
      throw new RuntimeError("parallel for body must end with a value expression");
    }
    return signal.value;
  }

  private async executeStatement(stmt: Stmt, scope: RuntimeScope): Promise<StatementResult> {
    switch (stmt.kind) {
      case "ConfigDecl":
        scope.setConfig(stmt.key, await this.evaluator.evaluateConfig(stmt, scope));
        return undefined;

      case "UseStmt": {
        const source = formatExpressionSource(stmt.value);
        scope.addUse(stmt.value, source, stmt.budget, stmt.label);
        this.trace.push({
          kind: "use",
          data: { source, label: stmt.label ?? null, budget: budgetToJson(stmt.budget) },
        });
        return undefined;
      }

      case "AssignStmt": {
        const value = await this.evaluator.evaluateAssignmentValue(stmt, scope);
        if (stmt.target.kind === "IdentifierExpr") {
          scope.set(stmt.target.name, value);
          return undefined;
        }
        if (stmt.target.kind === "MemberExpr") {
          const object = await this.evaluator.evaluate(stmt.target.object, scope);
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
        await this.evaluator.evaluate(stmt.expr, scope);
        return undefined;

      case "IfStmt": {
        if (isTruthy(await this.evaluator.evaluate(stmt.condition, scope))) {
          return this.executeBlock(stmt.thenBody, scope.child());
        }
        if (stmt.elseBody) {
          return this.executeBlock(stmt.elseBody, scope.child());
        }
        return undefined;
      }

      case "ForInStmt": {
        const iterable = await this.evaluator.evaluate(stmt.iterable, scope);
        if (!Array.isArray(iterable)) {
          throw new RuntimeError("for loop requires a list value", stmt.iterable.range);
        }

        const iterations = Math.min(stmt.maxIterations, iterable.length);
        for (let index = 0; index < iterations; index += 1) {
          const item = iterable[index]!;
          this.trace.push({
            kind: "for",
            data: { item: stmt.itemName, index, value: sanitizeForJson(item) },
          });
          const child = scope.child();
          child.define(stmt.itemName, item);
          const result = await this.executeBlock(stmt.body, child);
          if (result) return result;
        }
        return undefined;
      }

      case "LoopUntilStmt": {
        for (let index = 0; index < stmt.maxIterations; index += 1) {
          if (isTruthy(await this.evaluator.evaluate(stmt.condition, scope))) {
            return undefined;
          }
          const result = await this.executeBlock(stmt.body, scope.child());
          if (result) return result;
        }
        return undefined;
      }

      case "RepeatStmt": {
        for (let index = 0; index < stmt.maxAttempts; index += 1) {
          const result = await this.executeBlock(stmt.body, scope.child());
          if (result) return result;
        }
        return undefined;
      }

      case "ReturnStmt":
        return { kind: "return", value: await this.evaluator.evaluate(stmt.value, scope) };
      default:
        assertNever(stmt);
    }
  }

  private async callAgent(
    agentName: string,
    functionName: string,
    args: RuntimeValue[],
    range: CallExpr["range"],
  ): Promise<RuntimeValue> {
    const traceStart = this.trace.length;
    const result = await this.callFunction(this.requireAgent(agentName, range), functionName, args, range);
    const childTrace = this.trace.splice(traceStart) as TraceEvent[];
    this.trace.push({
      kind: "agent",
      data: {
        agent: agentName,
        function: functionName,
        args: sanitizeForJson(args),
        result: sanitizeForJson(result),
        trace: childTrace.map((event) => sanitizeForJson(event)),
      },
    });
    return result;
  }

  private requireAgent(name: string, range?: CallExpr["range"]): AgentDecl {
    const agent = this.agents.get(name);
    if (!agent) throw new RuntimeError(`Unknown agent '${name}'`, range);
    return agent;
  }
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
