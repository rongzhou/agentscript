import { isObject } from "../runtime/guards.js";
import { isTraceEventArray } from "../runtime/trace.js";
import type { JsonObject, TraceEvent } from "../runtime/types.js";

export function pickedVariants(trace: TraceEvent[]): JsonObject {
  const picked: JsonObject = {};
  for (const event of flattenTrace(trace)) {
    const variant = isObject(event.data.variant) ? event.data.variant : undefined;
    if (!variant || typeof variant.site_id !== "string" || typeof variant.picked !== "string") continue;
    picked[variant.site_id] = {
      variant: variant.picked,
      reason: typeof variant.reason === "string" ? variant.reason : "first",
      empty: typeof variant.empty === "boolean" ? variant.empty : false,
    };
  }
  return picked;
}

export function countEvents(trace: TraceEvent[], kind: TraceEvent["kind"]): number {
  return flattenTrace(trace).filter((event) => event.kind === kind).length;
}

function flattenTrace(trace: TraceEvent[]): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const event of trace) {
    events.push(event);
    const nested = event.data.trace;
    if (isTraceEventArray(nested)) events.push(...flattenTrace(nested));
    const iterations = event.data.iterations;
    if (Array.isArray(iterations)) {
      for (const iteration of iterations) {
        if (isObject(iteration) && isTraceEventArray(iteration.trace)) {
          events.push(...flattenTrace(iteration.trace));
        }
      }
    }
  }
  return events;
}
