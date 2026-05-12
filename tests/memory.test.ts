import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { HostMemoryProvider } from "../src/providers/memory/host.js";
import { executeAgent } from "../src/runtime/interpreter.js";
import type { MemoryProvider, RuntimeValue } from "../src/runtime/types.js";

describe("memory", () => {
  it("adds and queries file memory records with trace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-memory-"));
    const scriptFile = join(dir, "main.as");
    const ast = parse(`
      import memory Lessons from "file://./.agentscript/lessons.jsonl"

      main agent A {
        main func(input) {
          Lessons.add({
            kind: "lesson",
            text: "AgentScript keeps context explicit",
            goal: input.goal
          })
          Lessons.add({
            kind: "note",
            text: "unrelated",
            goal: "other"
          })
          return Lessons.query({
            kind: "lesson",
            text: "context",
            where: {
              goal: input.goal
            },
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
          goal: "memory",
        },
      },
    ]);
    expect(result.trace.filter((event) => event.kind === "memory").map((event) => event.data.operation)).toEqual([
      "add",
      "add",
      "query",
    ]);
    expect(result.trace.find((event) => event.kind === "memory" && event.data.operation === "add")).toMatchObject({
      data: {
        memory: "Lessons",
        id: expect.any(String),
        record: {
          kind: "lesson",
          text: "AgentScript keeps context explicit",
          goal: "memory",
        },
      },
    });
    expect(readFileSync(join(dir, ".agentscript", "lessons.jsonl"), "utf8")).toContain(
      "AgentScript keeps context explicit",
    );
  });

  it("requires memory where fields to exist on the record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-memory-where-"));
    const scriptFile = join(dir, "main.as");
    const ast = parse(`
      import memory Lessons from "file://./.agentscript/lessons.jsonl"

      main agent A {
        main func(input) {
          Lessons.add({
            kind: "lesson",
            text: "no optional field"
          })
          return Lessons.query({
            where: {
              optional: none
            },
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
    writeFileSync(memoryFile, "{bad: json}\n", { flag: "w" });
    const ast = parse(`
      import memory Lessons from "file://./.agentscript/lessons.jsonl"

      main agent A {
        main func(input) {
          return Lessons.query({ limit: 5 })
        }
      }
    `);

    await expect(executeAgent(ast, {}, { sourcePath: join(dir, "main.as"), workspaceRoot: dir })).rejects.toThrow(
      /Invalid memory JSONL .*:1/,
    );
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
            kind: "lesson",
            text: "sqlite memory keeps namespaces separate",
            goal: input.goal
          })
          Runs.add({
            kind: "lesson",
            text: "run record",
            goal: input.goal
          })
          return Lessons.query({
            kind: "lesson",
            text: "namespaces",
            where: {
              goal: input.goal
            },
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
          goal: "sqlite",
        },
      },
    ]);
    expect(result.trace.filter((event) => event.kind === "memory")).toHaveLength(3);
  });

  it("can close and reopen sqlite memory connections", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-sqlite-memory-close-"));
    const uri = "sqlite://./.agentscript/memory.db#lessons";
    const first = new HostMemoryProvider({ baseDir: dir, workspaceRoot: dir });

    await first.add({
      memoryName: "Lessons",
      uri,
      record: {
        kind: "lesson",
        text: "sqlite close persists records",
      },
    });
    await first.close();

    const second = new HostMemoryProvider({ baseDir: dir, workspaceRoot: dir });
    const result = await second.query({
      memoryName: "Lessons",
      uri,
      query: {
        text: "persists",
        limit: 5,
      },
    });
    await second.close();

    expect(result).toMatchObject([
      {
        record: {
          text: "sqlite close persists records",
        },
      },
    ]);
  });

  it("matches file and sqlite memory query semantics consistently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-memory-query-"));
    const provider = new HostMemoryProvider({ baseDir: dir, workspaceRoot: dir });
    const fileUri = "file://./.agentscript/lessons.jsonl";
    const sqliteUri = "sqlite://./.agentscript/memory.db#lessons";
    const record = {
      kind: "lesson",
      text: "unrelated",
      note: "CaseFold Target",
      tags: ["runtime", "memory"],
    };
    const decoy = {
      kind: "note",
      text: "CaseFold Target",
      tags: ["runtime", "memory"],
    };

    await provider.add({ memoryName: "FileLessons", uri: fileUri, record });
    await provider.add({ memoryName: "FileLessons", uri: fileUri, record: decoy });
    await provider.add({ memoryName: "SqliteLessons", uri: sqliteUri, record });
    await provider.add({ memoryName: "SqliteLessons", uri: sqliteUri, record: decoy });

    const query = {
      kind: "lesson",
      text: "casefold target",
      where: {
        tags: ["runtime", "memory"],
      },
      limit: 5,
    };
    const fileResult = await provider.query({ memoryName: "FileLessons", uri: fileUri, query });
    const sqliteResult = await provider.query({ memoryName: "SqliteLessons", uri: sqliteUri, query });
    await provider.close();

    expect(fileResult).toMatchObject([{ record }]);
    expect(sqliteResult).toMatchObject([{ record }]);
  });

  it("adds memory call context to provider failures", async () => {
    const ast = parse(`
      import memory Lessons from "file://./.agentscript/lessons.jsonl"

      main agent A {
        main func(input) {
          return Lessons.query({ limit: 5 })
        }
      }
    `);
    const memoryProvider: MemoryProvider = {
      async add(): Promise<RuntimeValue> {
        return null;
      },
      async query(): Promise<RuntimeValue> {
        throw new Error("disk unavailable");
      },
    };

    await expect(executeAgent(ast, {}, { memoryProvider })).rejects.toThrow(
      "Memory Lessons.query (file://./.agentscript/lessons.jsonl) failed: disk unavailable",
    );
  });
});
