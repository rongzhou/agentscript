import type { NamedShapeTypeName } from "../ast/types.js";

export const SHAPE_TYPE_NAMES = new Set<NamedShapeTypeName>(["string", "number", "boolean", "json", "list"]);

export function isShapeTypeName(value: string): value is NamedShapeTypeName {
  return SHAPE_TYPE_NAMES.has(value as NamedShapeTypeName);
}
