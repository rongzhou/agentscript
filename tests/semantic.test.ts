import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { analyze, assertSemanticallyValid } from "../src/semantic/analyzer.js";
import { SemanticError } from "../src/semantic/diagnostics.js";

describe("analyze", () => {
  it("accepts the V0 regression fixture", () => {
    const source = readFileSync("fixtures/v0.as", "utf8");
    const result = analyze(parse(source));

    expect(result.diagnostics).toEqual([]);
  });

  it("reports unknown identifiers", () => {
    const result = analyze(
      parse(`
        main agent A {
          main func act(input) {
            use missing.value
            return input
          }
        }
      `)
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_IDENTIFIER"
      })
    );
  });

  it("reports duplicate functions and duplicate generate return fields", () => {
    const result = analyze(
      parse(`
        main agent A {
          main func act(input) {
            return generate({ input: "x" }) {
              return {
                ok boolean
                ok string
              }
            }
          }

          func act(input) {
            return input
          }
        }
      `)
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["DUPLICATE_FUNCTION", "DUPLICATE_SHAPE_FIELD"])
    );
  });


  it("reports parameters that shadow imported bindings", () => {
    const result = analyze(
      parse(`
        import tool Search from "sh://grep"

        main agent A {
          main func act(Search) {
            return Search
          }
        }
      `)
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "PARAM_SHADOWS_IMPORT"
      })
    );
  });

  it("throws from assertSemanticallyValid when errors exist", () => {
    expect(() =>
      assertSemanticallyValid(
        parse(`
          agent A {
            func act(input) {
              return missing
            }
          }
        `)
      )
    ).toThrow(SemanticError);
  });

  it("reports invalid use budgets", () => {
    const result = analyze(
      parse(`
        agent A {
          func act(input) {
            use input < 0
            return input
          }
        }
      `)
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_BUDGET"
      })
    );
  });

  it("checks memory resources and methods", () => {
    const valid = analyze(
      parse(`
        import memory Lessons from "file://./.agentscript/lessons.jsonl"

        main agent A {
          main func(input) {
            Lessons.add({ kind: "lesson", text: "one" })
            return Lessons.query({ kind: "lesson", limit: 5 })
          }
        }
      `)
    );
    expect(valid.diagnostics).toEqual([]);

    const invalidUse = analyze(
      parse(`
        import memory Lessons from "file://./.agentscript/lessons.jsonl"

        main agent A {
          main func(input) {
            use Lessons
            return input
          }
        }
      `)
    );
    expect(invalidUse.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_USE_RESOURCE"
      })
    );

    const invalidMethod = analyze(
      parse(`
        import memory Lessons from "file://./.agentscript/lessons.jsonl"

        main agent A {
          main func(input) {
            return Lessons.delete({ id: "1" })
          }
        }
      `)
    );
    expect(invalidMethod.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_MEMORY_METHOD"
      })
    );

    const invalidArity = analyze(
      parse(`
        import memory Lessons from "file://./.agentscript/lessons.jsonl"

        main agent A {
          main func(input) {
            return Lessons.query()
          }
        }
      `)
    );
    expect(invalidArity.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_ARGUMENT_COUNT"
      })
    );
  });

  it("checks scoped configuration declarations", () => {
    const unknown = analyze(
      parse(`
        agent A {
          model Qwen

          func act(input) {
            return input
          }
        }
      `)
    );

    expect(unknown.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_MODEL"
      })
    );

    const wrongKind = analyze(
      parse(`
        import tool Search from "mcp://tools/search"

        agent A {
          model Search

          func act(input) {
            return input
          }
        }
      `)
    );

    expect(wrongKind.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_MODEL"
      })
    );

    const invalidRole = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"

        agent A {
          model Qwen
          role 123

          func act(input) {
            return input
          }
        }
      `)
    );
    expect(invalidRole.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_CONFIG"
      })
    );
  });

  it("requires generate to have model, role, and description in scope", () => {
    const missing = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"

        main agent A {
          main func act(input) {
            return generate({ input: "x" }) {
              return {
                ok boolean
              }
            }
          }
        }
      `)
    );

    expect(missing.diagnostics.filter((diagnostic) => diagnostic.code === "MISSING_GENERATE_CONFIG")).toHaveLength(3);

    const scoped = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"

        main agent A {
          main func act(input) {
            model Qwen
            role "Assistant"
            description "Answer."
            return generate({ input: "x" }) {
              return {
                ok boolean
              }
            }
          }
        }
      `)
    );

    expect(scoped.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("checks generate limit and debug options", () => {
    const result = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"

        main agent A {
          model Qwen
          role "Assistant"
          description "Validate generate options."

          main func act(input) {
            return generate({ input: "x", limit: 0, debug: "yes" }) {
              return {
                ok boolean
              }
            }
          }
        }
      `)
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "INVALID_GENERATE_LIMIT"
        }),
        expect.objectContaining({
          severity: "error",
          code: "INVALID_GENERATE_DEBUG"
        })
      ])
    );
  });

  it("checks main agent and main func rules", () => {
    const missingMainAgent = analyze(
      parse(`
        agent A {
          func act(input) {
            return input
          }
        }

        agent B {
          func act(input) {
            return input
          }
        }
      `)
    );
    expect(missingMainAgent.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "MISSING_MAIN_AGENT"
      })
    );

    const duplicateMain = analyze(
      parse(`
        main agent A {
          main func(input) {
            return input
          }
        }

        main agent B {
          main func(input) {
            return input
          }
        }
      `)
    );
    expect(duplicateMain.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "DUPLICATE_MAIN_AGENT"
      })
    );

    const missingMainFunc = analyze(
      parse(`
        main agent A {
          func act(input) {
            return input
          }
        }
      `)
    );
    expect(missingMainFunc.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "MISSING_MAIN_FUNC"
      })
    );
  });

  it("allows agent call shorthand in multi-agent programs", () => {
    const result = analyze(
      parse(`
        main agent App {
          main func(input) {
            return Worker(input)
          }
        }

        agent Worker {
          main func work(input) {
            return input
          }
        }
      `)
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("requires agent call shorthand targets to declare main func", () => {
    const result = analyze(
      parse(`
        main agent App {
          main func(input) {
            return Worker(input)
          }
        }

        agent Worker {
          func act(input) {
            return input
          }
        }
      `)
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_FUNCTION",
        message: "Agent 'Worker' has no callable main func"
      })
    );
  });

  it("checks user function and agent call argument counts", () => {
    const result = analyze(
      parse(`
        main agent App {
          main func(input) {
            local = helper(input, input)
            remote = Worker(input, input)
            return Worker.run(input, input)
          }

          func helper(value) {
            return value
          }
        }

        agent Worker {
          main func run(input) {
            return input
          }
        }
      `)
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "INVALID_ARGUMENT_COUNT")).toHaveLength(3);
  });

  it("does not allow runtime capabilities to be used as prompt context", () => {
    const result = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"
        import tool Search from "mcp://tools/search"

        agent A {
          model Qwen

          func helper(input) {
            return input
          }

          func act(input) {
            use Qwen
            use Search
            use helper
            return input
          }
        }
      `)
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "INVALID_USE_RESOURCE")).toHaveLength(3);
  });

  it("checks input parameter shapes", () => {
    const duplicate = analyze(
      parse(`
        agent A {
          main func(input {
            question string
            question json
          }) {
            return input.question
          }
        }
      `)
    );
    expect(duplicate.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "DUPLICATE_SHAPE_FIELD"
      })
    );

    const invalidType = analyze(
      parse(`
        agent A {
          main func(input {
            question string
          }) {
            return input.question
          }
        }
      `)
    );
    expect(invalidType.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const nonEntryShape = analyze(
      parse(`
        agent A {
          func helper(value {
            question string
          }) {
            return value
          }

          func act(input) {
            return helper(input)
          }
        }
      `)
    );
    expect(nonEntryShape.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_PARAM_SHAPE"
      })
    );
  });

  it("reports functions that conflict with imported resource names", () => {
    const result = analyze(
      parse(`
        import tool Search from "mcp://tools/search"

        agent A {
          func Search(input) {
            return input
          }

          func act(input) {
            return input
          }
        }
      `)
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "DUPLICATE_BINDING"
      })
    );
  });

  it("allows imported files as ordinary context values", () => {
    const result = analyze(
      parse(`
        import file Requirements from "./requirements.md"

        main agent A {
          main func(input) {
            use Requirements < 2k
            return Requirements
          }
        }
      `)
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("scopes for-in item variables to the loop body", () => {
    const result = analyze(
      parse(`
        main agent A {
          main func(input) {
            items = [input]
            for item in items < 3 {
              value = item
            }
            return item
          }
        }
      `)
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_IDENTIFIER"
      })
    );
  });

  it("checks expressions used inside list indexes", () => {
    const result = analyze(
      parse(`
        main agent A {
          main func(input) {
            items = [input]
            return items[missing]
          }
        }
      `)
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_IDENTIFIER"
      })
    );
  });
});
