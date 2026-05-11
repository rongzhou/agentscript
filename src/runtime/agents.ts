import type { AgentDecl, FuncDecl, Program, SourceRange } from "../ast/types.js";
import { defaultEntryAgent, findMainFunction } from "../language/entry.js";
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
  const agent = defaultEntryAgent(program);
  if (!agent) {
    throw new RuntimeError("main agent is required when a program contains multiple agents");
  }
  return agent;
}

export function resolveMainFunction(agent: AgentDecl): FuncDecl {
  const main = findMainFunction(agent);
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
