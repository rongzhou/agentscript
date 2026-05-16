import type { AgentDecl, CallExpr, FuncDecl, Program, UseOneOfStmt, UseStmt } from "../../ast/types.js";
import { formatExpressionSource } from "../../ast/format.js";
import { createAgentMap, findFunction, requireAgent, resolveEntryAgent, resolveMainFunction } from "./agents.js";
import { Evaluator } from "./evaluator.js";
import { RuntimeError } from "./errors.js";
import { GenerateRuntime } from "../generate/generate.js";
import { budgetToJson } from "../values/json.js";
import { prepareEntryInput } from "../contract/input.js";
import { createRuntimeImportBindings, type RuntimeImportBinding } from "../program/imports.js";
import { createRuntimePaths } from "../program/paths.js";
import { RuntimeScope } from "./scope.js";
import { collectVariantSites, type VariantSiteMetadata } from "../../language/variant-sites.js";
import { buildSiteId } from "../../language/site-id.js";
import { buildTraceEvent } from "../trace/trace.js";
import { evaluateBlockFinalValue, executeBlock, type StatementHost } from "./statements.js";
import { pickUseOneOfCandidate } from "../context/use-one-of.js";
import { createDefaultMemoryProvider } from "../../providers/memory/host.js";
import { MockLlmProvider } from "../../providers/mock/llm.js";
import { createAgentScriptToolProvider } from "../../providers/agent-script-tools.js";
import type { BudgetCounter } from "../../optimizer/context.js";
import type { RuntimeValue } from "../values/values.js";
import type { InputProvider, LlmProvider, MemoryProvider, ToolProvider } from "../values/providers.js";
import type { TraceEvent } from "../trace/trace.js";

export interface RuntimeLogger {
  error(message: string): void;
}

interface OptimizerHookOptions {
  artifactsDir?: string;
  budget?: BudgetCounter;
  trialLlmProvider?: LlmProvider;
  trialMemoryProvider?: MemoryProvider;
  trialToolProvider?: ToolProvider;
}

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
  variant?: Record<string, string>;
  closeProviders?: boolean;
  logger?: RuntimeLogger;
  optimizer?: OptimizerHookOptions;
}

export interface ExecuteResult {
  value: RuntimeValue;
  trace: TraceEvent[];
}

interface ExecutionContext {
  agentName: string;
  functionName?: string;
}
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
  private readonly variantSites: Map<UseOneOfStmt, VariantSiteMetadata>;
  private callDepth = 0;

  constructor(
    program: Program,
    private readonly options: ExecuteOptions,
  ) {
    const paths = createRuntimePaths(options);
    this.llmProvider = options.llmProvider ?? new MockLlmProvider();
    this.inputProvider = options.inputProvider;
    this.memoryProvider =
      options.memoryProvider ??
      createDefaultMemoryProvider({
        baseDir: paths.sourceDir,
        workspaceRoot: paths.workspaceRoot,
      });
    this.toolProvider =
      options.toolProvider ??
      createAgentScriptToolProvider(paths.workspaceRoot, {
        llmProvider: this.llmProvider,
        memoryProvider: this.memoryProvider,
        workspaceRoot: paths.workspaceRoot,
        artifactsDir: options.optimizer?.artifactsDir,
        budget: options.optimizer?.budget,
        ...(options.optimizer?.trialLlmProvider ? { llmProvider: options.optimizer.trialLlmProvider } : {}),
        ...(options.optimizer?.trialMemoryProvider ? { memoryProvider: options.optimizer.trialMemoryProvider } : {}),
        ...(options.optimizer?.trialToolProvider ? { toolProvider: options.optimizer.trialToolProvider } : {}),
      });
    this.agents = createAgentMap(program);
    this.agent = resolveEntryAgent(program, options.agentName);
    this.entryFunction = options.functionName ?? resolveMainFunction(this.agent).name;
    this.imports = createRuntimeImportBindings(program, paths.sourceDir);
    this.maxCallDepth = readMaxCallDepth(options.maxCallDepth);
    this.variantSites = new Map(
      collectVariantSites(program, {
        sourcePath: options.sourcePath,
        workspaceRoot: paths.workspaceRoot,
      }).map((site) => [site.node, site]),
    );
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
      if (this.options.closeProviders !== false) {
        for (const provider of [this.toolProvider, this.memoryProvider, this.llmProvider, this.inputProvider]) {
          try {
            await provider?.close?.();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.options.logger?.error(`AgentScript cleanup failed: ${message}`);
          }
        }
      }
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
    const evaluator = this.createEvaluator(trace, agent, fn);
    const scope = await this.buildFunctionScope(agent, fn, args, evaluator, trace);
    const context: ExecutionContext = { agentName: agent.name, functionName: fn.name };

    try {
      const signal = await executeBlock(fn.body, scope, evaluator, trace, this.statementHost(context), true);
      return signal?.value ?? null;
    } finally {
      this.callDepth -= 1;
    }
  }

  private createEvaluator(trace: TraceEvent[], activeAgent: AgentDecl, activeFunction?: FuncDecl): Evaluator {
    let evaluator: Evaluator;
    // GenerateRuntime delegates expression and context evaluation back to the Evaluator
    // that owns this execution scope, so these callbacks close over the evaluator
    // assigned immediately below.
    const generateRuntime = new GenerateRuntime(
      this.llmProvider,
      trace,
      {
        currentAgent: () => activeAgent,
        evaluate: (expr, scope) => evaluator.evaluate(expr, scope),
        resolveContextUses: (scope) => evaluator.resolveContextUses(scope),
      },
      this.options.logger,
    );
    evaluator = new Evaluator(
      this.toolProvider,
      this.memoryProvider,
      trace,
      generateRuntime,
      {
        callAgent: (agentName, functionName, args, range) =>
          this.callAgent(agentName, functionName, args, range, trace),
        callFunction: (agent, name, args, range) => this.callFunction(agent, name, args, range, trace),
        concurrency: () => this.options.concurrency ?? 4,
        evaluateBlockFinalValue: (statements, scope, blockOptions = {}) => {
          const blockTrace = blockOptions.trace ?? trace;
          const blockEvaluator = blockOptions.trace
            ? this.createEvaluator(blockTrace, activeAgent, activeFunction)
            : evaluator;
          return evaluateBlockFinalValue(
            statements,
            scope,
            blockEvaluator,
            blockTrace,
            this.statementHost({
              agentName: activeAgent.name,
              functionName: activeFunction?.name,
            }),
          );
        },
        requireAgent: (name, range) => this.requireAgent(name, range),
        resolveMainFunction,
      },
      this.options.variant,
    );
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
      this.declareUse(use, agentScope, trace, { agentName: agent.name });
    }

    const scope = agentScope.child();
    for (const [index, param] of fn.params.entries()) {
      scope.define(param.name, args[index] ?? null, "param");
    }

    return scope;
  }

  private statementHost(context: ExecutionContext): StatementHost {
    return {
      declareUse: (stmt, scope, trace) => this.declareUse(stmt, scope, trace, context),
    };
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

  private declareUse(
    stmt: UseStmt | UseOneOfStmt,
    scope: RuntimeScope,
    trace: TraceEvent[],
    context: ExecutionContext,
  ): void {
    if (stmt.kind === "UseOneOfStmt") {
      this.declareUseOneOf(stmt, scope, trace, context);
      return;
    }
    const source = formatExpressionSource(stmt.value);
    scope.addUse(stmt.value, source, stmt.budget, stmt.label);
    trace.push(buildTraceEvent("use", { source, label: stmt.label ?? null, budget: budgetToJson(stmt.budget) }));
  }

  private declareUseOneOf(
    stmt: UseOneOfStmt,
    scope: RuntimeScope,
    trace: TraceEvent[],
    context: ExecutionContext,
  ): void {
    const site = this.variantSites.get(stmt);
    const siteId = site?.siteId ?? this.useOneOfSiteId(stmt, context);
    const candidates = stmt.candidates.map((candidate) => ({
      name: candidate.name,
      expr: candidate.value,
      budget: candidate.budget,
      selected: candidate.selected,
      source: candidate.value ? formatExpressionSource(candidate.value) : undefined,
    }));
    const picked = pickUseOneOfCandidate(candidates, this.options.variant?.[siteId], siteId);
    scope.addUseOneOf(siteId, stmt.label, candidates);
    trace.push(
      buildTraceEvent("use", {
        source: picked.candidate.source ?? null,
        label: stmt.label,
        budget: budgetToJson(picked.candidate.budget),
        variant: {
          site_id: siteId,
          picked: picked.candidate.name,
          available: candidates.map((candidate) => candidate.name),
          reason: picked.reason,
          empty: !picked.candidate.expr,
        },
      }),
    );
  }

  private useOneOfSiteId(stmt: UseOneOfStmt, context: ExecutionContext): string {
    return buildSiteId({
      sourcePath: this.options.sourcePath,
      workspaceRoot: this.options.workspaceRoot,
      agentName: context.agentName,
      funcName: context.functionName,
      label: stmt.label,
      ordinal: 1,
    });
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
