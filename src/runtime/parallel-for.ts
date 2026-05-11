import { formatExpressionSource } from "../ast/format.js";
import type { ParallelForExpr } from "../ast/types.js";
import { RuntimeError } from "./errors.js";
import type { RuntimeScope } from "./scope.js";
import { buildTraceEvent } from "./trace-event.js";
import type { RuntimeValue, TraceEvent } from "./types.js";

export interface ParallelForRuntimeHost {
  concurrency(): number;
  evaluateExpression(expr: ParallelForExpr["iterable"], scope: RuntimeScope): Promise<RuntimeValue>;
  evaluateBlockFinalValue(
    statements: ParallelForExpr["body"],
    scope: RuntimeScope,
    trace: TraceEvent[],
  ): Promise<RuntimeValue>;
}

export async function evaluateParallelFor(
  expr: ParallelForExpr,
  scope: RuntimeScope,
  trace: TraceEvent[],
  host: ParallelForRuntimeHost,
): Promise<RuntimeValue[]> {
  const iterable = await host.evaluateExpression(expr.iterable, scope);
  if (!Array.isArray(iterable)) {
    throw new RuntimeError("parallel for source must be a list", expr.iterable.range);
  }
  const selected = iterable.slice(0, expr.maxIterations);
  const concurrency = Math.max(1, Math.floor(host.concurrency()));
  const start = Date.now();
  const iterations = new Array<ParallelForIterationTrace>(selected.length);

  const result = await mapLimitWaitAll(selected, concurrency, async (item, index) => {
    const iterationTrace: TraceEvent[] = [];
    iterations[index] = {
      index,
      input: item,
      ok: false,
      trace: iterationTrace,
    };
    const child = scope.child();
    child.define(expr.item.name, item);
    try {
      const value = await host.evaluateBlockFinalValue(expr.body, child, iterationTrace);
      iterations[index] = {
        index,
        input: item,
        ok: true,
        result: value,
        trace: iterationTrace,
      };
      return value;
    } catch (error) {
      iterations[index] = {
        index,
        input: item,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        trace: iterationTrace,
      };
      throw error;
    }
  });
  if (result.failures.length > 0) {
    trace.push(
      buildTraceEvent("parallel_for", {
        item: expr.item.name,
        source: formatExpressionSource(expr.iterable),
        max_items: expr.maxIterations,
        items: selected.length,
        concurrency,
        duration_ms: Date.now() - start,
        ok: false,
        failed_indices: result.failures.map((failure) => failure.index),
        iterations,
      }),
    );
    throw new RuntimeError(
      `parallel for failed: ${result.failures.map((failure) => `[${failure.index}] ${failure.message}`).join("; ")}`,
      expr.range,
    );
  }

  trace.push(
    buildTraceEvent("parallel_for", {
      item: expr.item.name,
      source: formatExpressionSource(expr.iterable),
      max_items: expr.maxIterations,
      items: selected.length,
      concurrency,
      duration_ms: Date.now() - start,
      ok: true,
      iterations,
    }),
  );
  return result.values;
}

interface ParallelForIterationTrace {
  index: number;
  input: RuntimeValue;
  ok: boolean;
  result?: RuntimeValue;
  error?: string;
  trace: TraceEvent[];
}

interface MapLimitFailure {
  index: number;
  message: string;
}

async function mapLimitWaitAll<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<{ values: R[]; failures: MapLimitFailure[] }> {
  const results = new Array<R>(items.length);
  const failures: MapLimitFailure[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index]!, index);
      } catch (error) {
        failures.push({ index, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  failures.sort((left, right) => left.index - right.index);
  return { values: results, failures };
}
