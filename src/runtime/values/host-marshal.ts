import { RuntimeError } from "../core/errors.js";
import { CONTINUE_JSON_WALK, mapJsonLikeValue, type JsonWalkPolicy } from "./json-walk.js";
import type { JsonValue, RuntimeValue } from "./values.js";

interface MarshalContext {
  label: string;
}

export function toJsonArg(value: RuntimeValue, context: MarshalContext): JsonValue {
  return mapJsonLikeValue(value, "argument", toJsonArgPolicy(context.label)) as JsonValue;
}

export function fromHostValue(value: unknown, context: MarshalContext): RuntimeValue {
  return mapJsonLikeValue(value, "result", fromHostPolicy(context.label)) as RuntimeValue;
}

function toJsonArgPolicy(label: string): JsonWalkPolicy {
  return {
    unsupported(value, path) {
      throw new RuntimeError(`${label} expects JSON-safe value at ${path}, got ${typeof value}`);
    },
    circular(_value, path) {
      throw new RuntimeError(`${label} expects JSON-safe value at ${path}, got circular reference`);
    },
    object(value, path) {
      if (isRuntimeBinding(value)) {
        throw new RuntimeError(
          `${label} expects JSON-safe value at ${path}, got ${value.__agentScriptResource} binding`,
        );
      }
      return CONTINUE_JSON_WALK;
    },
  };
}

function fromHostPolicy(label: string): JsonWalkPolicy {
  return {
    primitive(value, path) {
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new RuntimeError(`${label} returned invalid value at ${path}: number must be finite`);
      }
      return value;
    },
    unsupported(value, path) {
      if (value === undefined) {
        throw new RuntimeError(`${label} returned invalid value at ${path}: undefined is not JSON-safe`);
      }
      if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
        throw new RuntimeError(`${label} returned invalid value at ${path}: ${typeof value} is not JSON-safe`);
      }
      throw new RuntimeError(`${label} returned invalid value at ${path}: unsupported value`);
    },
    circular(_value, path) {
      throw new RuntimeError(`${label} returned invalid value at ${path}: circular reference is not JSON-safe`);
    },
    object(value, path) {
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        throw new RuntimeError(`${label} returned invalid value at ${path}: binary data is not JSON-safe`);
      }
      if (value instanceof Map || value instanceof Set) {
        throw new RuntimeError(
          `${label} returned invalid value at ${path}: ${value.constructor.name} is not JSON-safe`,
        );
      }
      if (!Array.isArray(value) && !isPlainObject(value)) {
        throw new RuntimeError(`${label} returned invalid value at ${path}: class instance is not JSON-safe`);
      }
      return CONTINUE_JSON_WALK;
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRuntimeBinding(value: object): value is { __agentScriptResource: string } {
  return (
    "__agentScriptResource" in value &&
    typeof (value as { __agentScriptResource?: unknown }).__agentScriptResource === "string"
  );
}
