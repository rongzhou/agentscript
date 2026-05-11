import type { NamedShapeTypeName } from "../ast/types.js";

export const SHAPE_TYPE_NAMES = new Set<NamedShapeTypeName>(["string", "number", "boolean", "json", "list"]);

export type ShapeJsonSchema = Record<string, string>;

export interface ShapeTypeMetadata {
  defaultValue: unknown;
  jsonSchema: ShapeJsonSchema;
}

export const SHAPE_TYPE_METADATA: Record<NamedShapeTypeName, ShapeTypeMetadata> = {
  string: {
    defaultValue: "",
    jsonSchema: { type: "string" },
  },
  number: {
    defaultValue: 0,
    jsonSchema: { type: "number" },
  },
  boolean: {
    defaultValue: true,
    jsonSchema: { type: "boolean" },
  },
  json: {
    defaultValue: {},
    jsonSchema: {},
  },
  list: {
    defaultValue: [],
    jsonSchema: { type: "array" },
  },
};

export function isShapeTypeName(value: string): value is NamedShapeTypeName {
  return SHAPE_TYPE_NAMES.has(value as NamedShapeTypeName);
}

export function shapeTypeDefaultValue(name: NamedShapeTypeName): unknown {
  return SHAPE_TYPE_METADATA[name].defaultValue;
}

export function shapeTypeJsonSchema(name: NamedShapeTypeName): ShapeJsonSchema {
  return SHAPE_TYPE_METADATA[name].jsonSchema;
}
