import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { analyze } from "../src/semantic/analyzer.js";

describe("semantic config-generate-shape", () => {
  it("checks scoped configuration declarations", () => {
    const unknown = analyze(
      parse(`
        agent A {
          model Qwen

          func act(input) {
            return input
          }
        }
      `),
    );

    expect(unknown.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_MODEL",
      }),
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
      `),
    );

    expect(wrongKind.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_MODEL_BINDING",
      }),
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
      `),
    );
    expect(invalidRole.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_CONFIG_VALUE_TYPE",
      }),
    );
  });

  it("requires generate to have model, role, and description in scope", () => {
    const missing = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"

        main agent A {
          main func act(input) {
            return generate({ input: "x" }) -> {
                ok boolean
            }
          }
        }
      `),
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
            return generate({ input: "x" }) -> {
                ok boolean
            }
          }
        }
      `),
    );

    expect(scoped.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("checks generate options", () => {
    const result = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"

        main agent A {
          model Qwen
          role "Assistant"
          description "Validate generate options."

          main func act(input) {
            return generate({ input: "x", max_output: 0, debug: "yes" }) -> {
                ok boolean
            }
          }
        }
      `),
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "INVALID_GENERATE_MAX_OUTPUT",
        }),
        expect.objectContaining({
          severity: "error",
          code: "INVALID_GENERATE_DEBUG",
        }),
      ]),
    );
  });

  it("checks duplicate max_output generate options", () => {
    const result = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"

        main agent A {
          model Qwen
          role "Assistant"
          description "Validate generate options."

          main func act(input) {
            return generate({ input: "x", max_output: 100, max_output: 200 }) -> {
                ok boolean
            }
          }
        }
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "DUPLICATE_GENERATE_OPTION",
      }),
    );
  });

  it("uses generate-specific diagnostics for invalid max_output units", () => {
    const result = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"

        main agent A {
          model Qwen
          role "Assistant"
          description "Validate generate options."

          main func act(input) {
            return generate({ input: "x", max_output: 2K }) -> {
                ok boolean
            }
          }
        }
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_GENERATE_MAX_OUTPUT_UNIT",
      }),
    );
  });

  it("checks identifiers in all generate option values", () => {
    const result = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"

        main agent A {
          model Qwen
          role "Assistant"
          description "Validate generate option expressions."

          main func act(input) {
            return generate({ input: input.question, temperature: missing.temperature }) -> {
                ok boolean
            }
          }
        }
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_IDENTIFIER",
      }),
    );
  });

  it("checks generate temperature, think, and strict options", () => {
    const result = analyze(
      parse(`
        import llm Qwen from "openai://gpt-4.1-mini"

        main agent A {
          model Qwen
          role "Assistant"
          description "Validate generate options."

          main func act(input) {
            return generate({
              input: "x",
              temperature: "warm",
              think: "extreme",
              strict: "yes"
            }) -> {
                ok boolean
            }
          }
        }
      `),
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", code: "INVALID_GENERATE_TEMPERATURE" }),
        expect.objectContaining({ severity: "error", code: "INVALID_GENERATE_THINK" }),
        expect.objectContaining({ severity: "error", code: "INVALID_GENERATE_STRICT" }),
      ]),
    );
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
      `),
    );
    expect(duplicate.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "DUPLICATE_SHAPE_FIELD",
      }),
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
      `),
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
      `),
    );
    expect(nonEntryShape.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_PARAM_SHAPE",
      }),
    );
  });
});
