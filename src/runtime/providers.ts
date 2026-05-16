import type { Budget } from "../ast/types.js";
import type { BuiltContext } from "./context.js";
import type { JsonObject, LlmBinding, RuntimeValue } from "./values.js";

export interface Disposable {
  close(): void | Promise<void>;
}

export function isDisposable<T>(value: T): value is T & Disposable {
  return typeof value === "object" && value !== null && "close" in value && typeof value.close === "function";
}

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
