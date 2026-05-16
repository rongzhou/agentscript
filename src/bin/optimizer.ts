import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MockLlmProvider } from "../providers/mock/llm.js";
import { MockMemoryProvider } from "../providers/mock/memory.js";
import { MockToolProvider } from "../providers/mock/tool.js";
import { ProtocolLlmProvider } from "../providers/llm/protocol.js";
import { loadNpmRegistry } from "../language/npm-registry.js";
import { RuntimeError } from "../runtime/core/errors.js";
import { executeAgent } from "../runtime/core/interpreter.js";
import { sanitizeForJson } from "../runtime/values/json.js";
import { loadProgram } from "../runtime/program/loader.js";
import { formatTrace } from "../runtime/trace/trace.js";
import type { JsonObject, RuntimeValue } from "../runtime/values/values.js";
import type { GenerateRequest, LlmProvider } from "../runtime/values/providers.js";
import type { BudgetCounter } from "../optimizer/context.js";
import { assertSemanticallyValid } from "../semantic/analyzer.js";
import type { CliOptions } from "./args.js";
import { createTerminalInputProvider, printJson } from "./input.js";

export async function runOptimizer(options: CliOptions): Promise<number> {
  if (!options.optimizer) throw new Error("Optimizer target is required");
  const inputProvider = createTerminalInputProvider();
  const program = loadProgram(options.file!);
  assertSemanticallyValid(program, { npmRegistry: loadNpmRegistry(process.cwd()) });
  const runDir =
    options.runDir ??
    join(process.cwd(), ".agentscript", "optimizations", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(runDir, { recursive: true });
  const budget = createBudgetCounter({
    maxTrials: options.maxTrials ?? 1000,
    maxLlmCalls: options.maxLlmCalls ?? 10000,
    maxSeconds: options.maxSeconds ?? 1800,
  });
  const llmProvider = withBudget(createOptimizerLlmProvider(options), budget);
  const memoryProvider = options.mock ? new MockMemoryProvider() : undefined;
  const input = {
    ...options.optimizer.args,
    target: options.optimizer.targetFile,
    dry_run: options.dryRun,
  };
  const result = await executeAgent(program, input as JsonObject, {
    agentName: options.agentName,
    concurrency: options.concurrency,
    functionName: options.functionName,
    inputProvider,
    llmProvider,
    memoryProvider,
    sourcePath: options.file,
    workspaceRoot: process.cwd(),
    optimizer: {
      artifactsDir: runDir,
      budget,
      trialToolProvider: options.mock ? new MockToolProvider() : undefined,
    },
  }).finally(() => inputProvider?.close?.());

  const trace = options.traceLevel === "none" ? [] : result.trace;
  if (options.traceFile) {
    writeFileSync(options.traceFile, `${JSON.stringify(trace, null, 2)}\n`);
  }

  const value = sanitizeForJson(result.value);
  if (options.quiet) {
    printJson(value);
  } else {
    printJson({ value, trace: options.traceFile ? { file: options.traceFile } : trace, run_dir: runDir });
  }
  if (options.tracePretty || options.verbose) {
    console.log(formatTrace(result.trace));
  }
  return 0;
}

interface BudgetOptions {
  maxTrials: number;
  maxLlmCalls: number;
  maxSeconds: number;
}

function createBudgetCounter(options: BudgetOptions): BudgetCounter {
  let trials = 0;
  let llmCalls = 0;
  const started = Date.now();
  return {
    incrementTrial() {
      trials += 1;
      if (options.maxTrials > 0 && trials > options.maxTrials) {
        throw new RuntimeError("BUDGET_EXCEEDED: trials");
      }
      this.checkDeadline();
    },
    incrementLlm() {
      llmCalls += 1;
      if (options.maxLlmCalls > 0 && llmCalls > options.maxLlmCalls) {
        throw new RuntimeError("BUDGET_EXCEEDED: llm_calls");
      }
      this.checkDeadline();
    },
    checkDeadline() {
      if (options.maxSeconds > 0 && Date.now() - started > options.maxSeconds * 1000) {
        throw new RuntimeError("BUDGET_EXCEEDED: seconds");
      }
    },
  };
}

function withBudget(inner: LlmProvider, budget: BudgetCounter): LlmProvider {
  return {
    async generate(request: GenerateRequest): Promise<RuntimeValue> {
      budget.incrementLlm();
      return inner.generate(request);
    },
    close: () => inner.close?.(),
  };
}

function createOptimizerLlmProvider(options: CliOptions): LlmProvider {
  return options.dryRun || options.mock ? new MockLlmProvider() : new ProtocolLlmProvider();
}
