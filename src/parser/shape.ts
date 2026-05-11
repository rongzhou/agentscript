import {
  type ListShapeType,
  type NamedShapeType,
  type ShapeField,
  type ShapeObjectExpr,
  type ShapeTypeExpr,
} from "../ast/types.js";
import { isShapeTypeName } from "../language/shape.js";
import { ParseError } from "./errors.js";
import type { TokenParserHost } from "./host.js";
import { isNewLineBetween, type Token } from "./tokenizer.js";

export interface ShapeParserHost extends TokenParserHost {
  consumeShapeFieldSeparator(terminator: string): void;
}

type ShapeParseMode = "strict" | "shorthand";

export function parseShapeObject(parser: ShapeParserHost, options: { mode: ShapeParseMode }): ShapeObjectExpr {
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

function parseShapeField(parser: ShapeParserHost, options: { mode: ShapeParseMode }): ShapeField {
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
  options: { mode: ShapeParseMode },
): boolean {
  if (options.mode !== "shorthand") {
    return false;
  }
  if (parser.check("}") || parser.check(",")) {
    return true;
  }
  return isNewLineBetween(fieldName, parser.peek());
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
