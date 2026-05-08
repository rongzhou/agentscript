import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { executeAgent } from "../src/runtime/interpreter.js";

describe("memory", () => {
  it("adds and queries file memory records with trace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-memory-"));
    const scriptFile = join(dir, "main.as");
    const ast = parse(`
      import memory Lessons from "file://./.agentscript/lessons.jsonl"

      main agent A {
        main func(input) {
          Lessons.add({
            kind: "lesson"
            text: "AgentScript keeps context explicit"
            goal: input.goal
          })
          Lessons.add({
            kind: "note"
            text: "unrelated"
            goal: "other"
          })
          return Lessons.query({
            kind: "lesson"
            text: "context"
            where: {
              goal: input.goal
            }
            limit: 5
          })
        }
      }
    `);

    const result = await executeAgent(ast, { goal: "memory" }, { sourcePath: scriptFile, workspaceRoot: dir });

    expect(result.value).toHaveLength(1);
    expect(result.value).toMatchObject([
      {
        record: {
          kind: "lesson",
          text: "AgentScript keeps context explicit",
          goal: "memory"
        }
      }
    ]);
    expect(result.trace.filter((event) => event.kind === "memory").map((event) => event.data.operation)).toEqual(["add", "add", "query"]);
    expect(result.trace.find((event) => event.kind === "memory" && event.data.operation === "add")).toMatchObject({
      data: {
        memory: "Lessons",
        id: expect.any(String),
        record: {
          kind: "lesson",
          text: "AgentScript keeps context explicit",
          goal: "memory"
        }
      }
    });
    expect(readFileSync(join(dir, ".agentscript", "lessons.jsonl"), "utf8")).toContain("AgentScript keeps context explicit");
  });

  it("requires memory where fields to exist on the record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-memory-where-"));
    const scriptFile = join(dir, "main.as");
    const ast = parse(`
      import memory Lessons from "file://./.agentscript/lessons.jsonl"

      main agent A {
        main func(input) {
          Lessons.add({
            kind: "lesson"
            text: "no optional field"
          })
          return Lessons.query({
            where: {
              optional: none
            }
            limit: 5
          })
        }
      }
    `);

    const result = await executeAgent(ast, {}, { sourcePath: scriptFile, workspaceRoot: dir });

    expect(result.value).toEqual([]);
  });

  it("reports invalid file memory JSONL with line numbers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-memory-bad-"));
    const memoryFile = join(dir, ".agentscript", "lessons.jsonl");
    mkdirSync(dirname(memoryFile), { recursive: true });
    writeFileSync(join(dir, "main.as"), "");
    writeFileSync(memoryFile, "{bad json}\n", { flag: "w" });
    const ast = parse(`
      import memory Lessons from "file://./.agentscript/lessons.jsonl"

      main agent A {
        main func(input) {
          return Lessons.query({ limit: 5 })
        }
      }
    `);

    await expect(executeAgent(ast, {}, { sourcePath: join(dir, "main.as"), workspaceRoot: dir })).rejects.toThrow(/Invalid memory JSONL .*:1/);
  });

  it("adds and queries sqlite memory records by namespace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-sqlite-memory-"));
    const scriptFile = join(dir, "main.as");
    const ast = parse(`
      import memory Lessons from "sqlite://./.agentscript/memory.db#lessons"
      import memory Runs from "sqlite://./.agentscript/memory.db#runs"

      main agent A {
        main func(input) {
          Lessons.add({
            kind: "lesson"
            text: "sqlite memory keeps namespaces separate"
            goal: input.goal
          })
          Runs.add({
            kind: "lesson"
            text: "run record"
            goal: input.goal
          })
          return Lessons.query({
            kind: "lesson"
            text: "namespaces"
            where: {
              goal: input.goal
            }
            limit: 5
          })
        }
      }
    `);

    const result = await executeAgent(ast, { goal: "sqlite" }, { sourcePath: scriptFile, workspaceRoot: dir });

    expect(result.value).toHaveLength(1);
    expect(result.value).toMatchObject([
      {
        record: {
          text: "sqlite memory keeps namespaces separate",
          goal: "sqlite"
        }
      }
    ]);
    expect(result.trace.filter((event) => event.kind === "memory")).toHaveLength(3);
  });

});
