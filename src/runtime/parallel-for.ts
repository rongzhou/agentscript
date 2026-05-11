import { formatExpressionSource } from "../ast/format.js";
import type { ParallelForExpr } from "../ast/types.js";
import { RuntimeError } from "./errors.js";
import type { RuntimeScope } from "./scope.js";
import type { RuntimeValue, TraceEvent } from "./types.js";

export interface ParallelForRuntimeHost {
  concurrency(): number;
  evaluateExpression(expr: ParallelForExpr["iterable"], scope: RuntimeScope): Promise<RuntimeValue>;
  evaluateBlockFinalValue(statements: ParallelForExpr["body"], scope: RuntimeScope): Promise<RuntimeValue>;
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

  const result = await mapLimitWaitAll(selected, concurrency, async (item) => {
    const child = scope.child();
    child.define(expr.itemName, item);
    return host.evaluateBlockFinalValue(expr.body, child);
  });
  if (result.failures.length > 0) {
    trace.push({
      kind: "parallel_for",
      data: {
        item: expr.itemName,
        source: formatExpressionSource(expr.iterable),
        max_items: expr.maxIterations,
        items: selected.length,
        concurrency,
        duration_ms: Date.now() - start,
        ok: false,
        failed_indices: result.failures.map((failure) => failure.index),
      },
    });
    throw new RuntimeError(
      `parallel for failed: ${result.failures.map((failure) => `[${failure.index}] ${failure.message}`).join("; ")}`,
      expr.range,
    );
  }

  trace.push({
    kind: "parallel_for",
    data: {
      item: expr.itemName,
      source: formatExpressionSource(expr.iterable),
      max_items: expr.maxIterations,
      items: selected.length,
      concurrency,
      duration_ms: Date.now() - start,
      ok: true,
    },
  });
  return result.values;
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
