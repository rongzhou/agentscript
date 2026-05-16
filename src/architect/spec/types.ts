export type AgentSpecType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "list[string]"
  | "list[number]"
  | "list[boolean]"
  | "list[json]";

export const AGENT_SPEC_TYPES = new Set<AgentSpecType>([
  "string",
  "number",
  "boolean",
  "json",
  "list[string]",
  "list[number]",
  "list[boolean]",
  "list[json]",
]);

export const SUPPORTED_PATTERNS = new Set(["linear", "react"]);

export interface AgentSpecBase {
  version: "0.1";
  pattern?: "linear" | "react";
  agent: AgentSpecAgent;
  model: AgentSpecModel;
  inputs: Record<string, AgentSpecInput>;
  tools: AgentSpecTool[];
  locals: AgentSpecLocal[];
  model_context: AgentSpecContext[];
  generation: AgentSpecGeneration;
  output: AgentSpecOutput;
  assumptions?: string[];
}

export interface LinearAgentSpec extends AgentSpecBase {
  pattern?: "linear";
  react?: never;
}

export interface ReactAgentSpec extends AgentSpecBase {
  pattern: "react";
  react: AgentSpecReact;
}

export type AgentSpec = LinearAgentSpec | ReactAgentSpec;

export type AgentSpecDraft = Record<string, unknown>;

export function asAgentSpecDraft(value: unknown): AgentSpecDraft | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as AgentSpecDraft) : null;
}

export interface AgentSpecAgent {
  name: string;
  role: string;
  description: string;
}

export interface AgentSpecModel {
  import_name: string;
  uri: string;
}

export interface AgentSpecInput {
  type: AgentSpecType;
  required?: boolean;
}

export interface AgentSpecTool {
  import_name: string;
  uri: string;
  methods: AgentSpecMethod[];
}

export interface AgentSpecMethod {
  name: string;
  purpose: string;
}

export interface AgentSpecLocal {
  name: string;
  source: AgentSpecLocalSource;
}

export interface AgentSpecLocalSource {
  kind: "tool_call";
  tool: string;
  method: string;
  args: Record<string, string>;
}

export interface AgentSpecContext {
  source: string;
  label: string;
  max?: string;
}

export interface AgentSpecGeneration {
  input: string;
  max_output?: number;
}

export interface AgentSpecOutput {
  fields: Record<string, AgentSpecOutputField>;
}

export interface AgentSpecOutputField {
  type: AgentSpecType;
}

export interface AgentSpecReact {
  max_iterations: number;
  scratch: {
    label: string;
    max: string;
  };
  reason: {
    input: string;
    max_output?: number;
    output: AgentSpecOutput;
  };
  act: {
    tool: string;
    method: string;
    args: Record<string, string>;
  };
  stop_when: string;
}
