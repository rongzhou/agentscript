import type { AgentDecl, FuncDecl, Program, SourceRange } from "../ast/types.js";
import { RuntimeError } from "./errors.js";

export function createAgentMap(program: Program): Map<string, AgentDecl> {
  const agents = new Map<string, AgentDecl>();
  for (const agent of program.agents) {
    agents.set(agent.name, agent);
  }
  return agents;
}

export function resolveEntryAgent(program: Program, agentName?: string): AgentDecl {
  if (agentName) {
    const agent = program.agents.find((item) => item.name === agentName);
    if (!agent) throw new RuntimeError(`Unknown agent '${agentName}'`);
    return agent;
  }
  const main = program.agents.find((item) => item.isMain);
  if (main) return main;
  if (program.agents.length !== 1) {
    throw new RuntimeError("main agent is required when a program contains multiple agents");
  }
  return program.agents[0]!;
}

export function resolveMainFunction(agent: AgentDecl): FuncDecl {
  const main = agent.functions.find((fn) => fn.isMain);
  if (main) return main;
  throw new RuntimeError(`Agent '${agent.name}' has no main func`);
}

export function findFunction(agent: AgentDecl, name: string): FuncDecl | undefined {
  return agent.functions.find((fn) => fn.name === name);
}

export function requireAgent(agents: Map<string, AgentDecl>, name: string, range?: SourceRange): AgentDecl {
  const agent = agents.get(name);
  if (!agent) throw new RuntimeError(`Unknown agent '${name}'`, range);
  return agent;
}
