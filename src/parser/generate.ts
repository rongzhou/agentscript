import type {
  BooleanExpr,
  Budget,
  Expr,
  GenerateExpr,
  GenerateOptionsExpr,
  NumberExpr,
  ObjectProperty,
  StringExpr,
} from "../ast/types.js";
import type { Token } from "./tokenizer.js";
import { parseShapeObject, type ShapeParserHost } from "./shape.js";

export interface GenerateParserHost extends ShapeParserHost {
  consumeKind(kind: Token["kind"], message: string): Token;
  consumeObjectKey(): string;
  consumePropertySeparator(terminator: string): void;
  parseBudgetToken(token: Token): Budget;
  parseExpression(): Expr;
}

export function parseGenerate(parser: GenerateParserHost): GenerateExpr {
  const start = parser.consume("generate").range.start;
  parser.consume("(");
  const options = parseGenerateOptions(parser);
  parser.consume(")");
  const returnShape = parser.match("->") ? parseShapeObject(parser, { allowDefaultStringFields: true }) : undefined;

  return {
    kind: "GenerateExpr",
    options,
    returnShape,
    range: { start, end: parser.previous().range.end },
  };
}

function parseGenerateOptions(parser: GenerateParserHost): GenerateOptionsExpr {
  const start = parser.consume("{").range.start;
  const properties: ObjectProperty[] = [];
  let input: Expr | undefined;
  let attempts: NumberExpr | undefined;
  let maxOutput: Budget | undefined;
  let temperature: NumberExpr | undefined;
  let think: BooleanExpr | StringExpr | undefined;
  let strict: BooleanExpr | undefined;
  let debug: BooleanExpr | undefined;

  while (!parser.check("}") && parser.peek().kind !== "eof") {
    const propStart = parser.peek().range.start;
    const key = parser.consumeObjectKey();
    parser.consume(":");
    let value: Expr;
    if (key === "max_output") {
      const token = parser.consumeKind("number", "Expected generate max_output");
      maxOutput = parser.parseBudgetToken(token);
      value = {
        kind: "NumberExpr",
        value: Number.parseFloat(token.value),
        raw: token.value,
        range: token.range,
      } satisfies NumberExpr;
    } else {
      value = parser.parseExpression();
    }
    properties.push({
      kind: "ObjectProperty",
      key,
      value,
      range: { start: propStart, end: value.range.end },
    });
    if (key === "input") {
      input = value;
    } else if (key === "attempts" && value.kind === "NumberExpr") {
      attempts = value;
    } else if (key === "temperature" && value.kind === "NumberExpr") {
      temperature = value;
    } else if (key === "think" && (value.kind === "BooleanExpr" || value.kind === "StringExpr")) {
      think = value;
    } else if (key === "strict" && value.kind === "BooleanExpr") {
      strict = value;
    } else if (key === "debug" && value.kind === "BooleanExpr") {
      debug = value;
    }
    parser.consumePropertySeparator("}");
  }

  parser.consume("}");
  return {
    kind: "GenerateOptionsExpr",
    properties,
    input,
    attempts,
    maxOutput,
    temperature,
    think,
    strict,
    debug,
    range: { start, end: parser.previous().range.end },
  };
}
