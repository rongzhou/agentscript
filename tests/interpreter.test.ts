import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";
import { sanitizeForJson } from "../src/runtime/json.js";
import { MockToolProvider } from "../src/providers/mock/index.js";
import { buildValueFromShape } from "../src/runtime/shape.js";
import type { GenerateRequest, RuntimeValue } from "../src/runtime/types.js";

describe("interpreter", () => {
  it("executes the V0 regression fixture with mock providers", async () => {
    const source = readFileSync("fixtures/v0.as", "utf8");
    const result = await executeAgent(parse(source), {
      question: "What is AgentScript?"
    }, { toolProvider: new MockToolProvider() });

    expect(result.value).toMatchObject({
      ok: true,
      text: "",
      error: ""
    });
    expect(result.trace.some((event) => event.kind === "tool")).toBe(true);
    expect(result.trace.some((event) => event.kind === "generate")).toBe(true);
    expect(result.trace.some((event) => event.kind === "use")).toBe(true);
  });








  it("serializes circular runtime values safely", async () => {
    const value: Record<string, RuntimeValue> = {};
    value.self = value as RuntimeValue;

    expect(() => JSON.stringify(value)).toThrow(TypeError);
    expect(JSON.stringify(sanitizeForJson(value as RuntimeValue))).toContain("[Circular]");
  });

  it("serializes runtime resource bindings into stable JSON", () => {
    expect(sanitizeForJson({
      __agentScriptResource: "tool",
      name: "Search",
      uri: "mcp://tools/search"
    })).toEqual({
      tool: "Search",
      uri: "mcp://tools/search"
    });
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

  it("reports runaway recursion as a RuntimeError", async () => {
    const ast = parse(`
      main agent A {
        main func act(input) {
          return recurse(input)
        }

        func recurse(input) {
          return recurse(input)
        }
      }
    `);

    await expect(executeAgent(ast, {})).rejects.toThrow(/Maximum call depth/);
  });

  it("lets functions override scoped model and role configuration", async () => {
    const requests: GenerateRequest[] = [];
    const ast = parse(`
      import llm Fast from "openai://fast"
      import llm Strong from "openai://strong"

      main agent A {
        model Fast
        role "Assistant"
        description "Default agent description."

        main func(input) {
          return specialized()
        }

        func specialized() {
          model Strong
          role "Specialist"
          description "Specialized function description."

          return generate({ input: "x" }) -> {
              ok boolean
          }
        }
      }
    `);

    await executeAgent(ast, {}, {
      llmProvider: {
        async generate(request) {
          requests.push(request);
          if (!request.returnShape) {
            throw new Error("unexpected missing return shape");
          }
          return buildValueFromShape(request.returnShape);
        }
      }
    });

    expect(requests[0]!.model).toMatchObject({ name: "Strong", uri: "openai://strong" });
    expect(requests[0]!.identity).toMatchObject({
      role: "Specialist",
      description: "Specialized function description."
    });
  });

  it("updates outer variables from repeat attempt scopes", async () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Reflect on repeat attempts."

        main func act(input) {
          insight = none

          repeat * 2 {
            insight = generate({ input: "reflect" }) -> {
                value string
            }
          }

          return insight
        }
      }
    `);

    const result = await executeAgent(ast, {});

    expect(result.value).toEqual({ value: "" });
  });





  it("returns none when a function has no explicit return or final expression", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          value = "missing return"
        }
      }
    `);

    const result = await executeAgent(ast, {});

    expect(result.value).toBeNull();
  });

  it("returns the final top-level expression from a function", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          use input.question
          answer(input)
        }

        func answer(input) {
          value = {
            ok: true,
            answer: input.question,
            tags: ["final", "expression"]
          }

          value.answer
        }
      }
    `);

    const result = await executeAgent(ast, { question: "What is AgentScript?" });

    expect(result.value).toBe("What is AgentScript?");
  });

  it("supports final expression return for generate output", async () => {
    const ast = parse(`
      import llm Qwen from "openai://gpt-4.1-mini"

      main agent A {
        model Qwen
        role "Assistant"
        description "Answer questions."

        main func(input) {
          use input.question

          generate({ input: "answer" }) -> {
              ok boolean
              answer string
          }
        }
      }
    `);

    const result = await executeAgent(ast, { question: "x" });

    expect(result.value).toEqual({ ok: true, answer: "" });
  });

  it("does not return expression statements inside nested blocks implicitly", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          if input.ok {
            "nested"
          }
        }
      }
    `);

    const result = await executeAgent(ast, { ok: true });

    expect(result.value).toBeNull();
  });

  it("returns object and list literals as final expressions", async () => {
    const objectAst = parse(`
      main agent A {
        main func(input) {
          {
            facts: [input.fact],
            source: input.source
          }
        }
      }
    `);
    const listAst = parse(`
      main agent A {
        main func(input) {
          [input.a, input.b]
        }
      }
    `);

    await expect(executeAgent(objectAst, { fact: "ok", source: "test" })).resolves.toMatchObject({
      value: {
        facts: ["ok"],
        source: "test"
      }
    });
    await expect(executeAgent(listAst, { a: 1, b: 2 })).resolves.toMatchObject({
      value: [1, 2]
    });
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



  it("calls another agent with AgentName(input) shorthand", async () => {
    const ast = parse(`
      main agent App {
        main func(input) {
          return Worker(input)
        }
      }

      agent Worker {
        main func work(input) {
          return {
            ok: true,
            value: input.value
          }
        }
      }
    `);

    const result = await executeAgent(ast, { value: "done" });

    expect(result.value).toEqual({ ok: true, value: "done" });
    expect(result.trace).toContainEqual(
      expect.objectContaining({
        kind: "agent"
      })
    );
  });

  it("keeps subagent trace events nested under the agent call", async () => {
    const ast = parse(`
      import tool Search from "mcp://tools/search"

      main agent App {
        main func(input) {
          return Worker(input)
        }
      }

      agent Worker {
        main func search(input) {
          observation = Search.search(input.query)
          return observation
        }
      }
    `);

    const result = await executeAgent(ast, { query: "agents" }, { toolProvider: new MockToolProvider() });
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({
      kind: "agent",
      data: {
        agent: "Worker",
        function: "search"
      }
    });
    expect(result.trace[0]!.data.trace).toEqual([
      expect.objectContaining({
        kind: "tool"
      })
    ]);
  });

  it("calls a named function on another agent", async () => {
    const ast = parse(`
      main agent App {
        main func(input) {
          return Worker.run(input.value)
        }
      }

      agent Worker {
        func run(value) {
          return {
            value: value
          }
        }
      }
    `);

    const result = await executeAgent(ast, { value: "named" });

    expect(result.value).toEqual({ value: "named" });
  });

  it("lets local assignments shadow imported tool names", async () => {
    const ast = parse(`
      import tool Search from "mcp://tools/search"

      main agent A {
        main func act(input) {
          Search = "local"
          return Search
        }
      }
    `);

    const result = await executeAgent(ast, {});

    expect(result.value).toBe("local");
  });

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
      value: { ok: true }
    });
    await expect(executeAgent(ast, { value: "ok", skip: true })).resolves.toMatchObject({
      value: { ok: false }
    });
  });

  it("fills missing shaped entry input through the input provider", async () => {
    const ast = parse(`
      agent A {
        main func(input {
          question string
        }) {
          return {
            question: input.question
            input: input
          }
        }
      }
    `);

    const result = await executeAgent(ast, {}, {
      inputProvider: {
        async read(request) {
          expect(request.path).toEqual(["input", "question"]);
          return "interactive question";
        }
      }
    });

    expect(result.value).toEqual({
      question: "interactive question",
      input: {
        question: "interactive question"
      }
    });
    expect(result.trace).toContainEqual(
      expect.objectContaining({
        kind: "input"
      })
    );
  });

  it("uses existing shaped entry input without asking the provider", async () => {
    const ast = parse(`
      agent A {
        main func(input {
          question string
        }) {
          return input.question
        }
      }
    `);

    const result = await executeAgent(ast, { question: "provided" }, {
      inputProvider: {
        async read() {
          throw new Error("should not read");
        }
      }
    });

    expect(result.value).toBe("provided");
  });

  it("rejects missing shaped entry input without an input provider", async () => {
    const ast = parse(`
      agent A {
        main func(input {
          question string
        }) {
          return input.question
        }
      }
    `);

    await expect(executeAgent(ast, {})).rejects.toThrow(/no interactive input provider/);
  });

  it("validates shaped entry input values", async () => {
    const ast = parse(`
      agent A {
        main func(input {
          question string
        }) {
          return input.question
        }
      }
    `);

    await expect(executeAgent(ast, { question: false })).rejects.toThrow(/must be a string/);
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

          for item in items < 2 {
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
            value: { value: "a" }
          })
        })
      ])
    );
  });

  it("rejects for-in traversal over non-list values", async () => {
    const ast = parse(`
      main agent A {
        main func(input) {
          for item in input.value < 2 {
            return item
          }

          return none
        }
      }
    `);

    await expect(executeAgent(ast, { value: "not-list" })).rejects.toThrow(/for loop requires a list value/);
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
      second: "second"
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
    await expect(executeAgent(nonInteger, { items: ["a", "b"] })).rejects.toThrow(/List index must be a non-negative integer/);

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


  it("loads imported json files as json values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const scriptFile = join(dir, "agent.as");
    writeFileSync(join(dir, "data.json"), '{"title":"AgentScript","tags":["agent","dsl"]}');

    const ast = parse(`
      import file Data from "./data.json"

      main agent A {
        main func(input) {
          return {
            title: Data.title,
            firstTag: Data.tags[0]
          }
        }
      }
    `);

    const result = await executeAgent(ast, {}, { sourcePath: scriptFile });

    expect(result.value).toEqual({
      title: "AgentScript",
      firstTag: "agent"
    });
  });
});
