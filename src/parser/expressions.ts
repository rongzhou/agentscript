import type {
  BinaryExpr,
  BooleanExpr,
  Expr,
  CallExpr,
  IdentifierExpr,
  IndexExpr,
  MemberExpr,
  NullExpr,
  NumberExpr,
  StringExpr,
  UnaryExpr,
} from "../ast/types.js";
import { parseGenerate } from "./generate.js";
import type { ExpressionParserHost } from "./host.js";
import { parseList, parseObject } from "./literals.js";
import { parseParallelFor } from "./parallel-for.js";

export function parseExpressionExpr(parser: ExpressionParserHost): Expr {
  return parseLogicalOr(parser);
}

export function parsePostfixExpr(parser: ExpressionParserHost): Expr {
  let expr = parsePrimary(parser);

  while (true) {
    if (parser.match(".")) {
      const property = parser.consumeIdentifier("Expected property name").value;
      expr = {
        kind: "MemberExpr",
        object: expr,
        property,
        range: { start: expr.range.start, end: parser.previous().range.end },
      } satisfies MemberExpr;
      continue;
    }

    if (parser.match("(")) {
      const args = parser.parseCommaSeparatedUntil(")", () => parser.parseExpression());
      parser.consume(")");
      expr = {
        kind: "CallExpr",
        callee: expr,
        args,
        range: { start: expr.range.start, end: parser.previous().range.end },
      } satisfies CallExpr;
      continue;
    }

    if (parser.match("[")) {
      const index = parser.parseExpression();
      parser.consume("]");
      expr = {
        kind: "IndexExpr",
        object: expr,
        index,
        range: { start: expr.range.start, end: parser.previous().range.end },
      } satisfies IndexExpr;
      continue;
    }

    break;
  }

  return expr;
}

function parseLogicalOr(parser: ExpressionParserHost): Expr {
  return parseBinaryExpression(parser, () => parseLogicalAnd(parser), "or");
}

function parseLogicalAnd(parser: ExpressionParserHost): Expr {
  return parseBinaryExpression(parser, () => parseEquality(parser), "and");
}

function parseEquality(parser: ExpressionParserHost): Expr {
  return parseBinaryExpression(parser, () => parseComparison(parser), "==", "!=");
}

function parseComparison(parser: ExpressionParserHost): Expr {
  return parseBinaryExpression(parser, () => parseTerm(parser), "<", "<=", ">", ">=");
}

function parseTerm(parser: ExpressionParserHost): Expr {
  return parseBinaryExpression(parser, () => parseFactor(parser), "+", "-");
}

function parseFactor(parser: ExpressionParserHost): Expr {
  return parseBinaryExpression(parser, () => parseUnary(parser), "*", "/");
}

function parseBinaryExpression(
  parser: ExpressionParserHost,
  parseOperand: () => Expr,
  ...operators: BinaryExpr["operator"][]
): Expr {
  let expr = parseOperand();
  while (parser.matchAny(operators)) {
    const operator = parser.previous().value as BinaryExpr["operator"];
    const right = parseOperand();
    expr = {
      kind: "BinaryExpr",
      operator,
      left: expr,
      right,
      range: { start: expr.range.start, end: right.range.end },
    } satisfies BinaryExpr;
  }
  return expr;
}

function parseUnary(parser: ExpressionParserHost): Expr {
  if (parser.match("not")) {
    const start = parser.previous().range.start;
    const value = parseUnary(parser);
    return {
      kind: "UnaryExpr",
      operator: "not",
      value,
      range: { start, end: value.range.end },
    } satisfies UnaryExpr;
  }
  return parsePostfixExpr(parser);
}

function parsePrimary(parser: ExpressionParserHost): Expr {
  const token = parser.peek();

  if (parser.check("generate")) {
    return parseGenerate(parser);
  }

  if (parser.check("parallel")) {
    return parseParallelFor(parser);
  }

  if (parser.matchKind("string")) {
    return {
      kind: "StringExpr",
      value: token.value,
      range: token.range,
    } satisfies StringExpr;
  }

  if (parser.matchKind("number")) {
    if (!/^\d+(?:\.\d+)?$/.test(token.value)) {
      throw parser.errorAt(`Invalid number literal '${token.value}'`, token.range.start);
    }
    return {
      kind: "NumberExpr",
      value: Number.parseFloat(token.value),
      raw: token.value,
      range: token.range,
    } satisfies NumberExpr;
  }

  if (parser.match("true") || parser.match("false")) {
    return {
      kind: "BooleanExpr",
      value: token.value === "true",
      range: token.range,
    } satisfies BooleanExpr;
  }

  if (parser.match("none")) {
    return {
      kind: "NullExpr",
      range: token.range,
    } satisfies NullExpr;
  }

  if (parser.check("{")) {
    return parseObject(parser);
  }

  if (parser.check("[")) {
    return parseList(parser);
  }

  if (parser.matchKind("identifier") || parser.matchKind("keyword")) {
    return {
      kind: "IdentifierExpr",
      name: token.value,
      range: token.range,
    } satisfies IdentifierExpr;
  }

  throw parser.error("Expected expression");
}
