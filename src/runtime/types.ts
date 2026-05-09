import type { Budget, ShapeObjectExpr } from "../ast/types.js";
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

export type RuntimeValue =
  | JsonPrimitive
  | RuntimeObject
  | RuntimeValue[]
  | ToolBinding
  | LlmBinding
  | FunctionBinding
  | AgentBinding
  | MemoryBinding;

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
  instruction: RuntimeValue;
  returnShape?: ShapeObjectExpr;
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
}

export interface ToolProvider {
  call(request: ToolCallRequest): Promise<RuntimeValue>;
}

export interface MemoryProvider {
  add(request: MemoryAddRequest): Promise<RuntimeValue>;
  query(request: MemoryQueryRequest): Promise<RuntimeValue>;
}

export interface InputProvider {
  read(request: InputRequest): Promise<RuntimeValue>;
}

export interface InputRequest {
  name: string;
  path: string[];
}

export interface TraceEvent {
  [key: string]: JsonValue;
  kind: "use" | "generate" | "tool" | "input" | "agent" | "for" | "memory";
  data: JsonObject;
}
