import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { buildContext, shapeToSchema } from "../src/runtime/context.js";

describe("buildContext", () => {
  it("builds system prompt, clipped context, final instruction, and schema", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          return generate({ input: "answer" }) -> {
              ok boolean
              text string
              facts list[string]
          }
        }
      }
    `);
    const generate = ast.agents[0]!.functions[0]!.body[0]!;
    if (generate.kind !== "ReturnStmt" || generate.value.kind !== "GenerateExpr") {
      throw new Error("unexpected test AST");
    }

    const context = buildContext({
      agentName: "A",
      identity: { role: "Researcher" },
      instruction: "answer",
      returnShape: generate.value.returnShape,
      uses: [{ source: "input.text", label: "evidence", value: "abcdefghijklmnopqrstuvwxyz", budget: { amount: 5 } }],
      maxOutput: { amount: 100 }
    });

    expect(context.system).toContain("You are Researcher.");
    expect(context.context[0]).toMatchObject({
      text: "abcde",
      source: "input.text",
      label: "evidence",
      clipped: true,
      originalSize: 26,
      clippedSize: 5
    });
    expect(context.finalUserMessage).toContain("[evidence]");
    expect(context.finalUserMessage).toContain("source: input.text");
    expect(context.finalUserMessage).toContain("Instruction:");
    expect(context.finalUserMessage).toContain("Return JSON matching this schema:");
    expect(context.returnSchema).toMatchObject({
      type: "object",
      additionalProperties: false
    });
  });

  it("clips lists and objects without splitting items or fields", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          return generate({ input: "answer" }) -> {
              ok boolean
          }
        }
      }
    `);
    const generate = ast.agents[0]!.functions[0]!.body[0]!;
    if (generate.kind !== "ReturnStmt" || generate.value.kind !== "GenerateExpr") {
      throw new Error("unexpected test AST");
    }

    const context = buildContext({
      agentName: "A",
      identity: {},
      instruction: "answer",
      returnShape: generate.value.returnShape,
      uses: [
        { source: "items", value: ["alpha", "beta", "gamma"], budget: { amount: 25 } },
        { source: "object", value: { first: "alpha", second: "beta" }, budget: { amount: 25 } }
      ]
    });

    expect(context.context[0]!.value).toEqual(["alpha", "beta"]);
    expect(context.context[1]!.value).toEqual({ first: "alpha" });
    expect(context.context[0]!.clippedSize).toBeLessThan(context.context[0]!.originalSize);
    expect(context.context[1]!.clippedSize).toBeLessThan(context.context[1]!.originalSize);
  });
});

describe("shapeToSchema", () => {
  it("converts AgentScript generate shape to JSON schema-like structure", () => {
    const ast = parse(`
      agent A {
        func act(input) {
          return generate({ input: "x" }) -> {
              items list[string]
              score number
              data json
          }
        }
      }
    `);
    const stmt = ast.agents[0]!.functions[0]!.body[0]!;
    if (stmt.kind !== "ReturnStmt" || stmt.value.kind !== "GenerateExpr") {
      throw new Error("unexpected test AST");
    }
    if (!stmt.value.returnShape) {
      throw new Error("unexpected missing return shape");
    }

    expect(shapeToSchema(stmt.value.returnShape)).toMatchObject({
      properties: {
        items: {
          type: "array",
          items: { type: "string" }
        },
        score: {
          type: "number"
        },
        data: {}
      },
      required: ["items", "score", "data"]
    });
  });
});
