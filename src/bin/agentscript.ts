#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin as inputStream, stdout as outputStream } from "node:process";
import { createInterface } from "node:readline/promises";
import { executeAgent } from "../runtime/interpreter.js";
import { loadProgram } from "../runtime/loader.js";
import { ProtocolLlmProvider } from "../providers/llm/index.js";
import { sanitizeForJson } from "../runtime/json.js";
import { formatTrace } from "../runtime/trace.js";
import type { InputProvider, InputRequest, JsonObject, RuntimeValue } from "../runtime/types.js";
import { analyze } from "../semantic/analyzer.js";
import { formatSemanticDiagnostics } from "../semantic/diagnostics.js";
import { parseInteractiveInputValue, parseJsonObjectInput } from "./input.js";
import { runRepl } from "./repl.js";
import type { Program } from "../ast/types.js";

interface CliOptions {
  agentName?: string;
  check: boolean;
  file?: string;
  functionName?: string;
  help: boolean;
  input?: string;
  inputFile?: string;
  parse: boolean;
  quiet: boolean;
  realLlm: boolean;
  traceFile?: string;
  tracePretty: boolean;
  verbose: boolean;
  version: boolean;
}

interface CliInputProvider extends InputProvider {
  close?(): void;
}

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
    if (options.parse) {
      return runParse(options);
    }
    if (options.check) {
      return runCheck(options);
    }
    return await runAgent(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    check: false,
    help: false,
    parse: false,
    quiet: false,
    realLlm: false,
    tracePretty: false,
    verbose: false,
    version: false
  };

  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case "--agent":
        options.agentName = readOptionValue(argv, ++index, arg);
        break;
      case "--function":
        options.functionName = readOptionValue(argv, ++index, arg);
        break;
      case "--input":
        options.input = readOptionValue(argv, ++index, arg);
        break;
      case "--input-file":
        options.inputFile = readOptionValue(argv, ++index, arg);
        break;
      case "--check":
        options.check = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--parse":
        options.parse = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--real-llm":
        options.realLlm = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
      case "--trace":
        {
          const value = readOptionValue(argv, ++index, arg);
          if (value === "pretty") {
            options.tracePretty = true;
          } else {
            options.traceFile = value;
          }
        }
        break;
      case "--verbose":
        options.verbose = true;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option '${arg}'`);
        }
        positional.push(arg);
    }
  }

  options.file = positional[0];
  if (positional.length > 1) {
    throw new Error("Unexpected positional argument. Use --input to pass input JSON.");
  }
  if (options.quiet && (options.verbose || options.tracePretty)) {
    throw new Error("Use either --quiet or verbose trace output, not both");
  }
  return options;
}

function readOptionValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`Expected value after ${option}`);
  }
  return value;
}

function runParse(options: CliOptions): number {
  printJson(loadCliProgram(options));
  return 0;
}

function runCheck(options: CliOptions): number {
  const result = analyze(loadCliProgram(options));
  if (result.diagnostics.length > 0) {
    console.error(formatSemanticDiagnostics(result.diagnostics));
  }
  return result.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0;
}

async function runAgent(options: CliOptions): Promise<number> {
  const input = readInput(options);
  const inputProvider = terminalInputProvider();
  const result = await executeAgent(loadCliProgram(options), input, {
    agentName: options.agentName,
    functionName: options.functionName,
    inputProvider,
    llmProvider: options.realLlm ? new ProtocolLlmProvider() : undefined,
    sourcePath: options.file,
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

function terminalInputProvider(): CliInputProvider | undefined {
  if (!inputStream.isTTY || !outputStream.isTTY) {
    return undefined;
  }
  return new TerminalInputProvider();
}

class TerminalInputProvider implements CliInputProvider {
  private interface?: ReturnType<typeof createInterface>;

  async read(request: InputRequest): Promise<RuntimeValue> {
    const answer = await this.reader().question(`${request.path.join(".")}: `);
    return parseInteractiveInputValue(answer);
  }

  private reader(): ReturnType<typeof createInterface> {
    this.interface ??= createInterface({ input: inputStream, output: outputStream });
    return this.interface;
  }

  close(): void {
    this.interface?.close();
  }
}

function printUsage(write: (message: string) => void): void {
  write([
    "Usage:",
    "  agentscript <file.as> --input '{\"question\":\"...\"}'",
    "  agentscript <file.as>",
    "  agentscript <file.as> --input-file input.json --agent AgentName",
    "  agentscript <file.as> --input '{}' --quiet",
    "  agentscript <file.as> --input '{}' --verbose",
    "  agentscript <file.as> --input '{}' --trace pretty",
    "  agentscript <file.as> --check",
    "  agentscript <file.as> --parse",
    "  agentscript",
  ].join("\n"));
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
