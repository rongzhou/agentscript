import type { NamedShapeType, ShapeObjectExpr, ShapeTypeExpr } from "../ast/types.js";
import { isShapeTypeName } from "../language/shape.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";

export function checkShapeObject(shape: ShapeObjectExpr): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const fields = new Set<string>();

  for (const field of shape.fields) {
    if (fields.has(field.name)) {
      diagnostics.push(error("DUPLICATE_SHAPE_FIELD", `Duplicate generate return field '${field.name}'`, field.range));
    }
    fields.add(field.name);
    diagnostics.push(...checkShapeType(field.type));
  }

  return diagnostics;
}

function checkShapeType(type: ShapeTypeExpr): SemanticDiagnostic[] {
  if (type.kind === "ListShapeType") {
    return checkShapeType(type.itemType);
  }
  return checkNamedShapeType(type);
}

function checkNamedShapeType(type: NamedShapeType): SemanticDiagnostic[] {
  if (!isShapeTypeName(type.name)) {
    return [error("UNKNOWN_SHAPE_TYPE", `Unsupported shape type '${type.name}'`, type.range)];
  }
  return [];
}
