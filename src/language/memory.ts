export const MEMORY_ADD_METHOD = "add";
const MEMORY_QUERY_METHOD = "query";

export type MemoryMethod = "add" | "query";

interface MemoryMethodSpec {
  arity: number;
  effectful: boolean;
}

const MEMORY_METHOD_SPECS: Record<MemoryMethod, MemoryMethodSpec> = {
  [MEMORY_ADD_METHOD]: { arity: 1, effectful: true },
  [MEMORY_QUERY_METHOD]: { arity: 1, effectful: false },
};

export function isEffectfulMemoryMethod(value: string): boolean {
  return getMemoryMethodSpec(value)?.effectful ?? false;
}

export function getMemoryMethodSpec(value: string): MemoryMethodSpec | undefined {
  return MEMORY_METHOD_SPECS[value as MemoryMethod];
}
