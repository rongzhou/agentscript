import { describe, expect, it } from "vitest";
import { fromHostValue, toJsonArg } from "../src/runtime/values/host-marshal.js";

const context = { label: "test" };

describe("host marshal", () => {
  it("round-trips JSON-safe values", () => {
    const value = { a: 1, b: ["x", true, null] };

    expect(fromHostValue(value, context)).toEqual(value);
    expect(toJsonArg(value, context)).toEqual(value);
  });

  it("rejects runtime bindings as arguments", () => {
    expect(() => toJsonArg({ __agentScriptResource: "tool", name: "Tool", uri: "node:path" }, context)).toThrow(
      "tool binding",
    );
  });

  it("rejects invalid host values with paths", () => {
    expect(() => fromHostValue({ items: [1, undefined] }, context)).toThrow("result.items[1]");
    expect(() => fromHostValue(new Map(), context)).toThrow("Map is not JSON-safe");
  });

  it("rejects circular references", () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(() => fromHostValue(value, context)).toThrow("circular reference");
  });
});
