import {
  type ListContractType,
  type NamedContractType,
  type ContractObjectExpr,
  type ContractTypeExpr,
} from "../ast/types.js";
import { isContractTypeName } from "../language/contract.js";
import type { ContractParserHost } from "./host.js";
import type { Token } from "./tokenizer.js";
import { parseLabelledBlock } from "./labelled-block.js";

export interface ContractParseOptions {
  defaultType?: "string";
}

export function parseContractObject(
  parser: ContractParserHost,
  options: ContractParseOptions = {},
): ContractObjectExpr {
  const block = parseLabelledBlock(parser, {
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
