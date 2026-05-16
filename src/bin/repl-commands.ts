import { createInterface } from "node:readline/promises";
import { executeAgent } from "../runtime/interpreter.js";
import { loadNpmRegistry } from "../language/npm-registry.js";
import { sanitizeForJson } from "../runtime/json.js";
import { formatTrace } from "../runtime/trace.js";
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
  type ReplSession,
  setMainAgent,
} from "./repl-session.js";

type ReplReader = ReturnType<typeof createInterface>;

export async function handleCommand(commandLine: string, session: ReplSession, reader: ReplReader): Promise<boolean> {
  const [command, ...rest] = commandLine.slice(1).trim().split(/\s+/);
  const args = rest.join(" ");

  switch (command) {
    case "help":
      printHelp();
      return true;
    case "exit":
    case "quit":
      return false;
    case "import":
      addImport(session, args);
      return true;
    case "load":
      loadFile(session, args);
      return true;
    case "agents":
      printAgents(session);
      return true;
    case "main":
      setMainAgent(session, args);
      return true;
    case "show":
      console.log(buildProgramSource(session));
      return true;
    case "parse":
      console.log(JSON.stringify(loadSessionProgram(session), null, 2));
      return true;
    case "check":
      checkSession(session);
      return true;
    case "run":
      await runSession(session, args, reader);
      return true;
    case "trace":
      if (args.length === 0) {
        console.log(formatTrace(session.lastTrace));
      } else {
        console.error("Usage: :trace");
      }
      return true;
    case "reset":
      resetSession(session);
      return true;
    default:
      console.error(`Unknown command ':${command}'. Use :help.`);
      return true;
  }
}

function checkSession(session: ReplSession): boolean {
  const program = loadSessionProgram(session);
  const result = analyze(program, cliAnalyzeOptions());
  if (result.diagnostics.length > 0) {
    console.error(formatSemanticDiagnostics(result.diagnostics));
  } else {
    console.log("ok");
  }
  return !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

async function runSession(session: ReplSession, inputJson: string, reader: ReplReader): Promise<void> {
  const program = loadSessionProgram(session);
  assertSemanticallyValid(program, cliAnalyzeOptions());
  const input = inputJson.trim().length > 0 ? parseJsonObjectInput(inputJson, ":run input") : {};
  const result = await executeAgent(program, input, {
    inputProvider: createReadlineInputProvider(reader),
    sourcePath: session.sourcePath,
  });
  session.lastTrace = result.trace;
  console.log(JSON.stringify({ value: sanitizeForJson(result.value), trace: result.trace }, null, 2));
}

function printHelp(): void {
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
  console.log(`Commands:\n${lines.join("\n")}`);
}

function cliAnalyzeOptions() {
  return { npmRegistry: loadNpmRegistry(process.cwd()) };
}
