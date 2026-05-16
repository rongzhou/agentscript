export type AgentSpecDraft = Record<string, unknown>;

export function parseAgentSpecDraft(value: unknown): AgentSpecDraft | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as AgentSpecDraft) : null;
}
