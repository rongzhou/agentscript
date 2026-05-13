import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { analyze } from "../src/semantic/analyzer.js";

describe("semantic parallel-for", () => {
  it("checks parallel for bodies and outer mutations", () => {
    const noFinalValue = analyze(
      parse(`
        main agent A {
          main func(input) {
            return parallel for step in input.steps max 2 {
              use step
            }
          }
        }
      `),
    );
    expect(noFinalValue.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVALID_PARALLEL_FOR_BODY",
      }),
    );

    const outerAssignment = analyze(
      parse(`
        main agent A {
          main func(input) {
            count = 0
            return parallel for step in input.steps max 2 {
              count = step
              step
            }
          }
        }
      `),
    );
    expect(outerAssignment.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "PARALLEL_FOR_OUTER_ASSIGNMENT",
      }),
    );

    const outerMutation = analyze(
      parse(`
        main agent A {
          main func(input) {
            scratch = []
            return parallel for step in input.steps max 2 {
              scratch.add(step)
              step
            }
          }
        }
      `),
    );
    expect(outerMutation.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "PARALLEL_FOR_OUTER_MUTATION",
      }),
    );
  });

  it("checks nested parallel for body effects", () => {
    const result = analyze(
      parse(`
        import tool Echo from "mcp://echo"
        import memory Lessons from "file://./.agentscript/lessons.jsonl"

        main agent A {
          main func(input) {
            scratch = { count: 0 }

            return parallel for item in input.items max 2 {
              result = Echo.echo({ text: item.text })
              wrapped = {
                saved: Lessons.add({ kind: "lesson", text: item.text })
              }
              if item.ok {
                scratch.count = item.value
              }
              result
            }
          }
        }
      `),
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "PARALLEL_FOR_EFFECTFUL_CALL")).toHaveLength(
      2,
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "PARALLEL_FOR_OUTER_MUTATION",
      }),
    );
  });

  it("rejects npm and node tool calls inside parallel for", () => {
    const result = analyze(
      parse(`
        import tool Path from "node:path"
        import tool Yaml from "npm:yaml"

        main agent A {
          main func(input) {
            return parallel for item in input.items max 2 {
              Path.join("a", item)
              Yaml.parse(item)
              item
            }
          }
        }
      `),
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "PARALLEL_FOR_EFFECTFUL_CALL")).toHaveLength(
      2,
    );
  });

  it("does not report outer mutation for imported tool add methods", () => {
    const result = analyze(
      parse(`
        import tool Store from "file://workspace"

        main agent A {
          main func(input) {
            return parallel for item in input.items max 2 {
              Store.add(item)
              item
            }
          }
        }
      `),
    );

    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: "PARALLEL_FOR_OUTER_MUTATION",
      }),
    );
  });

  it("allows AgentScript trial but rejects specialize inside parallel for", () => {
    const result = analyze(
      parse(`
        import tool AgentScript from "host://agentscript"

        main agent A {
          main func(input) {
            return parallel for candidate in input.candidates max 2 {
              inspected = AgentScript.inspect({ target: input.target })
              trial = AgentScript.trial({
                target: input.target,
                input: {},
                selection: candidate
              })
              patch = AgentScript.specialize({
                target: input.target,
                selection: candidate
              })
              trial
            }
          }
        }
      `),
    );

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "PARALLEL_FOR_EFFECTFUL_CALL")).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("AgentScript.specialize"),
      }),
    ]);
  });
});
