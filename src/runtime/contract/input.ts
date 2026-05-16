import type { FuncDecl, ContractField, ContractObjectExpr } from "../../ast/types.js";
import { RuntimeError } from "../core/errors.js";
import { isObject } from "../values/guards.js";
import { validateValueAgainstContractType } from "./validate-contract.js";
import { buildTraceEvent } from "../trace/trace.js";
import type { RuntimeValue } from "../values/values.js";
import type { InputProvider } from "../values/providers.js";
import type { TraceEvent } from "../trace/trace.js";

export async function prepareEntryInput(
  input: RuntimeValue,
  entry: FuncDecl,
  inputProvider: InputProvider | undefined,
  trace: TraceEvent[],
): Promise<RuntimeValue> {
  const inputParam = entry.params[0];
  if (!inputParam?.contract) {
    return input;
  }
  if (!isObject(input)) {
    throw new RuntimeError("Entry input must be a JSON object", inputParam.range);
  }
  await fillContract(input, inputParam.contract, ["input"], inputProvider, trace);
  return input;
}

async function fillContract(
  target: Record<string, RuntimeValue>,
  contract: ContractObjectExpr,
  path: string[],
  inputProvider: InputProvider | undefined,
  trace: TraceEvent[],
): Promise<void> {
  for (const field of contract.fields) {
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
      trace.push(buildTraceEvent("input", { path: fieldPath.join("."), value: filled }));
      continue;
    }
    validateInputField(value, field);
  }
}

function validateInputField(value: RuntimeValue, field: ContractField): void {
  validateValueAgainstContractType(value, field.type, field.range, "Input field");
}
