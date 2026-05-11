import { describe, expect, it } from "vitest";
import { ParseError } from "../src/parser/errors.js";
import { parse } from "../src/parser/parser.js";

describe("parser expressions", () => {
  it("parses less-than as a comparison expression", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          if input.count < 3 {
            return true
          }
          return false
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("IfStmt");
    if (stmt.kind !== "IfStmt") return;
    expect(stmt.condition).toMatchObject({
      kind: "BinaryExpr",
      operator: "<",
    });
  });

  it("parses subtraction without requiring surrounding spaces", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          return input.total-input.used
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("ReturnStmt");
    if (stmt.kind !== "ReturnStmt") return;
    expect(stmt.value).toMatchObject({
      kind: "BinaryExpr",
      operator: "-",
    });
  });

  it("parses arithmetic before comparison", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          return input.count + 1 > 3
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("ReturnStmt");
    if (stmt.kind !== "ReturnStmt") return;
    expect(stmt.value).toMatchObject({
      kind: "BinaryExpr",
      operator: ">",
      left: {
        kind: "BinaryExpr",
        operator: "+",
      },
    });
  });

  it("parses factor operators before term operators", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          return 1 + 2 * 3 <= 7
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("ReturnStmt");
    if (stmt.kind !== "ReturnStmt") return;
    expect(stmt.value).toMatchObject({
      kind: "BinaryExpr",
      operator: "<=",
      left: {
        kind: "BinaryExpr",
        operator: "+",
        right: {
          kind: "BinaryExpr",
          operator: "*",
        },
      },
    });
  });

  it("rejects budget literals outside budget positions", () => {
    expect(() =>
      parse(`
      agent A {
        func act(input) {
          return 2k
        }
      }
    `),
    ).toThrow("Invalid number literal '2k'");
  });

  it("rejects object literals with missing commas", () => {
    expect(() =>
      parse(`
      agent A {
        func act(input) {
          return {
            ok: true
            text: "missing comma"
          }
        }
      }
    `),
    ).toThrow(ParseError);
  });

  it("rejects list items and call arguments with missing commas", () => {
    expect(() =>
      parse(`
      agent A {
        func act(input) {
          return [1 2]
        }
      }
    `),
    ).toThrow(ParseError);

    expect(() =>
      parse(`
      agent A {
        func act(input) {
          return run(1 2)
        }
      }
    `),
    ).toThrow(ParseError);
  });

  it("rejects same-line shape fields with missing separators", () => {
    expect(() =>
      parse(`
      agent A {
        func act(input) {
          return generate({ input: "x" }) -> { ok boolean facts string }
        }
      }
    `),
    ).toThrow("Expected ',' or newline between shape fields");
  });

  it("parses list index access as a postfix expression", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          return input.steps[0].id
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("ReturnStmt");
    if (stmt.kind !== "ReturnStmt") return;
    expect(stmt.value).toMatchObject({
      kind: "MemberExpr",
      property: "id",
      object: {
        kind: "IndexExpr",
        index: {
          kind: "NumberExpr",
          value: 0,
        },
      },
    });
  });

  it("rejects list index assignment at parse time", () => {
    expect(() =>
      parse(`
      agent A {
        func act(input) {
          list[0] = "x"
          return input
        }
      }
    `),
    ).toThrow(ParseError);
  });
});
