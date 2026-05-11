export const MEMORY_ADD_METHOD = "add";
export const MEMORY_QUERY_METHOD = "query";

export type MemoryMethod = typeof MEMORY_ADD_METHOD | typeof MEMORY_QUERY_METHOD;

export interface MemoryMethodSpec {
  arity: number;
  effectful: boolean;
}

export const MEMORY_METHOD_SPECS: Record<MemoryMethod, MemoryMethodSpec> = {
  [MEMORY_ADD_METHOD]: { arity: 1, effectful: true },
  [MEMORY_QUERY_METHOD]: { arity: 1, effectful: false },
};

export const MEMORY_METHODS = new Set<MemoryMethod>(Object.keys(MEMORY_METHOD_SPECS) as MemoryMethod[]);

export function isMemoryMethod(value: string): value is MemoryMethod {
  return MEMORY_METHODS.has(value as MemoryMethod);
}

export function isEffectfulMemoryMethod(value: string): boolean {
  return getMemoryMethodSpec(value)?.effectful ?? false;
}

export function getMemoryMethodSpec(value: string): MemoryMethodSpec | undefined {
  return isMemoryMethod(value) ? MEMORY_METHOD_SPECS[value] : undefined;
}
