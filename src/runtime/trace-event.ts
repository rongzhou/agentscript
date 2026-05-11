import { sanitizeForJson } from "./json.js";
import type { JsonObject, TraceEvent } from "./types.js";

export function buildTraceEvent(kind: TraceEvent["kind"], data: Record<string, unknown>): TraceEvent {
  return {
    kind,
    data: sanitizeForJson(data) as JsonObject,
  };
}
