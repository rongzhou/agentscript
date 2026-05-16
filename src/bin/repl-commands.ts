import { createInterface } from "node:readline/promises";
import { executeAgent } from "../runtime/core/interpreter.js";
import { loadNpmRegistry } from "../language/npm-registry.js";
import { sanitizeForJson } from "../runtime/values/json.js";
import { formatTrace } from "../runtime/trace/trace.js";
import { analyze, assertSemanticallyValid } from "../semantic/analyzer.js";
import { formatSemanticDiagnostics } from "../semantic/diagnostics.js";
import { createReadlineInputProvider, parseJsonObjectInput } from "./input.js";
import {
  addImport,
  buildProgramSource,
  loadFile,
  loadSessionProgram,
  printAgents,
  resetSession,
  type ReplPrinter,
  type ReplSession,
  setMainAgent,
} from "./repl-session.js";

type ReplReader = ReturnType<typeof createInterface>;

export async function handleCommand(
  commandLine: string,
  session: ReplSession,
  reader: ReplReader,
  printer: ReplPrinter,
): Promise<boolean> {
  const [command, ...rest] = commandLine.slice(1).trim().split(/\s+/);
  const args = rest.join(" ");

  switch (command) {
    case "help":
      printHelp(printer);
      return true;
    case "exit":
    case "quit":
      return false;
    case "import":
      addImport(session, args, printer);
      return true;
    case "load":
      loadFile(session, args, printer);
      return true;
    case "agents":
      printAgents(session, printer);
      return true;
    case "main":
      setMainAgent(session, args, printer);
      return true;
    case "show":
      printer.log(buildProgramSource(session));
      return true;
    case "parse":
      printer.log(JSON.stringify(loadSessionProgram(session), null, 2));
      return true;
    case "check":
      checkSession(session, printer);
      return true;
    case "run":
      await runSession(session, args, reader, printer);
      return true;
    case "trace":
      if (args.length === 0) {
        printer.log(formatTrace(session.lastTrace));
      } else {
        printer.error("Usage: :trace");
      }
      return true;
    case "reset":
      resetSession(session, printer);
      return true;
    default:
      printer.error(`Unknown command ':${command}'. Use :help.`);
      return true;
  }
}

function checkSession(session: ReplSession, printer: ReplPrinter): boolean {
  const program = loadSessionProgram(session);
  const result = analyze(program, cliAnalyzeOptions());
  if (result.diagnostics.length > 0) {
    printer.error(formatSemanticDiagnostics(result.diagnostics));
  } else {
    printer.log("ok");
  }
  return !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

async function runSession(
  session: ReplSession,
  inputJson: string,
  reader: ReplReader,
  printer: ReplPrinter,
): Promise<void> {
  const program = loadSessionProgram(session);
  assertSemanticallyValid(program, cliAnalyzeOptions());
  const input = inputJson.trim().length > 0 ? parseJsonObjectInput(inputJson, ":run input") : {};
  const result = await executeAgent(program, input, {
    inputProvider: createReadlineInputProvider(reader),
    sourcePath: session.sourcePath,
    logger: { error: (message) => printer.error(message) },
  });
  session.lastTrace = result.trace;
  printer.log(JSON.stringify({ value: sanitizeForJson(result.value), trace: result.trace }, null, 2));
}

function printHelp(printer: ReplPrinter): void {
  const lines = [
    ":import <import statement>",
    ":load <file.as>",
    ":agents",
    ":main <AgentName>",
    ":show",
    ":check",
    ":parse",
    ":run [json]",
    ":trace",
    ":reset",
    ":exit",
  ];
  printer.log(`Commands:\n${lines.join("\n")}`);
}

function cliAnalyzeOptions() {
  return { npmRegistry: loadNpmRegistry(process.cwd()) };
}
