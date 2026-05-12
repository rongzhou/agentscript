import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { analyze } from "../src/semantic/analyzer.js";

describe("semantic use", () => {
  it("reports invalid use budgets", () => {
    const result = analyze(
      parse(`
        agent A {
          func act(input) {
            use input max 0
            return input
          }
        }
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_BUDGET",
      }),
    );
  });

  it("reports unsupported budget units", () => {
    const result = analyze(
      parse(`
        agent A {
          func act(input) {
            use input max 2K
            return input
          }
        }
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_BUDGET_UNIT",
      }),
    );
  });

  it("reports reserved context labels", () => {
    const result = analyze(
      parse(`
        agent A {
          func act(input) {
            use input as system
            return input
          }
        }
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "RESERVED_CONTEXT_LABEL",
      }),
    );
  });

  it("checks agent-level use declarations are declarative file context", () => {
    const valid = analyze(
      parse(`
        import file Playbook from "./playbook.md"

        agent A {
          use Playbook as playbook

          main func act(input) {
            return input
          }
        }
      `),
    );
    expect(valid.diagnostics).toEqual([]);

    const invalidLocal = analyze(
      parse(`
        agent A {
          use input.question as question

          func act(input) {
            return input
          }
        }
      `),
    );
    expect(invalidLocal.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_IDENTIFIER",
      }),
    );

    const invalidCall = analyze(
      parse(`
        import file Playbook from "./playbook.md"

        agent A {
          use Playbook.trim() as playbook

          func act(input) {
            return input
          }
        }
      `),
    );
    expect(invalidCall.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_USE_CALL",
      }),
    );
  });

  it("rejects call expressions in use declarations", () => {
    const result = analyze(
      parse(`
        import memory Lessons from "file://./.agentscript/lessons.jsonl"

        agent A {
          func act(input) {
            use Lessons.query({ kind: "lesson" }) as lessons
            return input
          }
        }
      `),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_USE_CALL",
      }),
    );
  });

  it("checks use declarations without traversing nested expression scopes as outer context", () => {
    const result = analyze(
      parse(`
        import tool Search from "sh://grep"

        agent A {
          func act(input) {
            use parallel for Search in input.items max 2 {
              Search
            } as values
            return input
          }
        }
      `),
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "INVALID_USE_CALL")).toHaveLength(1);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "INVALID_USE_RESOURCE")).toHaveLength(0);
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
            use { capability: Search }
            use helper
            return input
          }
        }
      `),
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "INVALID_USE_RESOURCE")).toHaveLength(4);
  });

  it("allows imported files as ordinary context values", () => {
    const result = analyze(
      parse(`
        import file Requirements from "./requirements.md"

        main agent A {
          main func(input) {
            use Requirements max 2k
            return Requirements
          }
        }
      `),
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("checks use one of candidates like use declarations", () => {
    const invalid = analyze(
      parse(`
        import tool Search from "host://search"

        agent A {
          func act(input) {
            use one of {
              live: Search.search(input.question)
              cached: input.docs max 0
            } as evidence
            return input
          }
        }
      `),
    );

    expect(invalid.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", code: "INVALID_USE_CALL" }),
        expect.objectContaining({ severity: "error", code: "INVALID_USE_RESOURCE" }),
        expect.objectContaining({ severity: "error", code: "INVALID_BUDGET" }),
      ]),
    );
  });

  it("checks agent-level use one of candidates are declarative file context", () => {
    const result = analyze(
      parse(`
        import file Playbook from "./playbook.md"

        agent A {
          use one of {
            short: Playbook
            invalid: input.docs
          } as playbook

          func act(input) {
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

  it("reports duplicate use one of candidates and reserved shared labels", () => {
    const result = analyze(
      parse(`
        agent A {
          func act(input) {
            use one of {
              compact: input.digest
              compact: input.summary
            } as system
            return input
          }
        }
      `),
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", code: "DUPLICATE_USE_ONE_OF_CANDIDATE" }),
        expect.objectContaining({ severity: "error", code: "RESERVED_CONTEXT_LABEL" }),
      ]),
    );
  });
});
