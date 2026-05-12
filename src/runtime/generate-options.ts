import type { Budget, Expr, GenerateExpr } from "../ast/types.js";
import {
  findGenerateInputProperty,
  readGenerateBooleanProperty,
  readGenerateNumberProperty,
  readGenerateThinkProperty,
  requiredGenerateOptionDefault,
} from "../language/generate-options.js";
import { RuntimeError } from "./errors.js";
import type { RuntimeScope } from "./scope.js";
import type { RuntimeValue } from "./types.js";

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

export async function parseGenerateOptions(
  expr: GenerateExpr,
  scope: RuntimeScope,
  host: GenerateOptionsHost,
): Promise<GenerateOptions> {
  const inputProperty = findGenerateInputProperty(expr.options);
  if (!inputProperty) {
    throw new RuntimeError("generate object argument requires an input field", expr.options.range);
  }
  const attemptsExpr = readGenerateNumberProperty(expr.options, "attempts");
  const attempts = attemptsExpr?.value ?? requiredGenerateOptionDefault<number>("attempts");
  if (!Number.isInteger(attempts) || attempts <= 0) {
    throw new RuntimeError("generate attempts must be a positive integer", attemptsExpr?.range ?? expr.options.range);
  }
  return {
    input: await host.evaluate(inputProperty.value, scope),
    attempts,
    maxOutput: expr.options.maxOutput,
    temperature: readGenerateNumberProperty(expr.options, "temperature")?.value,
    think: readGenerateThinkProperty(expr.options)?.value,
    strict:
      readGenerateBooleanProperty(expr.options, "strict")?.value ?? requiredGenerateOptionDefault<boolean>("strict"),
    debug: readGenerateBooleanProperty(expr.options, "debug")?.value ?? requiredGenerateOptionDefault<boolean>("debug"),
  };
}
