import {
  type ListContractType,
  type NamedContractType,
  type SourceRange,
  type ContractObjectExpr,
  type ContractTypeExpr,
} from "../ast/types.js";
import { isContractTypeName } from "../language/contract.js";
import type { ContractParserHost } from "./host.js";
import type { Token } from "./tokenizer.js";
import { isNewLineBetween } from "./tokens.js";

export interface ContractParseOptions {
  defaultType?: "string";
}

export interface ContractBlockEntry<T> {
  name: string;
  value: T;
  range: SourceRange;
}

interface ContractBlockOptions<T> {
  parseValue: (nameToken: Token) => T;
  parseDefaultValue?: (nameToken: Token) => T;
  fieldNameMessage: string;
}

export function parseContractObject(
  parser: ContractParserHost,
  options: ContractParseOptions = {},
): ContractObjectExpr {
  const block = parseContractBlock(parser, {
    fieldNameMessage: "Expected contract field name",
    parseValue: () => parseContractType(parser),
    parseDefaultValue: options.defaultType
      ? (nameToken) => defaultContractType(nameToken, options.defaultType!)
      : undefined,
  });
  return {
    kind: "ContractObjectExpr",
    fields: block.entries.map((entry) => ({
      kind: "ContractField",
      name: entry.name,
      type: entry.value,
      range: entry.range,
    })),
    range: block.range,
  };
}

export function parseContractBlock<T extends { range: SourceRange }>(
  parser: ContractParserHost,
  options: ContractBlockOptions<T>,
): { entries: ContractBlockEntry<T>[]; range: SourceRange } {
  const start = parser.consume("{").range.start;
  const entries: ContractBlockEntry<T>[] = [];
  while (!parser.check("}") && !parser.isAtEnd()) {
    entries.push(parseContractBlockEntry(parser, options));
    parser.consumeContractBlockEntrySeparator("}");
  }

  parser.consume("}");
  return {
    entries,
    range: { start, end: parser.previous().range.end },
  };
}

function parseContractBlockEntry<T extends { range: SourceRange }>(
  parser: ContractParserHost,
  options: ContractBlockOptions<T>,
): ContractBlockEntry<T> {
  const nameToken = parser.consumeIdentifier(options.fieldNameMessage);
  const start = nameToken.range.start;
  const value = parser.match(":")
    ? options.parseValue(nameToken)
    : parseLabelOnlyContractBlockEntry(parser, nameToken, options);
  return {
    name: nameToken.value,
    value,
    range: { start, end: value.range.end },
  };
}

function parseLabelOnlyContractBlockEntry<T extends { range: SourceRange }>(
  parser: ContractParserHost,
  nameToken: Token,
  options: ContractBlockOptions<T>,
): T {
  if (!parser.check("}") && !parser.check(",") && !isNewLineBetween(nameToken, parser.peek())) {
    throw parser.error("Expected ':' after contract field name");
  }
  if (!options.parseDefaultValue) {
    throw parser.errorAtRange("Label-only contract fields are not allowed in this contract", nameToken.range);
  }
  return options.parseDefaultValue(nameToken);
}

function defaultContractType(fieldName: Token, name: "string"): NamedContractType {
  return {
    kind: "NamedContractType",
    name,
    range: { start: fieldName.range.end, end: fieldName.range.end },
  };
}

function parseContractType(parser: ContractParserHost): ContractTypeExpr {
  const token = parser.consumeIdentifier("Expected contract type");
  const start = token.range.start;
  const name = token.value;
  if (name === "list" && parser.match("[")) {
    const itemType = parseContractType(parser);
    parser.consume("]");
    return {
      kind: "ListContractType",
      itemType,
      range: { start, end: parser.previous().range.end },
    } satisfies ListContractType;
  }
  if (!isContractTypeName(name)) {
    throw parser.errorAtRange(`Unsupported contract type '${name}'`, token.range);
  }
  return {
    kind: "NamedContractType",
    name,
    range: { start, end: parser.previous().range.end },
  } satisfies NamedContractType;
}
