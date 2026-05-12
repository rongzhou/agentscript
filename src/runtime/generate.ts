import type { AgentDecl, Expr, GenerateExpr } from "../ast/types.js";
import { buildContext, builtContextToJson, type BuiltContext } from "./context.js";
import { RuntimeError } from "./errors.js";
import { writeGenerateDebugPrompt } from "./generate-debug.js";
import { parseGenerateOptions, type GenerateOptions } from "./generate-options.js";
import {
  appendGenerateRepair,
  type GenerateRepair,
  generateErrorMessage,
  isRepairableGenerateError,
  withGenerateRange,
} from "./generate-repair.js";
import { isLlmBinding } from "./guards.js";
import { budgetToJson } from "./json.js";
import type { RuntimeScope } from "./scope.js";
import { coerceValueToShape, validateValueAgainstShape } from "./shape.js";
import { buildTraceEvent } from "./trace-event.js";
import {
  type ContextUse,
  type JsonObject,
  type LlmBinding,
  type LlmProvider,
  type RuntimeValue,
  type TraceEvent,
} from "./types.js";

interface GenerateRuntimeHost {
  currentAgent(): AgentDecl;
  evaluate(expr: Expr, scope: RuntimeScope): Promise<RuntimeValue>;
  resolveContextUses(scope: RuntimeScope): Promise<ContextUse[]>;
}

interface GenerateAttemptEnvironment {
  agent: AgentDecl;
  model: LlmBinding;
  identity: JsonObject;
  context: ContextUse[];
}

type GenerateAttemptResult =
  | { kind: "success"; value: RuntimeValue }
  | { kind: "retry"; error: unknown; message: string; repair: GenerateRepair }
  | { kind: "failure"; error: unknown };

export class GenerateRuntime {
  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly trace: TraceEvent[],
    private readonly host: GenerateRuntimeHost,
  ) {}

  async evaluateGenerate(expr: GenerateExpr, scope: RuntimeScope): Promise<RuntimeValue> {
    const options = await parseGenerateOptions(expr, scope, this.host);
    const environment: GenerateAttemptEnvironment = {
      agent: this.host.currentAgent(),
      model: this.requireModel(scope, expr),
      identity: this.buildIdentity(scope, expr),
      context: await this.host.resolveContextUses(scope),
    };
    let repair: GenerateRepair | undefined;
    let lastError: unknown;
    const errors: string[] = [];

    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      const result = await this.runGenerateAttempt(expr, options, environment, attempt, repair, errors);
      if (result.kind === "success") {
        return result.value;
      }
      if (result.kind === "failure") {
        throw withGenerateRange(result.error, expr.range);
      }
      lastError = result.error;
      errors.push(result.message);
      repair = result.repair;
    }

    throw lastError instanceof Error ? lastError : new RuntimeError("generate failed", expr.range);
  }

  private async runGenerateAttempt(
    expr: GenerateExpr,
    options: GenerateOptions,
    environment: GenerateAttemptEnvironment,
    attempt: number,
    repair: GenerateRepair | undefined,
    errors: string[],
  ): Promise<GenerateAttemptResult> {
    const builtContext = this.buildAttemptContext(expr, options, environment, repair);
    if (options.debug) {
      writeGenerateDebugPrompt(environment.agent.name, attempt, builtContext);
    }

    let rawResult: RuntimeValue;
    try {
      rawResult = await this.llmProvider.generate({
        agentName: environment.agent.name,
        model: environment.model,
        identity: environment.identity,
        context: environment.context,
        builtContext,
        maxOutput: options.maxOutput,
        temperature: options.temperature,
        think: options.think,
        strict: options.strict,
        debug: options.debug,
      });
    } catch (error) {
      return this.handleProviderError(options, builtContext, attempt, error, errors);
    }

    return this.validateAttemptResult(expr, options, builtContext, attempt, rawResult, errors);
  }

  private buildAttemptContext(
    expr: GenerateExpr,
    options: GenerateOptions,
    environment: GenerateAttemptEnvironment,
    repair: GenerateRepair | undefined,
  ): BuiltContext {
    return buildContext({
      agentName: environment.agent.name,
      model: environment.model,
      identity: environment.identity,
      instruction: repair ? appendGenerateRepair(options.input, repair) : options.input,
      returnShape: expr.returnShape,
      uses: environment.context,
      maxOutput: options.maxOutput,
    });
  }

  private handleProviderError(
    options: GenerateOptions,
    builtContext: BuiltContext,
    attempt: number,
    error: unknown,
    errors: string[],
  ): GenerateAttemptResult {
    const message = generateErrorMessage(error);
    if (attempt >= options.attempts || !isRepairableGenerateError(error)) {
      this.recordGenerateTrace(options, builtContext, {
        attempts: attempt,
        validation: null,
        result: null,
        ok: false,
        error: message,
        errors: [...errors, message],
      });
      return { kind: "failure", error };
    }
    return {
      kind: "retry",
      error,
      message,
      repair: { error: message },
    };
  }

  private validateAttemptResult(
    expr: GenerateExpr,
    options: GenerateOptions,
    builtContext: BuiltContext,
    attempt: number,
    rawResult: RuntimeValue,
    errors: string[],
  ): GenerateAttemptResult {
    try {
      const result = expr.returnShape && !options.strict ? coerceValueToShape(rawResult, expr.returnShape) : rawResult;
      if (expr.returnShape) {
        validateValueAgainstShape(result, expr.returnShape, expr.range, { rejectExtraFields: options.strict });
      }
      this.recordGenerateTrace(options, builtContext, {
        attempts: attempt,
        validation: expr.returnShape ? { ok: true, strict: options.strict } : null,
        result,
        ok: true,
        errors,
      });
      return { kind: "success", value: result };
    } catch (error) {
      const message = generateErrorMessage(error);
      if (attempt >= options.attempts) {
        this.recordGenerateTrace(options, builtContext, {
          attempts: attempt,
          validation: expr.returnShape ? { ok: false, strict: options.strict } : null,
          result: rawResult,
          ok: false,
          error: message,
          errors: [...errors, message],
        });
        return { kind: "failure", error };
      }
      return {
        kind: "retry",
        error,
        message,
        repair: {
          output: rawResult,
          error: message,
        },
      };
    }
  }

  private recordGenerateTrace(
    options: GenerateOptions,
    builtContext: BuiltContext,
    event: {
      attempts: number;
      validation: JsonObject | null;
      result: RuntimeValue | null;
      ok: boolean;
      error?: string;
      errors: string[];
    },
  ): void {
    this.trace.push(
      buildTraceEvent("generate", {
        instruction: options.input,
        config: {
          max_output: budgetToJson(options.maxOutput),
          attempts: options.attempts,
          temperature: options.temperature ?? null,
          think: options.think ?? false,
          strict: options.strict,
          debug: options.debug,
        },
        attempts: event.attempts,
        context: builtContextToJson(builtContext),
        validation: event.validation,
        result: event.result,
        ok: event.ok,
        error: event.error ?? null,
        errors: event.errors,
      }),
    );
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
