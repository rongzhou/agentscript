import { SHAPE_TYPE_NAMES } from "../ast/constants.js";
import type { ListShapeType, NamedShapeType, ShapeObjectExpr, ShapeTypeExpr, SourceRange } from "../ast/types.js";
import type { SemanticDiagnostic } from "./diagnostics.js";

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
    return checkListShapeType(type);
  }
  return checkNamedShapeType(type);
}

function checkListShapeType(type: ListShapeType): SemanticDiagnostic[] {
  return checkShapeType(type.itemType);
}

function checkNamedShapeType(type: NamedShapeType): SemanticDiagnostic[] {
  if (!SHAPE_TYPE_NAMES.has(type.name)) {
    return [error("UNKNOWN_SHAPE_TYPE", `Unsupported shape type '${type.name}'`, type.range)];
  }
  return [];
}

function error(code: string, message: string, range: SourceRange): SemanticDiagnostic {
  return {
    severity: "error",
    code,
    message,
    range,
  };
}
