import type { Binding } from "./scope.js";

export const VALID_MEMORY_METHODS = new Set(["add", "query"]);

export function formatArityError(binding: Binding, actual: number): string | undefined {
  if (binding.arity === undefined || binding.arity === actual) {
    return undefined;
  }
  const displayName =
    binding.agentName && binding.functionName ? `${binding.agentName}.${binding.functionName}` : "function";
  return `Function '${displayName}' expects ${binding.arity} argument(s), got ${actual}`;
}
