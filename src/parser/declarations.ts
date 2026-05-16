import type { AgentDecl, ConfigDecl, FuncDecl, FuncParam, ImportDecl, UseDecl } from "../ast/types.js";
import { ANONYMOUS_MAIN_AGENT, ANONYMOUS_MAIN_FUNC } from "../language/entry.js";
import { isImportResourceKind } from "../language/bindings.js";
import type { DeclarationParserHost } from "./host.js";
import { parseContractObject } from "./parse-contract.js";

export function parseImportDecl(parser: DeclarationParserHost): ImportDecl {
  const start = parser.consume("import").range.start;
  const resourceToken = parser.consumeIdentifier("Expected import resource kind");
  const resourceKind = resourceToken.value;
  if (!isImportResourceKind(resourceKind)) {
    throw parser.errorAt(
      "Expected import resource kind 'tool', 'llm', 'file', 'agent', or 'memory'",
      resourceToken.range.start,
    );
  }
  const name = parser.consumeIdentifier(`Expected ${resourceKind} name`).value;
  parser.consume("from");
  const uri = parser.consumeKind("string", `Expected ${resourceKind} URI`).value;

  return {
    kind: "ImportDecl",
    resourceKind,
    name,
    uri,
    range: { start, end: parser.previous().range.end },
  };
}

export function parseAgentDecl(parser: DeclarationParserHost): AgentDecl {
  const mainToken = parser.match("main") ? parser.previous() : undefined;
  const start = (mainToken ?? parser.peek()).range.start;
  const isMain = Boolean(mainToken);
  parser.consume("agent");
  const name = parser.check("{") ? ANONYMOUS_MAIN_AGENT : parser.consumeIdentifier("Expected agent name").value;
  if (!isMain && name === ANONYMOUS_MAIN_AGENT) {
    throw parser.error("Only main agent can omit its name");
  }
  parser.consume("{");

  const config: ConfigDecl[] = [];
  const uses: UseDecl[] = [];
  const functions: FuncDecl[] = [];
  let seenFunction = false;

  while (!parser.check("}") && !parser.isAtEnd()) {
    if (parser.isConfigKey(parser.peek().value)) {
      if (seenFunction) {
        throw parser.error("Agent-level configuration must appear before function declarations");
      }
      config.push(parser.parseConfigDecl());
    } else if (parser.check("use")) {
      if (seenFunction) {
        throw parser.error("Agent-level use declarations must appear before function declarations");
      }
      uses.push(parser.parseUse());
    } else if (parser.check("func") || parser.check("main")) {
      seenFunction = true;
      functions.push(parseFuncDecl(parser));
    } else {
      throw parser.error("Expected configuration declaration, use declaration, or function declaration");
    }
  }

  parser.consume("}");
  return {
    kind: "AgentDecl",
    name,
    isMain,
    config,
    uses,
    functions,
    range: { start, end: parser.previous().range.end },
  };
}

function parseFuncDecl(parser: DeclarationParserHost): FuncDecl {
  const mainToken = parser.match("main") ? parser.previous() : undefined;
  const start = (mainToken ?? parser.peek()).range.start;
  const isMain = Boolean(mainToken);
  parser.consume("func");
  const name = parser.check("(") ? ANONYMOUS_MAIN_FUNC : parser.consumeIdentifier("Expected function name").value;
  if (!isMain && name === ANONYMOUS_MAIN_FUNC) {
    throw parser.error("Only main func can omit its name");
  }
  parser.consume("(");
  const params = parser.parseCommaSeparatedUntil(")", () => parseFuncParam(parser));
  parser.consume(")");
  const body = parser.parseBlock();

  return {
    kind: "FuncDecl",
    name,
    isMain,
    params,
    body,
    range: { start, end: parser.previous().range.end },
  };
}

function parseFuncParam(parser: DeclarationParserHost): FuncParam {
  const token = parser.consumeIdentifier("Expected parameter name");
  const contract = parser.check("{") ? parseContractObject(parser) : undefined;
  return {
    kind: "FuncParam",
    name: token.value,
    contract,
    range: { start: token.range.start, end: (contract ?? token).range.end },
  };
}
