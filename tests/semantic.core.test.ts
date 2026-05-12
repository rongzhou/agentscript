import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { analyze, assertSemanticallyValid } from "../src/semantic/analyzer.js";
import { SemanticError } from "../src/semantic/diagnostics.js";

describe("semantic core", () => {
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
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_IDENTIFIER",
      }),
    );
  });

  it("reports duplicate functions and duplicate generate return fields", () => {
    const result = analyze(
      parse(`
        main agent A {
          main func act(input) {
            return generate({ input: "x" }) -> {
                ok: boolean
                ok: string
            }
          }

          func act(input) {
            return input
          }
        }
      `),
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["DUPLICATE_FUNCTION", "DUPLICATE_CONTRACT_FIELD"]),
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
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "PARAM_SHADOWS_IMPORT",
      }),
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
        `),
      ),
    ).toThrow(SemanticError);
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
      `),
    );
    expect(missingMainAgent.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "MISSING_MAIN_AGENT",
      }),
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
      `),
    );
    expect(duplicateMain.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "DUPLICATE_MAIN_AGENT",
      }),
    );

    const missingMainFunc = analyze(
      parse(`
        main agent A {
          func act(input) {
            return input
          }
        }
      `),
    );
    expect(missingMainFunc.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "MISSING_MAIN_FUNC",
      }),
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
      `),
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
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_FUNCTION",
        message: "Agent 'Worker' has no callable main func",
      }),
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
      `),
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "INVALID_ARGUMENT_COUNT")).toHaveLength(3);
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
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "DUPLICATE_BINDING",
      }),
    );
  });

  it("reports agents that conflict with imported resource names", () => {
    const result = analyze(
      parse(`
        import tool Worker from "mcp://worker"

        main agent App {
          main func(input) {
            return input
          }
        }

        agent Worker {
          main func(input) {
            return input
          }
        }
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "DUPLICATE_BINDING",
      }),
    );
  });

  it("reports assignments to immutable imported and function bindings", () => {
    const result = analyze(
      parse(`
        import tool Search from "mcp://tools/search"

        main agent A {
          main func(input) {
            Search = "local"
            helper = "local"
            return input
          }

          func helper(input) {
            return input
          }
        }
      `),
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "IMMUTABLE_ASSIGNMENT")).toHaveLength(2);
  });

  it("checks assignment values before defining new locals", () => {
    const result = analyze(
      parse(`
        main agent A {
          main func(input) {
            value = value
            return input
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

  it("scopes for-in item variables to the loop body", () => {
    const result = analyze(
      parse(`
        main agent A {
          main func(input) {
            items = [input]
            for item in items max 3 {
              value = item
            }
            return item
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

  it("checks expressions used inside list indexes", () => {
    const result = analyze(
      parse(`
        main agent A {
          main func(input) {
            items = [input]
            return items[missing]
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
});
