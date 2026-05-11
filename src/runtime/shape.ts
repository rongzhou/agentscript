import type { ShapeObjectExpr, ShapeTypeExpr, SourceRange } from "../ast/types.js";
import { shapeTypeDefaultValue } from "../language/shape.js";
import { RuntimeError } from "./errors.js";
import { isObject, isRuntimeResource } from "./guards.js";
import type { JsonObject, JsonValue, RuntimeObject, RuntimeValue } from "./types.js";

export function buildValueFromShape(shape: ShapeObjectExpr): JsonObject {
  const result: JsonObject = {};
  for (const field of shape.fields) {
    result[field.name] = buildValueFromShapeType(field.type);
  }
  return result;
}

export function validateValueAgainstShape(
  value: RuntimeValue,
  shape: ShapeObjectExpr,
  range?: SourceRange,
  options: { rejectExtraFields?: boolean } = {},
): void {
  if (!isObject(value)) {
    throw new RuntimeError("LLM result must be an object matching the generate return shape", range);
  }

  const allowedFields = new Set(shape.fields.map((field) => field.name));
  if (options.rejectExtraFields) {
    for (const key of Object.keys(value)) {
      if (!allowedFields.has(key)) {
        throw new RuntimeError(`LLM result contains unexpected field '${key}'`, range);
      }
    }
  }

  for (const field of shape.fields) {
    if (!(field.name in value)) {
      throw new RuntimeError(`LLM result is missing required field '${field.name}'`, field.range);
    }
    validateValueAgainstShapeType(value[field.name]!, field.type, field.range);
  }
}

export function coerceValueToShape(value: RuntimeValue, shape: ShapeObjectExpr): RuntimeValue {
  if (!isObject(value)) {
    return value;
  }

  const result: RuntimeObject = {};
  for (const [key, item] of Object.entries(value)) {
    const field = shape.fields.find((candidate) => candidate.name === key);
    result[key] = field ? coerceValueToShapeType(item, field.type) : item;
  }
  return result;
}

type ShapeValidator = (value: RuntimeValue, range?: SourceRange, errorPrefix?: string) => void;

interface ShapeTypeConfig {
  validate: ShapeValidator;
  coerce?: (value: RuntimeValue) => RuntimeValue;
}

const SHAPE_TYPE_CONFIG: Record<string, ShapeTypeConfig> = {
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
    validate: (value, range, errorPrefix = "LLM result json field") => {
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

function coerceValueToShapeType(value: RuntimeValue, type: ShapeTypeExpr): RuntimeValue {
  if (type.kind === "ListShapeType") {
    if (!Array.isArray(value)) {
      return value;
    }
    return value.map((item) => coerceValueToShapeType(item, type.itemType));
  }

  const config = SHAPE_TYPE_CONFIG[type.name];
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

export function validateValueAgainstShapeType(
  value: RuntimeValue,
  type: ShapeTypeExpr,
  range?: SourceRange,
  errorPrefix = "LLM result field",
): void {
  if (type.kind === "ListShapeType") {
    if (!Array.isArray(value)) {
      throw new RuntimeError(`${errorPrefix} must be a list`, range);
    }
    for (const item of value) {
      validateValueAgainstShapeType(item, type.itemType, range, errorPrefix);
    }
    return;
  }

  const config = SHAPE_TYPE_CONFIG[type.name];
  if (config) {
    config.validate(value, range, errorPrefix);
  }
}

function buildValueFromShapeType(type: ShapeTypeExpr): JsonValue {
  if (type.kind === "ListShapeType") {
    return [];
  }
  return shapeTypeDefaultValue(type.name) as JsonValue;
}
