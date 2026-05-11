import type { GenerateExpr } from "../ast/types.js";
import { RuntimeError } from "./errors.js";
import { isObject } from "./guards.js";
import { sanitizeForJson } from "./json.js";
import type { RuntimeValue } from "./types.js";

export interface GenerateRepair {
  output?: RuntimeValue;
  error: string;
}

export function appendGenerateRepair(input: RuntimeValue, repair: GenerateRepair): RuntimeValue {
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

export function isRepairableGenerateError(error: unknown): boolean {
  return error instanceof RuntimeError && /LLM provider did not return JSON/.test(error.message);
}

export function generateErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function withGenerateRange(error: unknown, range: GenerateExpr["range"]): Error {
  if (error instanceof RuntimeError) {
    // If the error already carries a range, its message already includes the formatted location.
    return error.range ? error : new RuntimeError(error.message, range);
  }
  return new RuntimeError(generateErrorMessage(error), range);
}
