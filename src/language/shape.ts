import type { NamedShapeTypeName } from "../ast/types.js";

export const SHAPE_TYPE_KEYS = new Set<NamedShapeTypeName>(["string", "number", "boolean", "json", "list"]);

export type ShapeJsonSchema = Record<string, string>;

export interface ShapeTypeSpec {
  jsonSchema: ShapeJsonSchema;
}

export const SHAPE_TYPE_SPECS: Record<NamedShapeTypeName, ShapeTypeSpec> = {
  string: {
    jsonSchema: { type: "string" },
  },
  number: {
    jsonSchema: { type: "number" },
  },
  boolean: {
    jsonSchema: { type: "boolean" },
  },
  json: {
    jsonSchema: {},
  },
  list: {
    jsonSchema: { type: "array" },
  },
};

export function isShapeTypeName(value: string): value is NamedShapeTypeName {
  return SHAPE_TYPE_KEYS.has(value as NamedShapeTypeName);
}

export function shapeTypeJsonSchema(name: NamedShapeTypeName): ShapeJsonSchema {
  return SHAPE_TYPE_SPECS[name].jsonSchema;
}
