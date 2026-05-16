import type { JsonObject } from "../runtime/values/values.js";
import type { TraceEvent } from "../runtime/trace/trace.js";

export function pickedVariants(trace: TraceEvent[]): JsonObject {
  const picked: JsonObject = {};
  for (const event of flattenTrace(trace)) {
    if (event.kind !== "use") continue;
    const variant = event.data.variant;
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
    if (event.kind === "agent") {
      events.push(...flattenTrace(event.data.trace));
    }
    if (event.kind === "parallel_for") {
      for (const iteration of event.data.iterations) {
        events.push(...flattenTrace(iteration.trace));
      }
    }
  }
  return events;
}
