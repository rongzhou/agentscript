import type { NamedShapeType, ShapeObjectExpr, ShapeTypeExpr } from "../ast/types.js";
import { isShapeTypeName } from "../language/shape.js";
import { errorDiagnostic as error, type SemanticDiagnostic } from "./diagnostics.js";

export function collectShapeDiagnostics(shape: ShapeObjectExpr): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];
  const fields = new Set<string>();

  for (const field of shape.fields) {
    if (fields.has(field.name)) {
      diagnostics.push(error("DUPLICATE_SHAPE_FIELD", `Duplicate shape field '${field.name}'`, field.range));
    }
    fields.add(field.name);
    diagnostics.push(...collectShapeTypeDiagnostics(field.type));
  }

  return diagnostics;
}

function collectShapeTypeDiagnostics(type: ShapeTypeExpr): SemanticDiagnostic[] {
  if (type.kind === "ListShapeType") {
    return collectShapeTypeDiagnostics(type.itemType);
  }
  return collectNamedShapeTypeDiagnostics(type);
}

function collectNamedShapeTypeDiagnostics(type: NamedShapeType): SemanticDiagnostic[] {
  if (!isShapeTypeName(type.name)) {
    return [error("UNKNOWN_SHAPE_TYPE", `Unsupported shape type '${type.name}'`, type.range)];
  }
  return [];
}
