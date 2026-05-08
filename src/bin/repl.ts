import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as inputStream, stdout as outputStream } from "node:process";
import { parse } from "../parser/parser.js";
import { executeAgent } from "../runtime/interpreter.js";
import { sanitizeForJson } from "../runtime/json.js";
import { loadProgramSource } from "../runtime/loader.js";
import { ProtocolLlmProvider } from "../providers/llm/index.js";
import { formatTrace } from "../runtime/trace.js";
import type { TraceEvent } from "../runtime/types.js";
import { analyze } from "../semantic/analyzer.js";
import { formatSemanticDiagnostics } from "../semantic/diagnostics.js";
import { parseInteractiveInputValue, parseJsonObjectInput } from "./input.js";

const MAIN_AGENT_PATTERN = /^\s*main\s+agent\b/;
const AGENT_PATTERN = /^\s*(?:main\s+)?agent\b/;

export interface ReplOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

interface ReplSession {
  agentSources: Map<string, string>;
  importSources: string[];
  lastTrace: TraceEvent[];
  realLlm: boolean;
  sourcePath?: string;
}

type ReplReader = ReturnType<typeof createInterface>;

export async function runRepl(options: ReplOptions = {}): Promise<number> {
  const reader = createInterface({
    input: options.input ?? inputStream,
    output: options.output ?? outputStream,
    terminal: isTty(options.input ?? inputStream)
  });
  const session: ReplSession = {
    agentSources: new Map(),
    importSources: [],
    lastTrace: [],
    realLlm: false,
    sourcePath: undefined
  };

  try {
    console.log("AgentScript REPL");
    console.log("Paste one complete agent or use :help.");

    let buffer: string[] = [];
    while (true) {
      const line = await reader.question(buffer.length === 0 ? "> " : ". ");
      const trimmed = line.trim();

      if (buffer.length === 0 && trimmed.startsWith(":")) {
        const shouldContinue = await handleCommand(trimmed, session, reader);
        if (!shouldContinue) {
          return 0;
        }
        continue;
      }

      if (buffer.length === 0 && trimmed.length === 0) {
        continue;
      }

      buffer.push(line);
      if (!isBalancedAgentBuffer(buffer)) {
        continue;
      }

      const source = buffer.join("\n").trim();
      buffer = [];
      if (source.length === 0) {
        continue;
      }
      addAgentSource(session, source);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "readline was closed") {
      return 0;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    reader.close();
  }
}

async function handleCommand(commandLine: string, session: ReplSession, reader: ReplReader): Promise<boolean> {
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
      if (args === "pretty") {
        console.log(formatTrace(session.lastTrace));
      } else {
        console.log(JSON.stringify(session.lastTrace, null, 2));
      }
      return true;
    case "real-llm":
      setRealLlm(session, args);
      return true;
    case "reset":
      session.agentSources.clear();
      session.importSources = [];
      session.lastTrace = [];
      session.sourcePath = undefined;
      console.log("reset");
      return true;
    default:
      console.error(`Unknown command ':${command}'. Use :help.`);
      return true;
  }
}

function addImport(session: ReplSession, source: string): void {
  const line = source.trim().startsWith("import ") ? source.trim() : `import ${source.trim()}`;
  parse(`${line}\nmain agent { main func(input {}) { return input } }`);
  session.importSources = [...session.importSources.filter((item) => item !== line), line];
  console.log("imported");
}

function loadFile(session: ReplSession, file: string): void {
  if (!file) {
    console.error("Usage: :load <file.as>");
    return;
  }

  const source = readFileSync(file, "utf8");
  session.sourcePath = file;
  const program = parse(source);
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("import ")) {
      session.importSources = [...session.importSources.filter((item) => item !== trimmed), trimmed];
    }
  }

  const agentSources = extractAgentSources(source);
  if (agentSources.length !== program.agents.length) {
    throw new Error("Could not split loaded file into agent declarations");
  }
  for (const [index, agent] of program.agents.entries()) {
    if (agent.isMain) {
      for (const [name, existingSource] of session.agentSources) {
        session.agentSources.set(name, existingSource.replace(MAIN_AGENT_PATTERN, "agent"));
      }
    }
    session.agentSources.set(agent.name, agentSources[index]!);
  }
  console.log(`loaded ${program.agents.length} agent(s)`);
}

function addAgentSource(session: ReplSession, source: string): void {
  if (!AGENT_PATTERN.test(source)) {
    console.error("REPL accepts one complete agent declaration at a time.");
    return;
  }

  const previousImports = session.importSources.join("\n");
  const programSource = [previousImports, source].filter(Boolean).join("\n\n");
  const program = parse(programSource);
  const agent = program.agents[program.agents.length - 1];
  if (!agent) {
    console.error("No agent found.");
    return;
  }

  if (agent.isMain) {
    for (const [name, existingSource] of session.agentSources) {
      session.agentSources.set(name, existingSource.replace(MAIN_AGENT_PATTERN, "agent"));
    }
  }
  const replaced = session.agentSources.has(agent.name);
  session.agentSources.set(agent.name, source);
  console.log(`${replaced ? "replaced" : "added"} agent ${agent.name}`);
}

function setMainAgent(session: ReplSession, name: string): void {
  if (!name) {
    console.error("Usage: :main <AgentName>");
    return;
  }
  const source = session.agentSources.get(name);
  if (!source) {
    console.error(`Unknown agent '${name}'`);
    return;
  }
  for (const [agentName, agentSource] of session.agentSources) {
    session.agentSources.set(agentName, agentSource.replace(MAIN_AGENT_PATTERN, "agent"));
  }
  session.agentSources.set(name, source.replace(/^\s*agent\b/, "main agent"));
  console.log(`main agent ${name}`);
}

function checkSession(session: ReplSession): boolean {
  const program = loadSessionProgram(session);
  const result = analyze(program);
  if (result.diagnostics.length > 0) {
    console.error(formatSemanticDiagnostics(result.diagnostics));
  } else {
    console.log("ok");
  }
  return !result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

async function runSession(session: ReplSession, inputJson: string, reader: ReplReader): Promise<void> {
  const program = loadSessionProgram(session);
  const input = inputJson.trim().length > 0 ? parseJsonObjectInput(inputJson, ":run input") : {};
  const result = await executeAgent(program, input, {
    inputProvider: {
      async read(request) {
        const answer = await reader.question(`${request.path.join(".")}: `);
        return parseInteractiveInputValue(answer);
      }
    },
    llmProvider: session.realLlm ? new ProtocolLlmProvider() : undefined,
    sourcePath: session.sourcePath
  });
  session.lastTrace = result.trace;
  console.log(JSON.stringify({ value: sanitizeForJson(result.value), trace: result.trace }, null, 2));
}

function setRealLlm(session: ReplSession, value: string): void {
  if (value !== "on" && value !== "off") {
    console.error("Usage: :real-llm on|off");
    return;
  }
  session.realLlm = value === "on";
  console.log(`real-llm ${value}`);
}

function printAgents(session: ReplSession): void {
  if (session.agentSources.size === 0) {
    console.log("(no agents)");
    return;
  }
  for (const [name, source] of session.agentSources) {
    const marker = MAIN_AGENT_PATTERN.test(source) ? "*" : " ";
    console.log(`${marker} ${name}`);
  }
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
    ":trace [pretty]",
    ":real-llm on|off",
    ":reset",
    ":exit"
  ];
  console.log(`Commands:\n${lines.join("\n")}`);
}

function buildProgramSource(session: ReplSession): string {
  return [...session.importSources, ...session.agentSources.values()].join("\n\n");
}

function loadSessionProgram(session: ReplSession) {
  return loadProgramSource(buildProgramSource(session), { sourcePath: session.sourcePath });
}

function extractAgentSources(source: string): string[] {
  const starts = [...source.matchAll(/^\s*(?:main\s+)?agent\b/gm)].map((match) => match.index ?? 0);
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? source.length;
    return source.slice(start, end).trim();
  });
}

function isBalancedAgentBuffer(lines: string[]): boolean {
  let depth = 0;
  let sawAgent = false;
  for (const line of lines) {
    if (AGENT_PATTERN.test(line)) {
      sawAgent = true;
    }
    for (const char of line) {
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
    }
  }
  return sawAgent && depth === 0;
}

function isTty(stream: NodeJS.ReadableStream): boolean {
  return "isTTY" in stream && stream.isTTY === true;
}
