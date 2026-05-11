import {
  type ListShapeType,
  type NamedShapeType,
  type ShapeField,
  type ShapeObjectExpr,
  type ShapeTypeExpr,
} from "../ast/types.js";
import { isShapeTypeName } from "../language/shape.js";
import { ParseError } from "./errors.js";
import type { Token } from "./tokenizer.js";

export interface ShapeParserHost {
  consume(value: string): Token;
  consumeIdentifier(message: string): Token;
  consumeShapeFieldSeparator(terminator: string): void;
  check(value: string): boolean;
  isAtEnd(): boolean;
  match(value: string): boolean;
  peek(): Token;
  previous(): Token;
}

export function parseShapeObject(
  parser: ShapeParserHost,
  options: { allowDefaultStringFields: boolean },
): ShapeObjectExpr {
  const start = parser.consume("{").range.start;
  const fields: ShapeField[] = [];
  while (!parser.check("}") && !parser.isAtEnd()) {
    fields.push(parseShapeField(parser, options));
    parser.consumeShapeFieldSeparator("}");
  }

  parser.consume("}");
  return {
    kind: "ShapeObjectExpr",
    fields,
    range: { start, end: parser.previous().range.end },
  };
}

function parseShapeField(parser: ShapeParserHost, options: { allowDefaultStringFields: boolean }): ShapeField {
  const nameToken = parser.consumeIdentifier("Expected shape field name");
  const start = nameToken.range.start;
  const type = shouldDefaultShapeFieldToString(parser, nameToken, options)
    ? defaultStringShapeType(nameToken)
    : parseShapeType(parser);
  return {
    kind: "ShapeField",
    name: nameToken.value,
    type,
    range: { start, end: type.range.end },
  };
}

function shouldDefaultShapeFieldToString(
  parser: ShapeParserHost,
  fieldName: Token,
  options: { allowDefaultStringFields: boolean },
): boolean {
  if (!options.allowDefaultStringFields) {
    return false;
  }
  if (parser.check("}") || parser.check(",")) {
    return true;
  }
  return fieldName.range.end.line < parser.peek().range.start.line;
}

function defaultStringShapeType(fieldName: Token): NamedShapeType {
  return {
    kind: "NamedShapeType",
    name: "string",
    range: { start: fieldName.range.end, end: fieldName.range.end },
  };
}

function parseShapeType(parser: ShapeParserHost): ShapeTypeExpr {
  const start = parser.peek().range.start;
  const name = parser.consumeIdentifier("Expected shape type").value;
  if (name === "list" && parser.match("[")) {
    const itemType = parseShapeType(parser);
    parser.consume("]");
    return {
      kind: "ListShapeType",
      itemType,
      range: { start, end: parser.previous().range.end },
    } satisfies ListShapeType;
  }
  if (!isShapeTypeName(name)) {
    throw new ParseError(`Unsupported shape type '${name}'`, { ...start });
  }
  return {
    kind: "NamedShapeType",
    name,
    range: { start, end: parser.previous().range.end },
  } satisfies NamedShapeType;
}
