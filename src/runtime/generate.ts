import type { AgentDecl, Expr, GenerateExpr } from "../ast/types.js";
import { buildContext, builtContextToJson } from "./context.js";
import { RuntimeError } from "./errors.js";
import { writeGenerateDebugPrompt } from "./generate-debug.js";
import { parseGenerateOptions } from "./generate-options.js";
import {
  appendGenerateRepair,
  type GenerateRepair,
  generateErrorMessage,
  isRepairableGenerateError,
  withGenerateRange,
} from "./generate-repair.js";
import { isLlmBinding } from "./guards.js";
import { budgetToJson, sanitizeForJson } from "./json.js";
import type { RuntimeScope } from "./scope.js";
import { coerceValueToShape, validateValueAgainstShape } from "./shape.js";
import {
  type ContextUse,
  type JsonObject,
  type LlmBinding,
  type LlmProvider,
  type RuntimeValue,
  type TraceEvent,
} from "./types.js";

export interface GenerateRuntimeHost {
  currentAgent(): AgentDecl;
  evaluate(expr: Expr, scope: RuntimeScope): Promise<RuntimeValue>;
  resolveContextUses(scope: RuntimeScope): Promise<ContextUse[]>;
}

export class GenerateRuntime {
  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly trace: TraceEvent[],
    private readonly host: GenerateRuntimeHost,
  ) {}

  async evaluateGenerate(expr: GenerateExpr, scope: RuntimeScope): Promise<RuntimeValue> {
    const options = await parseGenerateOptions(expr, scope, this.host);
    const context = await this.host.resolveContextUses(scope);
    const agent = this.host.currentAgent();
    const model = this.requireModel(scope, expr);
    const identity = this.buildIdentity(scope, expr);
    let repair: GenerateRepair | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      const instruction = repair ? appendGenerateRepair(options.input, repair) : options.input;
      const builtContext = buildContext({
        agentName: agent.name,
        model,
        identity,
        instruction,
        returnShape: expr.returnShape,
        uses: context,
        maxOutput: options.maxOutput,
      });

      if (options.debug) {
        writeGenerateDebugPrompt(agent.name, attempt, builtContext);
      }

      let rawResult: RuntimeValue;
      try {
        rawResult = await this.llmProvider.generate({
          agentName: agent.name,
          model,
          identity,
          instruction,
          returnShape: expr.returnShape,
          context,
          builtContext,
          maxOutput: options.maxOutput,
          temperature: options.temperature,
          think: options.think,
          strict: options.strict,
          debug: options.debug,
        });
      } catch (error) {
        if (attempt >= options.attempts || !isRepairableGenerateError(error)) {
          throw withGenerateRange(error, expr.range);
        }
        lastError = error;
        repair = {
          error: generateErrorMessage(error),
        };
        continue;
      }

      try {
        const result =
          expr.returnShape && !options.strict ? coerceValueToShape(rawResult, expr.returnShape) : rawResult;
        if (expr.returnShape) {
          validateValueAgainstShape(result, expr.returnShape, expr.range, { rejectExtraFields: options.strict });
        }
        this.trace.push({
          kind: "generate",
          data: {
            instruction: sanitizeForJson(options.input),
            config: {
              maxOutput: budgetToJson(options.maxOutput),
              attempts: options.attempts,
              temperature: options.temperature ?? null,
              think: options.think ?? false,
              strict: options.strict,
              debug: options.debug,
            },
            attempts: attempt,
            context: builtContextToJson(builtContext),
            validation: expr.returnShape ? { ok: true, strict: options.strict } : null,
            result: sanitizeForJson(result),
          },
        });
        return result;
      } catch (error) {
        if (attempt >= options.attempts) {
          throw withGenerateRange(error, expr.range);
        }
        lastError = error;
        repair = {
          output: rawResult,
          error: generateErrorMessage(error),
        };
      }
    }

    throw lastError instanceof Error ? lastError : new RuntimeError("generate failed", expr.range);
  }

  private requireModel(scope: RuntimeScope, expr: GenerateExpr): LlmBinding {
    const model = scope.getConfig("model");
    if (model === undefined || !isLlmBinding(model)) {
      throw new RuntimeError("generate requires model in the current scope", expr.range);
    }
    return model;
  }

  private buildIdentity(scope: RuntimeScope, expr: GenerateExpr): JsonObject {
    const role = scope.getConfig("role");
    const description = scope.getConfig("description");
    if (typeof role !== "string") {
      throw new RuntimeError("generate requires role in the current scope", expr.range);
    }
    if (typeof description !== "string") {
      throw new RuntimeError("generate requires description in the current scope", expr.range);
    }

    return {
      role,
      description,
    };
  }
}
