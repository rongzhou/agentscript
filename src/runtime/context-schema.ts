import type { ShapeObjectExpr, ShapeTypeExpr } from "../ast/types.js";
import type { JsonObject } from "./types.js";

export function shapeToSchema(shape: ShapeObjectExpr): JsonObject {
  const properties: JsonObject = {};
  const required: string[] = [];

  for (const field of shape.fields) {
    properties[field.name] = shapeTypeToSchema(field.type);
    required.push(field.name);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

const SHAPE_TYPE_TO_JSON_SCHEMA: Record<string, JsonObject> = {
  string: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  json: {},
  list: { type: "array" },
};

function shapeTypeToSchema(type: ShapeTypeExpr): JsonObject {
  if (type.kind === "ListShapeType") {
    return { type: "array", items: shapeTypeToSchema(type.itemType) };
  }
  return SHAPE_TYPE_TO_JSON_SCHEMA[type.name] ?? {};
}
