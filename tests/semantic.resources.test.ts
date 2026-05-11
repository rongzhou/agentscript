import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { analyze } from "../src/semantic/analyzer.js";

describe("semantic resources", () => {
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
      `),
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
      `),
    );
    expect(invalidUse.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_USE_RESOURCE",
      }),
    );

    const invalidMethod = analyze(
      parse(`
        import memory Lessons from "file://./.agentscript/lessons.jsonl"

        main agent A {
          main func(input) {
            return Lessons.delete({ id: "1" })
          }
        }
      `),
    );
    expect(invalidMethod.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "UNKNOWN_MEMORY_METHOD",
      }),
    );

    const invalidArity = analyze(
      parse(`
        import memory Lessons from "file://./.agentscript/lessons.jsonl"

        main agent A {
          main func(input) {
            return Lessons.query()
          }
        }
      `),
    );
    expect(invalidArity.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_ARGUMENT_COUNT",
      }),
    );
  });

  it("checks npm and node import authorization when a registry is provided", () => {
    const program = parse(`
      import tool Path from "node:path"
      import tool Yaml from "npm:yaml"

      main agent A {
        main func(input) {
          return input
        }
      }
    `);
    const unauthorized = analyze(program, { npmRegistry: { allow: { node: new Set(), npm: new Map() }, path: null } });
    const authorized = analyze(program, {
      npmRegistry: {
        allow: { node: new Set(["path"]), npm: new Map([["yaml", { name: "yaml" }]]) },
        path: null,
      },
    });

    expect(
      unauthorized.diagnostics.filter((diagnostic) => diagnostic.code === "UNAUTHORIZED_TOOL_IMPORT"),
    ).toHaveLength(2);
    expect(authorized.diagnostics).toEqual([]);
  });
});
