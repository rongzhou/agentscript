import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { ParseError } from "../src/parser/errors.js";

describe("parse", () => {
  it("parses the V0 regression fixture", () => {
    const source = readFileSync("fixtures/v0.as", "utf8");
    const ast = parse(source);

    expect(ast.imports).toHaveLength(2);
    expect(ast.imports[0]).toMatchObject({
      kind: "ImportDecl",
      resourceKind: "llm",
      name: "Qwen",
      uri: "ollama://localhost:11434/qwen3.6"
    });
    expect(ast.imports[1]).toMatchObject({
      kind: "ImportDecl",
      resourceKind: "tool",
      name: "Search",
      uri: "mcp://tools/search"
    });

    expect(ast.agents).toHaveLength(1);
    const agent = ast.agents[0]!;
    expect(agent.name).toBe("ResearchAgent");
    expect(agent.isMain).toBe(true);
    expect(agent.config.map((item) => item.key)).toEqual(["model", "role", "description"]);
    expect(agent.config[0]).toMatchObject({
      kind: "ConfigDecl",
      key: "model"
    });
    expect(agent.functions.map((fn) => fn.name)).toEqual([
      "__main",
      "reason",
      "act",
      "observe",
      "enough",
      "answer"
    ]);

    const act = agent.functions[0]!;
    expect(act.isMain).toBe(true);
    expect(act.params.map((param) => param.name)).toEqual(["input"]);
    expect(act.params[0]!.shape?.fields[0]).toMatchObject({
      name: "question",
      type: {
        kind: "NamedShapeType",
        name: "string"
      }
    });
    expect(act.body.some((stmt) => stmt.kind === "LoopUntilStmt")).toBe(true);
  });

  it("parses generate return shapes", () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return generate({ input: "x", limit: 2k, debug: true }) -> {
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
    expect(stmt.value.options.limit).toEqual({ amount: 2, unit: "k" });
    expect(stmt.value.options.debug?.value).toBe(true);
    expect(stmt.value.returnShape).toBeDefined();
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

  it("parses use budgets on the use statement", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          scratch = []
          use scratch.summary < 2k
          return input
        }
      }
    `);

    const useStmt = ast.agents[0]!.functions[0]!.body[1]!;
    expect(useStmt.kind).toBe("UseStmt");
    if (useStmt.kind !== "UseStmt") return;
    expect(useStmt.value.kind).toBe("MemberExpr");
    expect(useStmt.budget).toEqual({ amount: 2, unit: "k" });
  });

  it("parses if else and natural boolean expressions", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          if input.ok == true and not input.stale {
            return "ok"
          } else {
            return "repeat"
          }
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("IfStmt");
    if (stmt.kind !== "IfStmt") return;
    expect(stmt.condition).toMatchObject({
      kind: "BinaryExpr",
      operator: "and"
    });
    expect(stmt.elseBody).toHaveLength(1);
  });

  it("parses for-in list traversal", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          for step in input.steps < 6 {
            use step
          }
          return input
        }
      }
    `);

    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    expect(stmt.kind).toBe("ForInStmt");
    if (stmt.kind !== "ForInStmt") return;
    expect(stmt.itemName).toBe("step");
    expect(stmt.maxIterations).toBe(6);
    expect(stmt.iterable.kind).toBe("MemberExpr");
    expect(stmt.body[0]).toMatchObject({
      kind: "UseStmt"
    });
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
          value: 0
        }
      }
    });
  });


  it("rejects list index assignment at parse time", () => {
    expect(() => parse(`
      agent A {
        func act(input) {
          list[0] = "x"
          return input
        }
      }
    `)).toThrow(ParseError);
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

  it("parses anonymous main agents and anonymous main funcs", () => {
    const ast = parse(`
      main agent {
        main func(input {}) {
          return input
        }
      }
    `);

    expect(ast.agents[0]).toMatchObject({
      name: "__main_agent",
      isMain: true
    });
    expect(ast.agents[0]!.functions[0]).toMatchObject({
      name: "__main",
      isMain: true
    });
  });

  it("parses llm imports and scoped configuration declarations", () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      agent A {
        model Qwen
        role "Assistant"
        description "Test model configuration"

        func act(input) {
          model Qwen
          return input
        }
      }
    `);

    expect(ast.imports[0]).toMatchObject({
      resourceKind: "llm",
      name: "Qwen",
      uri: "openai://gpt-4.1-mini"
    });
    expect(ast.agents[0]!.config.map((item) => item.key)).toEqual(["model", "role", "description"]);
    expect(ast.agents[0]!.functions[0]!.body[0]).toMatchObject({
      kind: "ConfigStmt",
      key: "model"
    });
  });

  it("parses file imports", () => {
    const ast = parse(`
      import file Requirements from "./requirements.md"

      main agent A {
        main func(input) {
          use Requirements < 2k
          return input
        }
      }
    `);

    expect(ast.imports[0]).toMatchObject({
      kind: "ImportDecl",
      resourceKind: "file",
      name: "Requirements",
      uri: "./requirements.md"
    });
  });

  it("parses memory imports", () => {
    const ast = parse(`
      import memory Lessons from "file://./.agentscript/lessons.jsonl"

      main agent A {
        main func(input) {
          return Lessons.query({ limit: 5 })
        }
      }
    `);

    expect(ast.imports[0]).toMatchObject({
      kind: "ImportDecl",
      resourceKind: "memory",
      name: "Lessons",
      uri: "file://./.agentscript/lessons.jsonl"
    });
  });

  it("parses agent imports", () => {
    const ast = parse(`
      import agent Planner from "./agents/planner.as"

      main agent A {
        main func(input) {
          return Planner(input)
        }
      }
    `);

    expect(ast.imports[0]).toMatchObject({
      kind: "ImportDecl",
      resourceKind: "agent",
      name: "Planner",
      uri: "./agents/planner.as"
    });
  });

  it("reports unsupported import resource kinds at the resource token", () => {
    expect(() => parse('import vector M from "vector://m"')).toThrow(ParseError);

    try {
      parse('import vector M from "vector://m"');
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect((error as ParseError).location.column).toBe(8);
    }
  });
});
