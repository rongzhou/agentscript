import { assertNever } from "../utils/assert.js";
import type { JsonValue, TraceEvent } from "./types.js";

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
      const nested = Array.isArray(event.data.trace) ? (event.data.trace as TraceEvent[]) : [];
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
    case "use":
      return `${indent}- use ${summarize(event.data.source)}`;
    default:
      assertNever(event.kind);
  }
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
