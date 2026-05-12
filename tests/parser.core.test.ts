import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ParseError } from "../src/parser/errors.js";
import { parse } from "../src/parser/parser.js";

describe("parser core", () => {
  it("parses the V0 regression fixture", () => {
    const source = readFileSync("fixtures/v0.as", "utf8");
    const ast = parse(source);

    expect(ast.imports).toHaveLength(2);
    expect(ast.imports[0]).toMatchObject({
      kind: "ImportDecl",
      resourceKind: "llm",
      name: "Qwen",
      uri: "ollama://localhost:11434/qwen3.6",
    });
    expect(ast.imports[1]).toMatchObject({
      kind: "ImportDecl",
      resourceKind: "tool",
      name: "Search",
      uri: "mcp://tools/search",
    });

    expect(ast.agents).toHaveLength(1);
    const agent = ast.agents[0]!;
    expect(agent.name).toBe("ResearchAgent");
    expect(agent.isMain).toBe(true);
    expect(agent.config.map((item) => item.key)).toEqual(["model", "role", "description"]);
    expect(agent.config[0]).toMatchObject({
      kind: "ConfigDecl",
      key: "model",
    });
    expect(agent.functions.map((fn) => fn.name)).toEqual(["__main", "reason", "act", "observe", "enough", "answer"]);

    const act = agent.functions[0]!;
    expect(act.isMain).toBe(true);
    expect(act.params.map((param) => param.name)).toEqual(["input"]);
    expect(act.params[0]!.contract?.fields[0]).toMatchObject({
      name: "question",
      type: {
        kind: "NamedContractType",
        name: "string",
      },
    });
    expect(act.body.some((stmt) => stmt.kind === "LoopUntilStmt")).toBe(true);
  });

  it("parses final expressions as expression statements", () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          use input.question
          generate({ input: "x" }) -> {
              ok: boolean
          }
        }
      }
    `);

    const body = ast.agents[0]!.functions[0]!.body;
    expect(body[0]!.kind).toBe("UseStmt");
    expect(body[1]!.kind).toBe("ExprStmt");
    if (body[1]!.kind !== "ExprStmt") return;
    expect(body[1]!.expr.kind).toBe("GenerateExpr");
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
      isMain: true,
    });
    expect(ast.agents[0]!.functions[0]).toMatchObject({
      name: "__main",
      isMain: true,
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
      uri: "openai://gpt-4.1-mini",
    });
    expect(ast.agents[0]!.config.map((item) => item.key)).toEqual(["model", "role", "description"]);
    expect(ast.agents[0]!.functions[0]!.body[0]).toMatchObject({
      kind: "ConfigDecl",
      key: "model",
    });
  });

  it("parses file imports", () => {
    const ast = parse(`
      import file Requirements from "./requirements.md"

      main agent A {
        main func(input) {
          use Requirements max 2k
          return input
        }
      }
    `);

    expect(ast.imports[0]).toMatchObject({
      kind: "ImportDecl",
      resourceKind: "file",
      name: "Requirements",
      uri: "./requirements.md",
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
      uri: "file://./.agentscript/lessons.jsonl",
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
      uri: "./agents/planner.as",
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
