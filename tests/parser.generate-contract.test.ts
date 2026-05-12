import { describe, expect, it } from "vitest";
import { ParseError } from "../src/parser/errors.js";
import { parse } from "../src/parser/parser.js";

describe("parser generate-contract", () => {
  it("parses generate return contracts", () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return generate({ input: "x", max_output: 2k, debug: true }) -> {
              ok: boolean
              facts: list[string]
              data: json
          }
        }
      }
    `);

    const func = ast.agents[0]!.functions[0]!;
    const stmt = func.body[0]!;
    expect(stmt.kind).toBe("ReturnStmt");
    if (stmt.kind !== "ReturnStmt") return;
    expect(stmt.value.kind).toBe("GenerateExpr");
    if (stmt.value.kind !== "GenerateExpr") return;
    expect(stmt.value.options.maxOutput).toEqual({ amount: 2, unit: "k" });
    expect(stmt.value.options.properties.map((property) => property.key)).toEqual(["input", "debug"]);
    expect(stmt.value.options.properties.find((p) => p.key === "debug")?.value).toMatchObject({
      kind: "BooleanExpr",
      value: true,
    });
    expect(stmt.value.returnContract).toBeDefined();
  });

  it("defaults untyped generate return contract fields to string", () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return generate({ input: "x" }) -> {
              title
              summary
              confidence: number
              tags: list[string]
          }
        }
      }
    `);

    const func = ast.agents[0]!.functions[0]!;
    const stmt = func.body[0]!;
    expect(stmt.kind).toBe("ReturnStmt");
    if (stmt.kind !== "ReturnStmt") return;
    expect(stmt.value.kind).toBe("GenerateExpr");
    if (stmt.value.kind !== "GenerateExpr") return;
    expect(
      stmt.value.returnContract?.fields.map((field) => ({
        name: field.name,
        kind: field.type.kind,
        typeName: field.type.kind === "NamedContractType" ? field.type.name : undefined,
      })),
    ).toEqual([
      { name: "title", kind: "NamedContractType", typeName: "string" },
      { name: "summary", kind: "NamedContractType", typeName: "string" },
      { name: "confidence", kind: "NamedContractType", typeName: "number" },
      { name: "tags", kind: "ListContractType", typeName: undefined },
    ]);
  });

  it("rejects comma-separated contract fields", () => {
    expect(() =>
      parse(`
      main agent A {
        main func act(input) {
          return generate({ input: "x" }) -> {
              title,
              summary,
          }
        }
      }
    `),
    ).toThrow("Commas are not allowed between contract fields");
  });

  it("rejects label-only input contract fields", () => {
    expect(() =>
      parse(`
        main agent A {
          main func act(input {
              path
          }) {
            return input
          }
        }
      `),
    ).toThrow("Label-only contract fields are not allowed in this contract");
  });

  it("rejects duplicate max_output generate options", () => {
    expect(() =>
      parse(`
        main agent A {
          main func act(input) {
            return generate({ input: "x", max_output: 100, max_output: 200 }) -> {
                ok: boolean
            }
          }
        }
      `),
    ).toThrow(ParseError);
  });

  it("keeps same-line contract type typos as parse errors", () => {
    let error: unknown;
    try {
      parse(`
        main agent A {
          main func act(input) {
            return generate({ input: "x" }) -> {
                confidence: nubmer
            }
          }
        }
      `);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ParseError);
    expect((error as ParseError).message).toContain("Unsupported contract type 'nubmer'");
    expect((error as ParseError).range.end.column).toBeGreaterThan((error as ParseError).range.start.column);
  });

  it("parses generate without a return contract", () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return generate({ input: "x" })
        }
      }
    `);

    const func = ast.agents[0]!.functions[0]!;
    const stmt = func.body[0]!;
    expect(stmt.kind).toBe("ReturnStmt");
    if (stmt.kind !== "ReturnStmt") return;
    expect(stmt.value.kind).toBe("GenerateExpr");
    if (stmt.value.kind !== "GenerateExpr") return;
    expect(stmt.value.returnContract).toBeUndefined();
  });

  it("parses input contract on function parameters", () => {
    const ast = parse(`
      agent A {
        main func(input {
          question: string
          options: json
        }) {
          return input.question
        }
      }
    `);

    const param = ast.agents[0]!.functions[0]!.params[0]!;
    expect(param.name).toBe("input");
    expect(param.contract?.fields.map((field) => field.name)).toEqual(["question", "options"]);
  });
});
