import type { FuncDecl, ShapeField, ShapeObjectExpr } from "../ast/types.js";
import { RuntimeError } from "./errors.js";
import { isObject } from "./guards.js";
import { sanitizeForJson } from "./json.js";
import { validateValueAgainstShapeType } from "./shape.js";
import type { InputProvider, RuntimeValue, TraceEvent } from "./types.js";

export async function prepareEntryInput(
  input: RuntimeValue,
  entry: FuncDecl,
  inputProvider: InputProvider | undefined,
  trace: TraceEvent[],
): Promise<RuntimeValue> {
  const inputParam = entry.params[0];
  if (!inputParam?.shape) {
    return input;
  }
  if (!isObject(input)) {
    throw new RuntimeError("Entry input must be a JSON object", inputParam.range);
  }
  await fillShape(input, inputParam.shape, ["input"], inputProvider, trace);
  return input;
}

async function fillShape(
  target: Record<string, RuntimeValue>,
  shape: ShapeObjectExpr,
  path: string[],
  inputProvider: InputProvider | undefined,
  trace: TraceEvent[],
): Promise<void> {
  for (const field of shape.fields) {
    const fieldPath = [...path, field.name];
    const value = target[field.name];
    if (value === undefined || value === null) {
      if (!inputProvider) {
        throw new RuntimeError(
          `Missing input '${fieldPath.join(".")}' and no interactive input provider is available`,
          field.range,
        );
      }
      const filled = await inputProvider.read({ name: field.name, path: fieldPath });
      validateInputField(filled, field);
      target[field.name] = filled;
      trace.push({
        kind: "input",
        data: { path: fieldPath.join("."), value: sanitizeForJson(filled) },
      });
      continue;
    }
    validateInputField(value, field);
  }
}

function validateInputField(value: RuntimeValue, field: ShapeField): void {
  validateValueAgainstShapeType(value, field.type, field.range, "Input field");
}
