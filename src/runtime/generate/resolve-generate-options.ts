import type { Budget, Expr, GenerateExpr } from "../../ast/types.js";
import {
  DEFAULT_GENERATE_ATTEMPTS,
  DEFAULT_GENERATE_DEBUG,
  DEFAULT_GENERATE_STRICT,
  findGenerateInputProperty,
  readGenerateBooleanProperty,
  readGenerateNumberProperty,
  readGenerateThinkProperty,
} from "../../language/generate-options.js";
import { RuntimeError } from "../core/errors.js";
import type { RuntimeScope } from "../core/scope.js";
import type { RuntimeValue } from "../values/values.js";

interface GenerateOptionsHost {
  evaluate(expr: Expr, scope: RuntimeScope): Promise<RuntimeValue>;
}

export interface GenerateOptions {
  input: RuntimeValue;
  attempts: number;
  maxOutput?: Budget;
  temperature?: number;
  think?: boolean | string;
  strict: boolean;
  debug: boolean;
}

export async function resolveGenerateOptions(
  expr: GenerateExpr,
  scope: RuntimeScope,
  host: GenerateOptionsHost,
): Promise<GenerateOptions> {
  const inputProperty = findGenerateInputProperty(expr.options);
  if (!inputProperty) {
    throw new RuntimeError("generate object argument requires an input field", expr.options.range);
  }
  const attemptsExpr = readGenerateNumberProperty(expr.options, "attempts");
  const attempts = attemptsExpr?.value ?? DEFAULT_GENERATE_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts <= 0) {
    throw new RuntimeError("generate attempts must be a positive integer", attemptsExpr?.range ?? expr.options.range);
  }
  return {
    input: await host.evaluate(inputProperty.value, scope),
    attempts,
    maxOutput: expr.options.maxOutput,
    temperature: readGenerateNumberProperty(expr.options, "temperature")?.value,
    think: readGenerateThinkProperty(expr.options)?.value,
    strict: readGenerateBooleanProperty(expr.options, "strict")?.value ?? DEFAULT_GENERATE_STRICT,
    debug: readGenerateBooleanProperty(expr.options, "debug")?.value ?? DEFAULT_GENERATE_DEBUG,
  };
}
