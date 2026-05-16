#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as inputStream, stdout as outputStream } from "node:process";
import { createInterface } from "node:readline/promises";
import type { Program } from "../ast/types.js";
import { loadNpmRegistry } from "../language/npm-registry.js";
import { executeAgent } from "../runtime/core/interpreter.js";
import { loadProgram } from "../runtime/program/loader.js";
import { ProtocolLlmProvider } from "../providers/llm/protocol.js";
import { MockLlmProvider } from "../providers/mock/llm.js";
import { MockMemoryProvider } from "../providers/mock/memory.js";
import { HostPassthroughToolProvider } from "../providers/mock/host-passthrough.js";
import { sanitizeForJson } from "../runtime/values/json.js";
import { formatTrace } from "../runtime/trace/trace.js";
import type { JsonObject } from "../runtime/values/values.js";
import type { InputProvider, LlmProvider, MemoryProvider, ToolProvider } from "../runtime/values/providers.js";
import { analyze, assertSemanticallyValid } from "../semantic/analyzer.js";
import { formatSemanticDiagnostics } from "../semantic/diagnostics.js";
import { createDryRunToolProvider } from "../providers/dry-run/tool.js";
import { createAgentScriptHostNamespaces, createAgentScriptToolProvider } from "../host-tools.js";
import { parseArgs, printUsage, type CliOptions } from "./args.js";
import { runArchitect } from "./architect.js";
import { createReadlineInputProvider, parseJsonObjectInput } from "./input.js";
import { runOptimizer } from "./optimizer.js";
import { runRepl } from "./repl.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    if (argv.length === 0) {
      return runRepl();
    }
    const options = parseArgs(argv);
    if (options.command === "architect") {
      return await runArchitect(options.architect!);
    }
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
    if (options.optimizer) {
      return await runOptimizer(options);
    }
    return await runAgent(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function runParse(options: CliOptions): number {
  printJson(loadCliProgram(options));
  return 0;
}

function runCheck(options: CliOptions): number {
  const result = analyze(loadCliProgram(options), cliAnalyzeOptions());
  if (result.diagnostics.length > 0) {
    console.error(formatSemanticDiagnostics(result.diagnostics));
  }
  return result.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0;
}

async function runAgent(options: CliOptions): Promise<number> {
  const input = readInput(options);
  const inputProvider = terminalInputProvider();
  const program = loadCliProgram(options);
  assertSemanticallyValid(program, cliAnalyzeOptions());
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
    return new HostPassthroughToolProvider(createAgentScriptToolProvider(process.cwd()));
  }
  return options.dryRun
    ? createDryRunToolProvider(
        process.cwd(),
        createAgentScriptHostNamespaces({
          workspaceRoot: process.cwd(),
        }),
      )
    : createAgentScriptToolProvider(process.cwd());
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

function cliAnalyzeOptions() {
  return { npmRegistry: loadNpmRegistry(process.cwd()) };
}

const ENTRYPOINT_NAMES = new Set(["agentscript", "agentscript.js", "agentscript.ts"]);
const isEntrypoint = process.argv[1] ? ENTRYPOINT_NAMES.has(basename(process.argv[1])) : false;
if (isEntrypoint) {
  process.exitCode = await main();
}
