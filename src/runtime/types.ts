import type { Budget } from "../ast/types.js";
import type { BuiltContext } from "./context.js";

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

export interface ContextUse {
  source?: string;
  label?: string;
  value: RuntimeValue;
  budget?: Budget;
}

export interface GenerateRequest {
  agentName: string;
  model?: LlmBinding;
  identity: JsonObject;
  context: ContextUse[];
  builtContext: BuiltContext;
  maxOutput?: Budget;
  temperature?: number;
  think?: boolean | string;
  strict: boolean;
  debug: boolean;
}

export interface ToolCallRequest {
  toolName: string;
  uri: string;
  method: string;
  args: RuntimeValue[];
  propertyRead?: boolean;
}

export interface MemoryAddRequest {
  memoryName: string;
  uri: string;
  record: RuntimeValue;
}

export interface MemoryQueryRequest {
  memoryName: string;
  uri: string;
  query: RuntimeValue;
}

export interface LlmProvider {
  generate(request: GenerateRequest): Promise<RuntimeValue>;
  close?(): void | Promise<void>;
}

export interface ToolProvider {
  call(request: ToolCallRequest): Promise<RuntimeValue>;
  close?(): void | Promise<void>;
}

export interface MemoryProvider {
  add(request: MemoryAddRequest): Promise<RuntimeValue>;
  query(request: MemoryQueryRequest): Promise<RuntimeValue>;
  close?(): void | Promise<void>;
}

export interface InputProvider {
  read(request: InputRequest): Promise<RuntimeValue>;
  close?(): void | Promise<void>;
}

export interface InputRequest {
  name: string;
  path: string[];
}

export interface TraceEvent {
  kind: "use" | "generate" | "tool" | "input" | "agent" | "for" | "parallel_for" | "memory";
  data: JsonObject;
}
