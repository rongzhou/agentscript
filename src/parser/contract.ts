import {
  type ListContractType,
  type NamedContractType,
  type ContractField,
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

export function parseContractObject(
  parser: ContractParserHost,
  options: ContractParseOptions = {},
): ContractObjectExpr {
  const start = parser.consume("{").range.start;
  const fields: ContractField[] = [];
  while (!parser.check("}") && !parser.isAtEnd()) {
    fields.push(parseContractField(parser, options));
    parser.consumeContractFieldSeparator("}");
  }

  parser.consume("}");
  return {
    kind: "ContractObjectExpr",
    fields,
    range: { start, end: parser.previous().range.end },
  };
}

function parseContractField(parser: ContractParserHost, options: ContractParseOptions): ContractField {
  const nameToken = parser.consumeIdentifier("Expected contract field name");
  const start = nameToken.range.start;
  const type = parser.match(":") ? parseContractType(parser) : parseLabelOnlyContractField(parser, nameToken, options);
  return {
    kind: "ContractField",
    name: nameToken.value,
    type,
    range: { start, end: type.range.end },
  };
}

function parseLabelOnlyContractField(
  parser: ContractParserHost,
  fieldName: Token,
  options: ContractParseOptions,
): NamedContractType {
  if (!parser.check("}") && !parser.check(",") && !isNewLineBetween(fieldName, parser.peek())) {
    throw parser.error("Expected ':' after contract field name");
  }
  if (!options.defaultType) {
    throw parser.errorAtRange("Label-only contract fields are not allowed in this contract", fieldName.range);
  }
  return {
    kind: "NamedContractType",
    name: options.defaultType,
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
