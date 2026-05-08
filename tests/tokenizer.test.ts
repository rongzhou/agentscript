import { describe, expect, it } from "vitest";
import { tokenize } from "../src/parser/tokenizer.js";

describe("tokenize", () => {
  it("tokenizes AgentScript symbols, strings, identifiers, and budgets", () => {
    const tokens = tokenize('repeat * 2 { for item in items < 3 { if ok == true and not stale { use scratch.summary < 2k } else { message != "hello" } } }');
    expect(tokens.map((token) => token.value)).toEqual([
      "repeat",
      "*",
      "2",
      "{",
      "for",
      "item",
      "in",
      "items",
      "<",
      "3",
      "{",
      "if",
      "ok",
      "==",
      "true",
      "and",
      "not",
      "stale",
      "{",
      "use",
      "scratch",
      ".",
      "summary",
      "<",
      "2k",
      "}",
      "else",
      "{",
      "message",
      "!=",
      "hello",
      "}",
      "}",
      "}",
      ""
    ]);
  });

  it("tokenizes shape type names as keywords", () => {
    const tokens = tokenize("string number boolean json list");
    expect(tokens.map((token) => token.kind)).toEqual(["keyword", "keyword", "keyword", "keyword", "keyword", "eof"]);
  });
});
