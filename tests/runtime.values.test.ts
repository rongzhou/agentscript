import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";
import { sanitizeForJson } from "../src/runtime/json.js";
import type { RuntimeValue } from "../src/runtime/types.js";

describe("runtime values", () => {
  it("serializes circular runtime values safely", async () => {
    const value: Record<string, RuntimeValue> = {};
    value.self = value as RuntimeValue;

    expect(() => JSON.stringify(value)).toThrow(TypeError);
    expect(JSON.stringify(sanitizeForJson(value as RuntimeValue))).toContain("[Circular]");
  });

  it("serializes runtime resource bindings into stable JSON", () => {
    expect(
      sanitizeForJson({
        __agentScriptResource: "tool",
        name: "Search",
        uri: "mcp://tools/search",
      }),
    ).toEqual({
      tool: "Search",
      uri: "mcp://tools/search",
    });
  });

  it("sanitizes JSON-unsafe values predictably", () => {
    const value = {
      keep: "value",
      omitUndefined: undefined,
      omitFunction: () => "ignored",
      omitSymbol: Symbol("ignored"),
      list: [undefined, () => "ignored", Symbol("ignored"), "ok"],
    } as unknown as RuntimeValue;

    expect(sanitizeForJson(value)).toEqual({
      keep: "value",
      list: [null, null, null, "ok"],
    });
  });

  it("rejects unsupported native containers during JSON sanitization", () => {
    expect(() => sanitizeForJson(1n as unknown as RuntimeValue)).toThrow(/bigint/);
    expect(() => sanitizeForJson(new Map() as unknown as RuntimeValue)).toThrow(/Map or Set/);
    expect(() => sanitizeForJson(new Set() as unknown as RuntimeValue)).toThrow(/Map or Set/);
  });

  it("rejects assignment to list properties", async () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          list = [1, 2, 3]
          list.length = 0
          return list
        }
      }
    `);

    await expect(executeAgent(ast, {})).rejects.toThrow(/Cannot assign a property on a list value/);
  });

  it("rejects list.add without exactly one argument", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          items = []
          items.add()
          return items
        }
      }
    `);

    await expect(executeAgent(ast, {})).rejects.toThrow(/list.add expects exactly one argument/);
  });

  it("evaluates less-than comparisons", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          return input.count < 3
        }
      }
    `);

    await expect(executeAgent(ast, { count: 2 })).resolves.toMatchObject({ value: true });
    await expect(executeAgent(ast, { count: 3 })).resolves.toMatchObject({ value: false });
  });

  it("evaluates arithmetic, greater-than, and compound assignment", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          total = input.start
          total += 5
          total -= 2
          label = "count:"
          label += total

          return {
            total: total,
            label: label,
            ok: total > 5,
            delta: total - input.start
          }
        }
      }
    `);

    await expect(executeAgent(ast, { start: 4 })).resolves.toMatchObject({
      value: {
        total: 7,
        label: "count:7",
        ok: true,
        delta: 3,
      },
    });
  });

  it("rejects arithmetic over non-number operands except string plus", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          return input.value - 1
        }
      }
    `);

    await expect(executeAgent(ast, { value: "2" })).rejects.toThrow(/operator '-' requires number operands/);
  });

  it("reads list items by index", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          items = [
            { id: "first" },
            { id: "second" }
          ]

          return {
            first: items[0].id,
            second: items[1].id
          }
        }
      }
    `);

    const result = await executeAgent(ast, {});

    expect(result.value).toEqual({
      first: "first",
      second: "second",
    });
  });

  it("rejects invalid list index access", async () => {
    const nonList = parse(`
      main agent A {
        main func(input) {
          return input.value[0]
        }
      }
    `);
    await expect(executeAgent(nonList, { value: "not-list" })).rejects.toThrow(/Index access requires a list value/);

    const nonInteger = parse(`
      main agent A {
        main func(input) {
          return input.items[1.5]
        }
      }
    `);
    await expect(executeAgent(nonInteger, { items: ["a", "b"] })).rejects.toThrow(
      /List index must be a non-negative integer/,
    );

    const outOfRange = parse(`
      main agent A {
        main func(input) {
          return input.items[2]
        }
      }
    `);
    await expect(executeAgent(outOfRange, { items: ["a", "b"] })).rejects.toThrow(/List index 2 is out of range/);
  });

  it("rejects unknown object property access", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          return input.missing
        }
      }
    `);

    await expect(executeAgent(ast, {})).rejects.toThrow(/Unknown object property 'missing'/);
  });
});
