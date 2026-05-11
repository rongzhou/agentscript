import type { ShapeObjectExpr, ShapeTypeExpr } from "../ast/types.js";
import { shapeTypeJsonSchema } from "../language/shape.js";
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

function shapeTypeToSchema(type: ShapeTypeExpr): JsonObject {
  if (type.kind === "ListShapeType") {
    return { type: "array", items: shapeTypeToSchema(type.itemType) };
  }
  return shapeTypeJsonSchema(type.name);
}
