import type { AgentDecl, Program } from "../ast/types.js";

function findMainAgent(program: Program): Program["agents"][number] | undefined {
  return program.agents.find((agent) => agent.isMain);
}

export function defaultEntryAgent(program: Program): AgentDecl | undefined {
  return findMainAgent(program) ?? (program.agents.length === 1 ? program.agents[0] : undefined);
}

export function findMainFunction(agent: AgentDecl): AgentDecl["functions"][number] | undefined {
  return agent.functions.find((fn) => fn.isMain);
}
