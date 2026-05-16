import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeTargetPath } from "../language/site-id.js";
import { RuntimeError } from "../runtime/core/errors.js";
import { sanitizeForJson } from "../runtime/values/json.js";
import type { RuntimeValue } from "../runtime/values/values.js";
import type { ToolCallRequest, ToolProvider } from "../runtime/values/providers.js";
import type { TraceEvent } from "../runtime/trace/trace.js";
import { softError } from "../providers/tools/shared.js";
import type { OptimizerToolContext } from "./context.js";
import { inspectOptimizer } from "./inspect.js";
import { specializeOptimizer } from "./specialize.js";
import { trialOptimizer } from "./trial.js";

export type { OptimizerToolContext } from "./context.js";

export class OptimizerToolProvider implements ToolProvider {
  private trialCounter = 0;

  constructor(private readonly ctx: OptimizerToolContext) {}

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    if (new URL(request.uri).pathname.replace(/^\/$/, "") !== "") {
      return softError("invalid_uri", "host://optimizer does not accept a path");
    }
    switch (request.method) {
      case "inspect":
        return inspectOptimizer(request, this.ctx);
      case "trial":
        return trialOptimizer(request, this.ctx, (trace, runId) => this.writeTrialTrace(trace, runId));
      case "specialize":
        return specializeOptimizer(request, this.ctx);
      default:
        throw new RuntimeError(`Unknown Optimizer method '${request.method}'`);
    }
  }

  private writeTrialTrace(trace: TraceEvent[], runId: string | undefined): string | null {
    if (!this.ctx.artifactsDir) return null;
    const dir = join(this.ctx.artifactsDir, "trials");
    mkdirSync(dir, { recursive: true });
    const name = `${runId ?? "run"}-${Date.now()}-${this.trialCounter++}.jsonl`;
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(sanitizeForJson(trace))}\n`);
    return normalizeTargetPath(path, this.ctx.workspaceRoot);
  }
}
