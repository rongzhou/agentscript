#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as inputStream, stdout as outputStream } from "node:process";
import { createInterface } from "node:readline/promises";
import type { Program } from "../ast/types.js";
import { executeAgent } from "../runtime/interpreter.js";
import { loadProgram } from "../runtime/loader.js";
import { ProtocolLlmProvider } from "../providers/llm/protocol.js";
import { MockLlmProvider } from "../providers/mock/llm.js";
import { MockMemoryProvider } from "../providers/mock/memory.js";
import { MockToolProvider } from "../providers/mock/tool.js";
import { sanitizeForJson } from "../runtime/json.js";
import { formatTrace } from "../runtime/trace.js";
import type { InputProvider, JsonObject, LlmProvider, MemoryProvider, ToolProvider } from "../runtime/types.js";
import type { GenerateRequest, RuntimeValue } from "../runtime/types.js";
import { formatSemanticDiagnostics } from "../semantic/diagnostics.js";
import { createDryRunToolProvider } from "../providers/dry-run/tool.js";
import { createDefaultToolProvider } from "../providers/tools/host.js";
import { RuntimeError } from "../runtime/errors.js";
import { parseArgs, printUsage, type CliOptions } from "./args.js";
import { createReadlineInputProvider, parseJsonObjectInput } from "./input.js";
import { runRepl } from "./repl.js";
import { analyzeCliProgram, assertCliProgramSemanticallyValid } from "./semantic.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    if (argv.length === 0) {
      return runRepl();
    }
    const options = parseArgs(argv);
    if (options.help) {
      printUsage(console.log);
      return 0;
    }
    if (options.version) {
      console.log(readPackageVersion());
      return 0;
    }
    if (!options.file) {
      printUsage(console.error);
      return 1;
    }

    if (options.parse && options.check) {
      throw new Error("Use either --parse or --check, not both");
    }
    if (options.dryRun && options.mock) {
      throw new Error("Use either --dry-run or --mock, not both");
    }
    if (options.parse) {
      return runParse(options);
    }
    if (options.check) {
      return runCheck(options);
    }
    if (options.targetFile) {
      return await runOptimizer(options);
    }
    return await runAgent(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function runOptimizer(options: CliOptions): Promise<number> {
  const inputProvider = terminalInputProvider();
  const program = loadCliProgram(options);
  assertCliProgramSemanticallyValid(program);
  const runDir =
    options.runDir ??
    join(process.cwd(), ".agentscript", "optimizations", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(runDir, { recursive: true });
  const budget = createBudgetCounter({
    maxTrials: options.maxTrials ?? 1000,
    maxLlmCalls: options.maxLlmCalls ?? 10000,
    maxSeconds: options.maxSeconds ?? 1800,
  });
  const llmProvider = new BudgetedLlmProvider(createCliLlmProvider(options), budget);
  const memoryProvider = createCliMemoryProvider(options);
  const input = {
    ...options.optimizerArgs,
    target: options.targetFile!,
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
    agentscript: {
      budget,
      memoryProvider,
      toolProvider: options.mock ? new MockToolProvider() : undefined,
    },
  }).finally(() => inputProvider?.close?.());

  const trace = optimizerTrace(result.trace, options.traceLevel);
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

function optimizerTrace(trace: unknown[], level: CliOptions["traceLevel"]): unknown[] {
  return level === "none" ? [] : trace;
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

function runParse(options: CliOptions): number {
  printJson(loadCliProgram(options));
  return 0;
}

function runCheck(options: CliOptions): number {
  const result = analyzeCliProgram(loadCliProgram(options));
  if (result.diagnostics.length > 0) {
    console.error(formatSemanticDiagnostics(result.diagnostics));
  }
  return result.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0;
}

async function runAgent(options: CliOptions): Promise<number> {
  const input = readInput(options);
  const inputProvider = terminalInputProvider();
  const program = loadCliProgram(options);
  assertCliProgramSemanticallyValid(program);
  const result = await executeAgent(program, input, {
    agentName: options.agentName,
    concurrency: options.concurrency,
    functionName: options.functionName,
    inputProvider,
    llmProvider: createCliLlmProvider(options),
    memoryProvider: createCliMemoryProvider(options),
    sourcePath: options.file,
    toolProvider: createCliToolProvider(options),
  }).finally(() => inputProvider?.close?.());

  if (options.traceFile) {
    writeFileSync(options.traceFile, `${JSON.stringify(result.trace, null, 2)}\n`);
  }

  const value = sanitizeForJson(result.value);
  if (options.quiet) {
    printJson(value);
  } else {
    printJson({ value, trace: options.traceFile ? { file: options.traceFile } : result.trace });
  }
  if (options.tracePretty || options.verbose) {
    console.log(formatTrace(result.trace));
  }
  return 0;
}

function createCliLlmProvider(options: CliOptions): LlmProvider {
  if (options.dryRun || options.mock) {
    return new MockLlmProvider();
  }
  return new ProtocolLlmProvider();
}

function createCliToolProvider(options: CliOptions): ToolProvider {
  if (options.mock) {
    return new MockToolProvider();
  }
  return options.dryRun ? createDryRunToolProvider(process.cwd()) : createDefaultToolProvider(process.cwd());
}

function createCliMemoryProvider(options: CliOptions): MemoryProvider | undefined {
  return options.mock ? new MockMemoryProvider() : undefined;
}

function loadCliProgram(options: CliOptions): Program {
  if (!options.file) {
    throw new Error("Missing AgentScript file");
  }
  return loadProgram(options.file);
}

function readInput(options: CliOptions): JsonObject {
  if (options.input && options.inputFile) {
    throw new Error("Use either --input or --input-file, not both");
  }
  if (options.inputFile) {
    return parseJsonObjectInput(readFileSync(options.inputFile, "utf8"), "--input-file");
  }
  if (options.input) {
    return parseJsonObjectInput(options.input, "--input");
  }
  return {};
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

function readPackageVersion(): string {
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), "../../package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
  return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const ENTRYPOINT_NAMES = new Set(["agentscript", "agentscript.js", "agentscript.ts"]);
const isEntrypoint = process.argv[1] ? ENTRYPOINT_NAMES.has(basename(process.argv[1])) : false;
if (isEntrypoint) {
  process.exitCode = await main();
}
