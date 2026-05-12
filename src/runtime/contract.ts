import type { ContractObjectExpr, ContractTypeExpr, SourceRange } from "../ast/types.js";
import { RuntimeError } from "./errors.js";
import { isObject, isRuntimeResource } from "./guards.js";
import type { RuntimeObject, RuntimeValue } from "./types.js";

export function validateValueAgainstContract(
  value: RuntimeValue,
  contract: ContractObjectExpr,
  range?: SourceRange,
  options: { rejectExtraFields?: boolean } = {},
): void {
  if (!isObject(value)) {
    throw new RuntimeError("LLM result must be an object matching the generate return contract", range);
  }

  const allowedFields = new Set(contract.fields.map((field) => field.name));
  if (options.rejectExtraFields) {
    for (const key of Object.keys(value)) {
      if (!allowedFields.has(key)) {
        throw new RuntimeError(`LLM result contains unexpected field '${key}'`, range);
      }
    }
  }

  for (const field of contract.fields) {
    if (!(field.name in value)) {
      throw new RuntimeError(`LLM result is missing required field '${field.name}'`, field.range);
    }
    validateValueAgainstContractType(value[field.name]!, field.type, field.range);
  }
}

export function coerceValueToContract(value: RuntimeValue, contract: ContractObjectExpr): RuntimeValue {
  if (!isObject(value)) {
    return value;
  }

  const result: RuntimeObject = {};
  for (const [key, item] of Object.entries(value)) {
    const field = contract.fields.find((candidate) => candidate.name === key);
    result[key] = field ? coerceValueToContractType(item, field.type) : item;
  }
  return result;
}

type ContractValidator = (value: RuntimeValue, range?: SourceRange, errorPrefix?: string) => void;

interface ContractTypeConfig {
  validate: ContractValidator;
  coerce?: (value: RuntimeValue) => RuntimeValue;
}

const CONTRACT_TYPE_CONFIG: Record<string, ContractTypeConfig> = {
  string: {
    validate: (value, range, errorPrefix = "LLM result field") => {
      if (typeof value !== "string") throw new RuntimeError(`${errorPrefix} must be a string`, range);
    },
  },
  number: {
    validate: (value, range, errorPrefix = "LLM result field") => {
      if (typeof value !== "number") throw new RuntimeError(`${errorPrefix} must be a number`, range);
    },
    coerce: coerceStringToNumber,
  },
  boolean: {
    validate: (value, range, errorPrefix = "LLM result field") => {
      if (typeof value !== "boolean") throw new RuntimeError(`${errorPrefix} must be a boolean`, range);
    },
    coerce: coerceStringToBoolean,
  },
  json: {
    validate: (value, range, errorPrefix = "LLM result field") => {
      if (isRuntimeResource(value)) {
        throw new RuntimeError(`${errorPrefix} cannot contain runtime resource bindings`, range);
      }
    },
  },
  list: {
    validate: (value, range, errorPrefix = "LLM result field") => {
      if (!Array.isArray(value)) throw new RuntimeError(`${errorPrefix} must be a list`, range);
    },
  },
};

function coerceValueToContractType(value: RuntimeValue, type: ContractTypeExpr): RuntimeValue {
  if (type.kind === "ListContractType") {
    if (!Array.isArray(value)) {
      return value;
    }
    return value.map((item) => coerceValueToContractType(item, type.itemType));
  }

  const config = CONTRACT_TYPE_CONFIG[type.name];
  return config?.coerce ? config.coerce(value) : value;
}

function coerceStringToNumber(value: RuntimeValue): RuntimeValue {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    return value;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
}

function coerceStringToBoolean(value: RuntimeValue): RuntimeValue {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return value;
}

export function validateValueAgainstContractType(
  value: RuntimeValue,
  type: ContractTypeExpr,
  range?: SourceRange,
  errorPrefix = "LLM result field",
): void {
  if (type.kind === "ListContractType") {
    if (!Array.isArray(value)) {
      throw new RuntimeError(`${errorPrefix} must be a list`, range);
    }
    for (const item of value) {
      validateValueAgainstContractType(item, type.itemType, range, errorPrefix);
    }
    return;
  }

  const config = CONTRACT_TYPE_CONFIG[type.name];
  if (config) {
    config.validate(value, range, errorPrefix);
  }
}
