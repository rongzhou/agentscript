import type { AgentDecl, Expr, GenerateExpr } from "../../ast/types.js";
import { buildContext, builtContextToJson, type BuiltContext } from "../context/context.js";
import { RuntimeError } from "../core/errors.js";
import { resolveGenerateOptions, type GenerateOptions } from "./resolve-generate-options.js";
import { isLlmBinding } from "../values/guards.js";
import { budgetToJson, sanitizeForJson } from "../values/json.js";
import type { RuntimeScope } from "../core/scope.js";
import { coerceValueToContract, validateValueAgainstContract } from "../contract/validate-contract.js";
import { buildTraceEvent } from "../trace/trace.js";
import type { JsonObject, LlmBinding, RuntimeValue } from "../values/values.js";
import type { ContextUse, LlmProvider } from "../values/providers.js";
import type { RuntimeLogger } from "../core/interpreter.js";
import type { TraceEvent } from "../trace/trace.js";

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

export class GenerateRuntime {
  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly trace: TraceEvent[],
    private readonly host: GenerateRuntimeHost,
    private readonly logger?: RuntimeLogger,
  ) {}

  async evaluateGenerate(expr: GenerateExpr, scope: RuntimeScope): Promise<RuntimeValue> {
    const options = await resolveGenerateOptions(expr, scope, this.host);
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
      const builtContext = this.buildAttemptContext(expr, options, environment, repair);
      if (options.debug) {
        writeGenerateDebugPrompt(environment.agent.name, attempt, builtContext, this.logger);
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
          throw withGenerateRange(error, expr.range);
        }
        lastError = error;
        errors.push(message);
        repair = { error: message };
        continue;
      }

      try {
        const result =
          expr.returnContract && !options.strict ? coerceValueToContract(rawResult, expr.returnContract) : rawResult;
        if (expr.returnContract) {
          validateValueAgainstContract(result, expr.returnContract, expr.range, { rejectExtraFields: options.strict });
        }
        this.recordGenerateTrace(options, builtContext, {
          attempts: attempt,
          validation: expr.returnContract ? { ok: true, strict: options.strict } : null,
          result,
          ok: true,
          errors,
        });
        return result;
      } catch (error) {
        const message = generateErrorMessage(error);
        if (attempt >= options.attempts) {
          this.recordGenerateTrace(options, builtContext, {
            attempts: attempt,
            validation: expr.returnContract ? { ok: false, strict: options.strict } : null,
            result: rawResult,
            ok: false,
            error: message,
            errors: [...errors, message],
          });
          throw withGenerateRange(error, expr.range);
        }
        lastError = error;
        errors.push(message);
        repair = {
          output: rawResult,
          error: message,
        };
      }
    }

    throw lastError instanceof Error ? lastError : new RuntimeError("generate failed", expr.range);
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
      returnContract: expr.returnContract,
      uses: environment.context,
      maxOutput: options.maxOutput,
    });
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

interface GenerateRepair {
  output?: RuntimeValue;
  error: string;
}

function appendGenerateRepair(input: RuntimeValue, repair: GenerateRepair): RuntimeValue {
  const message = [
    "Previous generation failed.",
    repair.output === undefined
      ? undefined
      : `Previous output:\n${JSON.stringify(sanitizeForJson(repair.output), null, 2)}`,
    `Error:\n${repair.error}`,
    "Return corrected JSON matching the requested schema only.",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (typeof input === "string") {
    return `${input}\n\n${message}`;
  }
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return {
      ...input,
      repair: message,
    };
  }
  return {
    input,
    repair: message,
  };
}

function isRepairableGenerateError(error: unknown): boolean {
  return error instanceof RuntimeError && /LLM provider did not return JSON/.test(error.message);
}

function generateErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withGenerateRange(error: unknown, range: GenerateExpr["range"]): Error {
  if (error instanceof RuntimeError) {
    // If the error already carries a range, its message already includes the formatted location.
    return error.range ? error : new RuntimeError(error.message, range);
  }
  return new RuntimeError(generateErrorMessage(error), range);
}

function writeGenerateDebugPrompt(
  agentName: string,
  attempt: number,
  builtContext: BuiltContext,
  logger: RuntimeLogger | undefined,
): void {
  if (!logger) return;
  const parts = [
    `--- AgentScript generate debug: ${agentName} attempt ${attempt} ---`,
    "System:",
    builtContext.system,
    "Final user message:",
    builtContext.finalUserMessage,
    "Return schema:",
    JSON.stringify(builtContext.returnSchema, null, 2),
    "--- end AgentScript generate debug ---",
  ];
  logger.error(parts.join("\n"));
}
