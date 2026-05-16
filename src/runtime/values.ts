export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ToolBinding {
  __agentScriptResource: "tool";
  name: string;
  uri: string;
}

export interface LlmBinding {
  __agentScriptResource: "llm";
  name: string;
  uri: string;
}

export interface FunctionBinding {
  __agentScriptResource: "function";
  agentName: string;
  name: string;
}

export interface AgentBinding {
  __agentScriptResource: "agent";
  name: string;
}

export interface MemoryBinding {
  __agentScriptResource: "memory";
  name: string;
  uri: string;
}

export interface RuntimeObject {
  [key: string]: RuntimeValue;
}

export type RuntimeResource = ToolBinding | LlmBinding | FunctionBinding | AgentBinding | MemoryBinding;

export type RuntimeValue = JsonPrimitive | RuntimeObject | RuntimeValue[] | RuntimeResource;
