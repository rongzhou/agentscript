import { sanitizeForJson } from "../values/json.js";
import type { JsonObject, JsonValue } from "../values/values.js";

export interface TraceEvent {
  kind: "use" | "generate" | "tool" | "input" | "agent" | "for" | "parallel_for" | "memory";
  data: JsonObject;
}

export function buildTraceEvent(kind: TraceEvent["kind"], data: Record<string, unknown>): TraceEvent {
  return {
    kind,
    data: sanitizeForJson(data) as JsonObject,
  };
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

function formatParallelFor(event: TraceEvent, depth: number): string {
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
