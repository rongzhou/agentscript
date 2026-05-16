import { sanitizeForJson } from "../values/json.js";
import type { JsonObject, JsonValue } from "../values/values.js";

interface UseTraceData {
  source: JsonValue;
  label: JsonValue;
  budget: JsonValue;
  variant?: JsonObject;
}

interface GenerateTraceData {
  instruction: JsonValue;
  config: JsonObject;
  attempts: number;
  context: JsonValue;
  validation: JsonObject | null;
  result: JsonValue;
  ok: boolean;
  error: string | null;
  errors: JsonValue[];
}

interface ToolTraceData {
  tool: string;
  method: string;
  scheme: string;
  uri: string;
  args: JsonValue;
  result: JsonValue;
  effects: JsonValue;
}

interface InputTraceData {
  path: string;
  value: JsonValue;
}

interface AgentTraceData {
  agent: string;
  function: string;
  args: JsonValue;
  result: JsonValue;
  trace: TraceEvent[];
}

interface ForTraceData {
  item: string;
  index: number;
  value: JsonValue;
  max_items: number;
  total_items: number;
  truncated: boolean;
}

interface ParallelForIterationTraceData {
  index: number;
  input: JsonValue;
  ok: boolean;
  trace: TraceEvent[];
  result?: JsonValue;
  error?: string;
}

interface ParallelForTraceData {
  item: string;
  source: string;
  max_items: number;
  items: number;
  concurrency: number;
  duration_ms: number;
  ok: boolean;
  failed_indices?: JsonValue;
  iterations: ParallelForIterationTraceData[];
}

interface MemoryTraceData {
  memory: string;
  operation: string;
  uri: string;
  args: JsonValue;
  result: JsonValue;
  count: number | null;
  id?: string | null;
  record?: JsonValue;
}

interface TraceDataByKind {
  use: UseTraceData;
  generate: GenerateTraceData;
  tool: ToolTraceData;
  input: InputTraceData;
  agent: AgentTraceData;
  for: ForTraceData;
  parallel_for: ParallelForTraceData;
  memory: MemoryTraceData;
}

type TraceEventInputByKind = { [K in keyof TraceDataByKind]: Record<string, unknown> };

export type TraceEvent = {
  [K in keyof TraceDataByKind]: { kind: K; data: TraceDataByKind[K] };
}[keyof TraceDataByKind];

export function buildTraceEvent<K extends keyof TraceDataByKind>(
  kind: K,
  data: TraceEventInputByKind[K],
): Extract<TraceEvent, { kind: K }> {
  return {
    kind,
    data: sanitizeForJson(data) as unknown as TraceDataByKind[K],
  } as unknown as Extract<TraceEvent, { kind: K }>;
}

export function formatTrace(trace: TraceEvent[]): string {
  if (trace.length === 0) {
    return "(empty trace)";
  }
  return trace.map((event) => formatEvent(event, 0)).join("\n");
}

function formatEvent(event: TraceEvent, depth: number): string {
  const indent = "  ".repeat(depth);
  switch (event.kind) {
    case "agent": {
      const agent = readString(event.data.agent);
      const fn = readString(event.data.function);
      const nested = isTraceEventArray(event.data.trace) ? event.data.trace : [];
      const header = `${indent}- agent ${agent}.${fn}`;
      if (nested.length === 0) return header;
      return [header, ...nested.map((child) => formatEvent(child, depth + 1))].join("\n");
    }
    case "generate":
      return `${indent}- generate ${summarize(event.data.instruction)}`;
    case "tool": {
      const tool = readString(event.data.tool);
      const method = readString(event.data.method);
      return `${indent}- tool ${tool}.${method}`;
    }
    case "memory": {
      const memory = readString(event.data.memory);
      const operation = readString(event.data.operation);
      return `${indent}- memory ${memory}.${operation}`;
    }
    case "input":
      return `${indent}- input ${readString(event.data.path)}`;
    case "for":
      return `${indent}- for ${readString(event.data.item)}[${summarize(event.data.index)}]`;
    case "parallel_for":
      return formatParallelFor(event, depth);
    case "use":
      return `${indent}- use ${summarize(event.data.source)}`;
  }
}

function formatParallelFor(event: Extract<TraceEvent, { kind: "parallel_for" }>, depth: number): string {
  const indent = "  ".repeat(depth);
  const header = `${indent}- parallel for ${readString(event.data.item)} (${summarize(event.data.items)} items, concurrency ${summarize(event.data.concurrency)})`;
  const iterations = Array.isArray(event.data.iterations) ? event.data.iterations : [];
  if (iterations.length === 0) return header;

  const lines = [header];
  for (const iteration of iterations) {
    if (!isJsonObject(iteration)) continue;
    const iterationIndent = "  ".repeat(depth + 1);
    const status = iteration.ok === true ? "ok" : "failed";
    lines.push(`${iterationIndent}- iteration [${summarize(iteration.index)}] ${status}`);
    const nested = isTraceEventArray(iteration.trace) ? iteration.trace : [];
    lines.push(...nested.map((child) => formatEvent(child, depth + 2)));
  }
  return lines.join("\n");
}

function readString(value: JsonValue | undefined): string {
  return typeof value === "string" && value.length > 0 ? value : "?";
}

function summarize(value: JsonValue | undefined): string {
  if (typeof value === "string") {
    return value.length > 72 ? `${value.slice(0, 69)}...` : value;
  }
  if (value === undefined) {
    return "";
  }
  const json = JSON.stringify(value);
  return json.length > 72 ? `${json.slice(0, 69)}...` : json;
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTraceEventArray(value: unknown): value is TraceEvent[] {
  return Array.isArray(value) && value.every(isTraceEvent);
}

function isTraceEvent(value: unknown): value is TraceEvent {
  return (
    isJsonObject(value) &&
    typeof value.kind === "string" &&
    isJsonObject(value.data) &&
    ["use", "generate", "tool", "input", "agent", "for", "parallel_for", "memory"].includes(value.kind)
  );
}
