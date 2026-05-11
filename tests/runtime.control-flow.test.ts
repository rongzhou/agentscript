import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";

describe("runtime control-flow", () => {
  it("evaluates if else and boolean operators", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          if input.value == "ok" and not input.skip {
            return {
              ok: true
            }
          } else {
            return {
              ok: false
            }
          }
        }
      }
    `);

    await expect(executeAgent(ast, { value: "ok", skip: false })).resolves.toMatchObject({
      value: { ok: true },
    });
    await expect(executeAgent(ast, { value: "ok", skip: true })).resolves.toMatchObject({
      value: { ok: false },
    });
  });

  it("executes for-in list traversal with a hard iteration cap", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          items = [
            { value: "a" },
            { value: "b" },
            { value: "c" }
          ]
          results = []

          for item in items max 2 {
            results.add(item.value)
          }

          return results
        }
      }
    `);

    const result = await executeAgent(ast, {});

    expect(result.value).toEqual(["a", "b"]);
    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "for",
          data: expect.objectContaining({
            item: "item",
            index: 0,
            value: { value: "a" },
          }),
        }),
      ]),
    );
  });

  it("rejects for-in traversal over non-list values", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          for item in input.value max 2 {
            return item
          }

          return none
        }
      }
    `);

    await expect(executeAgent(ast, { value: "not-list" })).rejects.toThrow(/for loop requires a list value/);
  });

  it("executes loop-until statements up to the condition or max limit", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          count = 0
          loop until count == input.target max 5 {
            count += 1
          }
          return count
        }
      }
    `);

    await expect(executeAgent(ast, { target: 3 })).resolves.toMatchObject({
      value: 3,
    });
    await expect(executeAgent(ast, { target: 10 })).resolves.toMatchObject({
      value: 5,
    });
  });

  it("executes parallel for expressions with input-order results and trace", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          return parallel for item in input.items max 3 {
            {
              id: item.id,
              value: item.value
            }
          }
        }
      }
    `);

    const result = await executeAgent(
      ast,
      {
        items: [
          { id: "a", value: 1 },
          { id: "b", value: 2 },
          { id: "c", value: 3 },
          { id: "d", value: 4 },
        ],
      },
      { concurrency: 2 },
    );

    expect(result.value).toEqual([
      { id: "a", value: 1 },
      { id: "b", value: 2 },
      { id: "c", value: 3 },
    ]);
    expect(result.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "parallel_for",
          data: expect.objectContaining({
            item: "item",
            items: 3,
            concurrency: 2,
          }),
        }),
      ]),
    );
  });

  it("rejects parallel for over non-list values", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          return parallel for item in input.value max 2 {
            item
          }
        }
      }
    `);

    await expect(executeAgent(ast, { value: "not-list" })).rejects.toThrow(/parallel for source must be a list/);
  });

  it("waits for all parallel for iterations before reporting failures", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          return parallel for item in input.items max 3 {
            item.missing
          }
        }
      }
    `);

    await expect(executeAgent(ast, { items: [{ ok: 1 }, { ok: 2 }, { ok: 3 }] })).rejects.toThrow(
      /parallel for failed: \[0\].*\[1\].*\[2\]/,
    );
  });
});
