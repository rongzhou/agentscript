import type { AgentDecl, Budget, Expr, GenerateExpr } from "../ast/types.js";
import { buildContext, builtContextToJson } from "./context.js";
import { RuntimeError } from "./errors.js";
import { isLlmBinding, isObject } from "./guards.js";
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

interface GenerateOptions {
  input: RuntimeValue;
  attempts: number;
  limit?: Budget;
  debug: boolean;
}

export class GenerateRuntime {
  constructor(
    private readonly llmProvider: LlmProvider,
    private readonly trace: TraceEvent[],
    private readonly host: GenerateRuntimeHost,
  ) {}

  async evaluateGenerate(expr: GenerateExpr, scope: RuntimeScope): Promise<RuntimeValue> {
    const options = await this.parseOptions(expr, scope);
    const context = await this.host.resolveContextUses(scope);
    const agent = this.host.currentAgent();
    const model = this.requireModel(scope, expr);
    const identity = this.buildIdentity(scope, expr);
    let repair: GenerateRepair | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      const instruction = repair ? appendRepair(options.input, repair) : options.input;
      const builtContext = buildContext({
        agentName: agent.name,
        model,
        identity,
        instruction,
        returnShape: expr.returnShape,
        uses: context,
        budget: options.limit,
      });

      if (options.debug) {
        writeDebugPrompt(agent.name, attempt, builtContext);
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
          budget: options.limit,
        });
      } catch (error) {
        if (attempt >= options.attempts || !isRepairableGenerateError(error)) {
          throw withGenerateRange(error, expr.range);
        }
        lastError = error;
        repair = {
          error: errorMessage(error)
        };
        continue;
      }

      try {
        const result = coerceValueToShape(rawResult, expr.returnShape);
        validateValueAgainstShape(result, expr.returnShape, expr.range);
        this.trace.push({
          kind: "generate",
          data: {
            instruction: sanitizeForJson(options.input),
            attempts: attempt,
            budget: budgetToJson(options.limit),
            debug: options.debug,
            context: builtContextToJson(builtContext),
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
          error: errorMessage(error),
        };
      }
    }

    throw lastError instanceof Error ? lastError : new RuntimeError("generate failed", expr.range);
  }

  private async parseOptions(expr: GenerateExpr, scope: RuntimeScope): Promise<GenerateOptions> {
    if (!expr.options.input) {
      throw new RuntimeError("generate object argument requires an input field", expr.options.range);
    }
    const attempts = expr.options.attempts?.value ?? 1;
    if (!Number.isInteger(attempts) || attempts <= 0) {
      throw new RuntimeError(
        "generate attempts must be a positive integer",
        expr.options.attempts?.range ?? expr.options.range,
      );
    }
    return {
      input: await this.host.evaluate(expr.options.input, scope),
      attempts,
      limit: expr.options.limit,
      debug: expr.options.debug?.value ?? false,
    };
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

function appendRepair(input: RuntimeValue, repair: GenerateRepair): RuntimeValue {
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
  if (isObject(input)) {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withGenerateRange(error: unknown, range: GenerateExpr["range"]): Error {
  if (error instanceof RuntimeError) {
    return new RuntimeError(error.message, error.range ?? range);
  }
  return new RuntimeError(errorMessage(error), range);
}

function writeDebugPrompt(agentName: string, attempt: number, builtContext: ReturnType<typeof buildContext>): void {
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
  console.error(parts.join("\n"));
}
