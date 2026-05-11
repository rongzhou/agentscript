import { readFileSync } from "node:fs";
import { parse } from "../parser/parser.js";
import { loadProgramSource } from "../runtime/loader.js";
import type { TraceEvent } from "../runtime/types.js";

const MAIN_AGENT_PATTERN = /^\s*main\s+agent\b/;
const AGENT_PATTERN = /^\s*(?:main\s+)?agent\b/;

export interface ReplSession {
  agentSources: Map<string, string>;
  importSources: string[];
  lastTrace: TraceEvent[];
  sourcePath?: string;
}

export function createReplSession(): ReplSession {
  return {
    agentSources: new Map(),
    importSources: [],
    lastTrace: [],
    sourcePath: undefined,
  };
}

export function addImport(session: ReplSession, source: string): void {
  const line = source.trim().startsWith("import ") ? source.trim() : `import ${source.trim()}`;
  parse(`${line}\nmain agent { main func(input {}) { return input } }`);
  session.importSources = [...session.importSources.filter((item) => item !== line), line];
  console.log("imported");
}

export function loadFile(session: ReplSession, file: string): void {
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
      demoteAllMainAgents(session);
    }
    session.agentSources.set(agent.name, agentSources[index]!);
  }
  console.log(`loaded ${program.agents.length} agent(s)`);
}

export function addAgentSource(session: ReplSession, source: string): void {
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
    demoteAllMainAgents(session);
  }
  const replaced = session.agentSources.has(agent.name);
  session.agentSources.set(agent.name, source);
  console.log(`${replaced ? "replaced" : "added"} agent ${agent.name}`);
}

export function setMainAgent(session: ReplSession, name: string): void {
  if (!name) {
    console.error("Usage: :main <AgentName>");
    return;
  }
  const source = session.agentSources.get(name);
  if (!source) {
    console.error(`Unknown agent '${name}'`);
    return;
  }
  demoteAllMainAgents(session);
  session.agentSources.set(name, source.replace(/^\s*agent\b/, "main agent"));
  console.log(`main agent ${name}`);
}

export function resetSession(session: ReplSession): void {
  session.agentSources.clear();
  session.importSources = [];
  session.lastTrace = [];
  session.sourcePath = undefined;
  console.log("reset");
}

export function printAgents(session: ReplSession): void {
  if (session.agentSources.size === 0) {
    console.log("(no agents)");
    return;
  }
  for (const [name, source] of session.agentSources) {
    const marker = MAIN_AGENT_PATTERN.test(source) ? "*" : " ";
    console.log(`${marker} ${name}`);
  }
}

export function buildProgramSource(session: ReplSession): string {
  return [...session.importSources, ...session.agentSources.values()].join("\n\n");
}

export function loadSessionProgram(session: ReplSession) {
  return loadProgramSource(buildProgramSource(session), { sourcePath: session.sourcePath });
}

function demoteAllMainAgents(session: ReplSession): void {
  for (const [name, source] of session.agentSources) {
    session.agentSources.set(name, source.replace(MAIN_AGENT_PATTERN, "agent"));
  }
}

function extractAgentSources(source: string): string[] {
  const starts = [...source.matchAll(/^\s*(?:main\s+)?agent\b/gm)].map((match) => match.index ?? 0);
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? source.length;
    return source.slice(start, end).trim();
  });
}
