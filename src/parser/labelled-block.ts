import type { SourceRange } from "../ast/types.js";
import type { ContractParserHost } from "./host.js";
import type { Token } from "./tokenizer.js";
import { isNewLineBetween } from "./tokenizer.js";

export interface LabelledBlockEntry<T> {
  name: string;
  value: T;
  range: SourceRange;
}

interface LabelledBlockOptions<T> {
  parseValue: (nameToken: Token) => T;
  parseDefaultValue?: (nameToken: Token) => T;
  fieldNameMessage: string;
}

export function parseLabelledBlock<T extends { range: SourceRange }>(
  parser: ContractParserHost,
  options: LabelledBlockOptions<T>,
): { entries: LabelledBlockEntry<T>[]; range: SourceRange } {
  const start = parser.consume("{").range.start;
  const entries: LabelledBlockEntry<T>[] = [];
  while (!parser.check("}") && !parser.isAtEnd()) {
    entries.push(parseLabelledBlockEntry(parser, options));
    parser.consumeContractBlockEntrySeparator("}");
  }

  parser.consume("}");
  return {
    entries,
    range: { start, end: parser.previous().range.end },
  };
}

function parseLabelledBlockEntry<T extends { range: SourceRange }>(
  parser: ContractParserHost,
  options: LabelledBlockOptions<T>,
): LabelledBlockEntry<T> {
  const nameToken = parser.consumeIdentifier(options.fieldNameMessage);
  const start = nameToken.range.start;
  const value = parser.match(":") ? options.parseValue(nameToken) : parseLabelOnlyEntry(parser, nameToken, options);
  return {
    name: nameToken.value,
    value,
    range: { start, end: value.range.end },
  };
}

function parseLabelOnlyEntry<T extends { range: SourceRange }>(
  parser: ContractParserHost,
  nameToken: Token,
  options: LabelledBlockOptions<T>,
): T {
  if (!parser.check("}") && !parser.check(",") && !isNewLineBetween(nameToken, parser.peek())) {
    throw parser.error("Expected ':' after contract field name");
  }
  if (!options.parseDefaultValue) {
    throw parser.errorAtRange("Label-only contract fields are not allowed in this contract", nameToken.range);
  }
  return options.parseDefaultValue(nameToken);
}
