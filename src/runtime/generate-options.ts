import type { Budget, Expr, GenerateExpr } from "../ast/types.js";
import {
  findGenerateProperty,
  isBooleanExpression,
  isGenerateThinkExpression,
  isNumberExpression,
  readGenerateProperty,
  requiredGenerateOptionDefault,
} from "../language/generate-options.js";
import { RuntimeError } from "./errors.js";
import type { RuntimeScope } from "./scope.js";
import type { RuntimeValue } from "./types.js";

export interface GenerateOptionsHost {
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
  const inputProperty = findGenerateProperty(expr.options, "input");
  if (!inputProperty) {
    throw new RuntimeError("generate object argument requires an input field", expr.options.range);
  }
  const attemptsExpr = readGenerateProperty(expr.options, "attempts", isNumberExpression);
  const attempts = attemptsExpr?.value ?? requiredGenerateOptionDefault<number>("attempts");
  if (!Number.isInteger(attempts) || attempts <= 0) {
    throw new RuntimeError("generate attempts must be a positive integer", attemptsExpr?.range ?? expr.options.range);
  }
  return {
    input: await host.evaluate(inputProperty.value, scope),
    attempts,
    maxOutput: expr.options.maxOutput,
    temperature: readGenerateProperty(expr.options, "temperature", isNumberExpression)?.value,
    think: readGenerateProperty(expr.options, "think", isGenerateThinkExpression)?.value,
    strict:
      readGenerateProperty(expr.options, "strict", isBooleanExpression)?.value ??
      requiredGenerateOptionDefault<boolean>("strict"),
    debug:
      readGenerateProperty(expr.options, "debug", isBooleanExpression)?.value ??
      requiredGenerateOptionDefault<boolean>("debug"),
  };
}
