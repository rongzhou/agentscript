import type { AgentDecl, NodeBase } from "../ast/types.js";

const NODE_SOURCE_PATHS = new WeakMap<NodeBase, string>();

export function setNodeSourcePath(node: NodeBase, sourcePath: string): void {
  NODE_SOURCE_PATHS.set(node, sourcePath);
}

export function getNodeSourcePath(node: NodeBase): string | undefined {
  return NODE_SOURCE_PATHS.get(node);
}

export function setAgentSourcePath(agent: AgentDecl, sourcePath: string): void {
  setNodeSourcePath(agent, sourcePath);
}
