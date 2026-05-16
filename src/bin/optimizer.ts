import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stdin as inputStream, stdout as outputStream } from "node:process";
import { createInterface } from "node:readline/promises";
import { MockLlmProvider } from "../providers/mock/llm.js";
import { MockMemoryProvider } from "../providers/mock/memory.js";
import { MockToolProvider } from "../providers/mock/tool.js";
import { ProtocolLlmProvider } from "../providers/llm/protocol.js";
import { loadNpmRegistry } from "../language/npm-registry.js";
import { RuntimeError } from "../runtime/errors.js";
import { executeAgent } from "../runtime/interpreter.js";
import { sanitizeForJson } from "../runtime/json.js";
import { loadProgram } from "../runtime/loader.js";
import { formatTrace } from "../runtime/trace.js";
import type { GenerateRequest, InputProvider, JsonObject, LlmProvider, RuntimeValue } from "../runtime/types.js";
import { assertSemanticallyValid } from "../semantic/analyzer.js";
import type { CliOptions } from "./args.js";
import { createReadlineInputProvider } from "./input.js";

export async function runOptimizer(options: CliOptions): Promise<number> {
  if (!options.optimizer) throw new Error("Optimizer target is required");
  const inputProvider = terminalInputProvider();
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
  const llmProvider = new BudgetedLlmProvider(createOptimizerLlmProvider(options), budget);
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
    artifactsDir: runDir,
    optimizer: {
      budget,
      memoryProvider,
      toolProvider: options.mock ? new MockToolProvider() : undefined,
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

function createBudgetCounter(options: BudgetOptions) {
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

class BudgetedLlmProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly budget: ReturnType<typeof createBudgetCounter>,
  ) {}

  async generate(request: GenerateRequest): Promise<RuntimeValue> {
    this.budget.incrementLlm();
    return this.inner.generate(request);
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}

function createOptimizerLlmProvider(options: CliOptions): LlmProvider {
  return options.dryRun || options.mock ? new MockLlmProvider() : new ProtocolLlmProvider();
}

function terminalInputProvider(): (InputProvider & { close(): void }) | undefined {
  if (!inputStream.isTTY || !outputStream.isTTY) {
    return undefined;
  }
  const reader = createInterface({ input: inputStream, output: outputStream });
  return {
    ...createReadlineInputProvider(reader),
    close: () => reader.close(),
  };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
