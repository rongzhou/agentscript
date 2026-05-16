import { RuntimeError } from "../runtime/core/errors.js";
import { executeAgent } from "../runtime/core/interpreter.js";
import { sanitizeForJson } from "../runtime/values/json.js";
import type { RuntimeValue } from "../runtime/values/values.js";
import type { ToolCallRequest } from "../runtime/values/providers.js";
import type { TraceEvent } from "../runtime/trace/trace.js";
import { expectObject, readOptionalString, readRequiredString, softError } from "../providers/tools/shared.js";
import type { OptimizerToolContext } from "./context.js";
import { collectGraphSites, normalizePath, readTargetGraph, semanticErrors } from "./graph.js";
import { readEntry, readSelection, validateEntry, validateSelection } from "./selection.js";
import { snapshotGraph } from "./snapshot.js";
import { countEvents, pickedVariants } from "./trace.js";

export type TrialTraceWriter = (trace: TraceEvent[], runId: string | undefined) => string | null;

export async function trialOptimizer(
  request: ToolCallRequest,
  ctx: OptimizerToolContext,
  writeTrace: TrialTraceWriter,
): Promise<RuntimeValue> {
  const args = expectObject(request.args[0], "Optimizer.trial");
  const target = readRequiredString(args.target, "target");
  const graph = readTargetGraph(target);
  const warnings: RuntimeValue[] = [];
  const expectedSnapshot = readOptionalString(args.snapshot_id);
  const actualSnapshot = snapshotGraph(graph, ctx);
  if (expectedSnapshot && expectedSnapshot !== actualSnapshot) {
    warnings.push({ code: "snapshot_mismatch", expected: expectedSnapshot, actual: actualSnapshot });
  }
  const diagnostics = semanticErrors(graph);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      code: "semantic_error",
      target: normalizePath(graph.entryPath, ctx),
      diagnostics: sanitizeForJson(diagnostics),
    };
  }
  const sites = collectGraphSites(graph, ctx);
  const selection = readSelection(args.selection);
  const selectionError = validateSelection(selection, sites);
  if (selectionError) return selectionError;
  const entry = readEntry(args.entry);
  const entryError = validateEntry(entry, graph);
  if (entryError) return entryError;
  const traceMode = readTraceMode(args.trace);
  ctx.budget?.incrementTrial();
  ctx.budget?.checkDeadline();

  try {
    const start = Date.now();
    const result = await executeAgent(graph.program, args.input ?? {}, {
      agentName: entry?.agent,
      functionName: entry?.func,
      llmProvider: ctx.llmProvider,
      toolProvider: ctx.toolProvider,
      memoryProvider: ctx.memoryProvider,
      sourcePath: graph.entryPath,
      workspaceRoot: ctx.workspaceRoot,
      variant: selection,
      closeProviders: false,
    });
    const picked = pickedVariants(result.trace);
    const unreached = Object.keys(selection).filter((siteId) => !(siteId in picked));
    const traceRef = traceMode === "none" ? null : writeTrace(result.trace, readOptionalString(args.run_id));
    return {
      ok: true,
      result: sanitizeForJson(result.value),
      usage: {
        prompt_tokens: null,
        output_tokens: null,
        total_tokens: null,
        llm_calls: countEvents(result.trace, "generate"),
        latency_ms: Date.now() - start,
      },
      picked,
      unreached_selection: unreached,
      warnings,
      trace: traceMode === "full" ? sanitizeForJson(result.trace) : null,
      trace_ref: traceRef,
    };
  } catch (error) {
    if (isBudgetExceeded(error)) throw error;
    return softError("target_runtime_error", error instanceof Error ? error.message : String(error));
  }
}

function readTraceMode(value: RuntimeValue | undefined): "summary" | "full" | "none" {
  if (value === undefined) return "summary";
  if (value === "summary" || value === "full" || value === "none") return value;
  throw new RuntimeError("trace must be 'summary', 'full', or 'none'");
}

function isBudgetExceeded(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("BUDGET_EXCEEDED:");
}
