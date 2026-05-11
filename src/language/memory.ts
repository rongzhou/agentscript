export const MEMORY_ADD_METHOD = "add";
export const MEMORY_QUERY_METHOD = "query";

export type MemoryMethod = typeof MEMORY_ADD_METHOD | typeof MEMORY_QUERY_METHOD;

export const MEMORY_METHODS = new Set<MemoryMethod>([MEMORY_ADD_METHOD, MEMORY_QUERY_METHOD]);

export function isMemoryMethod(value: string): value is MemoryMethod {
  return MEMORY_METHODS.has(value as MemoryMethod);
}

export function isEffectfulMemoryMethod(value: string): boolean {
  return value === MEMORY_ADD_METHOD;
}
