import { describe, expect, it } from "vitest";
import { ParseError } from "../src/parser/errors.js";
import { parse } from "../src/parser/parser.js";

describe("parser generate-shape", () => {
  it("parses generate return shapes", () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return generate({ input: "x", max_output: 2k, debug: true }) -> {
              ok boolean
              facts list[string]
              data json
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
    expect(stmt.value.options.properties.map((property) => property.key)).toEqual(["input", "max_output", "debug"]);
    expect(stmt.value.options.properties.find((p) => p.key === "max_output")?.value).toMatchObject({
      kind: "NumberExpr",
      raw: "2k",
    });
    expect(stmt.value.options.properties.find((p) => p.key === "debug")?.value).toMatchObject({
      kind: "BooleanExpr",
      value: true,
    });
    expect(stmt.value.returnShape).toBeDefined();
  });

  it("defaults untyped generate return shape fields to string", () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return generate({ input: "x" }) -> {
              title
              summary
              confidence number
              tags list[string]
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
      stmt.value.returnShape?.fields.map((field) => ({
        name: field.name,
        kind: field.type.kind,
        typeName: field.type.kind === "NamedShapeType" ? field.type.name : undefined,
      })),
    ).toEqual([
      { name: "title", kind: "NamedShapeType", typeName: "string" },
      { name: "summary", kind: "NamedShapeType", typeName: "string" },
      { name: "confidence", kind: "NamedShapeType", typeName: "number" },
      { name: "tags", kind: "ListShapeType", typeName: undefined },
    ]);
  });

  it("allows comma-terminated default string fields in generate return shapes", () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return generate({ input: "x" }) -> {
              title,
              summary,
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
    expect(stmt.value.returnShape?.fields.map((field) => field.type)).toEqual([
      expect.objectContaining({ kind: "NamedShapeType", name: "string" }),
      expect.objectContaining({ kind: "NamedShapeType", name: "string" }),
    ]);
  });

  it("requires explicit types outside generate return shapes", () => {
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
    ).toThrow(ParseError);
  });

  it("keeps same-line shape type typos as parse errors", () => {
    let error: unknown;
    try {
      parse(`
        main agent A {
          main func act(input) {
            return generate({ input: "x" }) -> {
                confidence nubmer
            }
          }
        }
      `);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ParseError);
    expect((error as ParseError).message).toContain("Unsupported shape type 'nubmer'");
    expect((error as ParseError).range.end.column).toBeGreaterThan((error as ParseError).range.start.column);
  });

  it("parses generate without a return shape", () => {
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
    expect(stmt.value.returnShape).toBeUndefined();
  });

  it("parses input shape on function parameters", () => {
    const ast = parse(`
      agent A {
        main func(input {
          question string
          options json
        }) {
          return input.question
        }
      }
    `);

    const param = ast.agents[0]!.functions[0]!.params[0]!;
    expect(param.name).toBe("input");
    expect(param.shape?.fields.map((field) => field.name)).toEqual(["question", "options"]);
  });
});
