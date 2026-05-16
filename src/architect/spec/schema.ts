export type AgentSpecDraft = Record<string, unknown>;

export function isAgentSpecDraft(value: unknown): value is AgentSpecDraft {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAgentSpecDraft(value: unknown): AgentSpecDraft | null {
  return isAgentSpecDraft(value) ? value : null;
}
