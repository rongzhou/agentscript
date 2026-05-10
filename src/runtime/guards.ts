import type {
  AgentBinding,
  FunctionBinding,
  LlmBinding,
  MemoryBinding,
  RuntimeObject,
  RuntimeResource,
  RuntimeValue,
  ToolBinding,
} from "./types.js";

export function isToolBinding(value: RuntimeValue): value is ToolBinding {
  return isResourceBinding(value, "tool");
}

export function isLlmBinding(value: RuntimeValue): value is LlmBinding {
  return isResourceBinding(value, "llm");
}

export function isFunctionBinding(value: RuntimeValue): value is FunctionBinding {
  return isResourceBinding(value, "function");
}

export function isAgentBinding(value: RuntimeValue): value is AgentBinding {
  return isResourceBinding(value, "agent");
}

export function isMemoryBinding(value: RuntimeValue): value is MemoryBinding {
  return isResourceBinding(value, "memory");
}

export function isObject(value: RuntimeValue): value is RuntimeObject {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isRuntimeResource(value);
}

export function isRuntimeResource(value: RuntimeValue): value is RuntimeResource {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "__agentScriptResource" in value;
}

const RESOURCE_KINDS_WITH_URI = new Set(["tool", "llm", "memory"]);

function isResourceBinding(
  value: RuntimeValue,
  resourceKind: "tool" | "llm" | "function" | "agent" | "memory",
): value is RuntimeResource {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("__agentScriptResource" in value) ||
    value.__agentScriptResource !== resourceKind
  ) {
    return false;
  }
  const binding = value as Record<string, unknown>;
  if (RESOURCE_KINDS_WITH_URI.has(resourceKind)) {
    return typeof binding.name === "string" && typeof binding.uri === "string";
  }
  if (resourceKind === "function") {
    return typeof binding.name === "string" && typeof binding.agentName === "string";
  }
  return typeof binding.name === "string";
}
