import { readFileSync } from "node:fs";
import type { AgentSpecDraft } from "../../src/architect/spec/schema.js";
import { parseAgentSpecDraft } from "../../src/architect/spec/schema.js";

export const architectFixtures = [
  "fixtures/architect/docs-assistant.spec.json",
  "fixtures/architect/support-agent.spec.json",
  "fixtures/architect/react-research-agent.spec.json",
  "fixtures/architect/research-agent.spec.json",
];

export function readFixture(path: string): AgentSpecDraft {
  const parsed = parseAgentSpecDraft(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed) throw new Error(`Fixture ${path} is not an AgentSpec draft`);
  return parsed;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
