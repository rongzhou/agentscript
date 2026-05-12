import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/bin/agentscript.js";
import { runRepl } from "../src/bin/repl.js";

const fixture = "fixtures/v1.as";
const fixtureInput = '{"goal":"Ship V1"}';

describe("agentscript CLI", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("prints help and version with success exit codes", async () => {
    const help = await main(["--help"]);
    expect(help).toBe(0);
    expect(logSpy.mock.calls[0]![0]).toContain("Usage:");
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockClear();
    const version = await main(["--version"]);
    expect(version).toBe(0);
    expect(logSpy.mock.calls[0]![0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("parses a file", async () => {
    const code = await main([fixture, "--parse"]);

    expect(code).toBe(0);
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.kind).toBe("Program");
  });

  it("checks a file", async () => {
    const code = await main([fixture, "--check"]);

    expect(code).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("runs a file with --input", async () => {
    const code = await main([fixture, "--input", fixtureInput]);

    expect(code).toBe(0);
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.value).toMatchObject({ ok: true });
    expect(output.trace.some((event: { kind: string }) => event.kind === "agent")).toBe(true);
  });

  it("uses real LLM mode by default and allows explicit mock override", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const dir = mkdtempSync(join(tmpdir(), "agentscript-cli-"));
    const scriptFile = join(dir, "agent.as");
    writeFileSync(
      scriptFile,
      `
      import llm OpenAI from "openai://gpt-4.1-mini"

      main agent A {
        model OpenAI
        role "Assistant"
        description "Answer in a structured object."

        main func(input) {
          return generate({ input: "answer" }) -> {
              ok: boolean
          }
        }
      }
    `,
    );

    const real = await main([scriptFile]);
    expect(real).toBe(1);
    expect(errorSpy.mock.calls[0]![0]).toContain("OPENAI_API_KEY is required");

    errorSpy.mockClear();
    logSpy.mockClear();
    const mock = await main([scriptFile, "--mock"]);
    expect(mock).toBe(0);
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.value).toEqual({ ok: true });
  });

  it("dry-runs a program without a model provider call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const dir = mkdtempSync(join(tmpdir(), "agentscript-cli-"));
    const scriptFile = join(dir, "agent.as");
    writeFileSync(
      scriptFile,
      `
      import llm OpenAI from "openai://gpt-4.1-mini"

      main agent A {
        model OpenAI
        role "Inspector"
        description "Inspect a dry-run prompt without calling a model."

        main func(input) {
          return generate({ input: "inspect" }) -> {
              title: string
              items: list[string]
          }
        }
      }
    `,
    );

    const code = await main([scriptFile, "--dry-run", "--trace"]);

    expect(code).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.value).toEqual({ title: "", items: [] });
    expect(logSpy.mock.calls[1]![0]).toContain("- generate");
  });

  it("rejects positional input json", async () => {
    const code = await main([fixture, fixtureInput]);

    expect(code).toBe(1);
    expect(errorSpy.mock.calls[0]![0]).toContain("Use --input");
  });

  it("rejects non-object JSON input", async () => {
    const code = await main([fixture, "--input", "[]"]);

    expect(code).toBe(1);
    expect(errorSpy.mock.calls[0]![0]).toContain("--input must be a JSON object");
  });

  it("writes trace to a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const traceFile = join(dir, "trace.json");
    const code = await main([fixture, "--input", fixtureInput, "--trace-file", traceFile]);

    expect(code).toBe(0);
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.trace).toEqual({ file: traceFile });
    expect(JSON.parse(readFileSync(traceFile, "utf8"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "agent" })]),
    );
  });

  it("prints a readable trace", async () => {
    const code = await main([
      "tutorials/cli.as",
      "--input",
      '{"name":"Rong","request":"Say hello"}',
      "--mock",
      "--trace",
    ]);

    expect(code).toBe(0);
    expect(logSpy.mock.calls[1]![0]).toContain("- generate");
  });

  it("keeps --trace separate from --trace-file", async () => {
    const code = await main([fixture, "--input", fixtureInput, "--trace", "trace.json"]);

    expect(code).toBe(1);
    expect(errorSpy.mock.calls[0]![0]).toContain("Unexpected positional argument");
  });

  it("passes --concurrency to parallel for execution", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-cli-"));
    const scriptFile = join(dir, "parallel.as");
    writeFileSync(
      scriptFile,
      `
      main agent A {
        main func(input) {
          return parallel for item in input.items max 3 {
            item
          }
        }
      }
    `,
    );

    const code = await main([scriptFile, "--input", '{"items":["a","b","c"]}', "--concurrency", "2"]);

    expect(code).toBe(0);
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.value).toEqual(["a", "b", "c"]);
    expect(output.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "parallel_for",
          data: expect.objectContaining({ concurrency: 2 }),
        }),
      ]),
    );
  });

  it("prints only the final value with --quiet", async () => {
    const code = await main([fixture, "--input", fixtureInput, "--quiet"]);

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output).toMatchObject({ ok: true });
    expect(output.trace).toBeUndefined();
    expect(output.value).toBeUndefined();
  });

  it("prints a readable trace with --verbose", async () => {
    const code = await main([fixture, "--input", fixtureInput, "--verbose"]);

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls[1]![0]).toContain("- for");
    expect(logSpy.mock.calls[1]![0]).toContain("- agent Worker.__main");
  });

  it("rejects conflicting quiet and verbose trace output", async () => {
    const verbose = await main([fixture, "--input", fixtureInput, "--quiet", "--verbose"]);
    expect(verbose).toBe(1);
    expect(errorSpy.mock.calls[0]![0]).toContain("Use either --quiet");

    errorSpy.mockClear();
    const pretty = await main([fixture, "--input", fixtureInput, "--quiet", "--trace"]);
    expect(pretty).toBe(1);
    expect(errorSpy.mock.calls[0]![0]).toContain("Use either --quiet");
  });

  it("reads input from a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const inputFile = join(dir, "input.json");
    writeFileSync(inputFile, fixtureInput);

    const code = await main([fixture, "--input-file", inputFile]);

    expect(code).toBe(0);
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.value).toMatchObject({ ok: true });
  });

  it("runs a script with a file import relative to the script path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const scriptFile = join(dir, "agent.as");
    writeFileSync(join(dir, "doc.txt"), "relative file content");
    writeFileSync(
      scriptFile,
      `
      import file Doc from "./doc.txt"

      main agent A {
        main func(input) {
          return Doc
        }
      }
    `,
    );

    const code = await main([scriptFile, "--input", "{}"]);

    expect(code).toBe(0);
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.value).toBe("relative file content");
  });

  it("runs a script with file memory relative to the script path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-memory-cli-"));
    const scriptFile = join(dir, "agent.as");
    writeFileSync(
      scriptFile,
      `
      import memory Notes from "file://./.agentscript/notes.jsonl"

      main agent A {
        main func(input) {
          Notes.add({
            kind: "note",
            text: input.topic
          })
          return Notes.query({
            kind: "note",
            text: input.topic,
            limit: 1
          })
        }
      }
    `,
    );

    const code = await main([scriptFile, "--input", '{"topic":"memory"}']);

    expect(code).toBe(0);
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.value).toHaveLength(1);
    expect(readFileSync(join(dir, ".agentscript", "notes.jsonl"), "utf8")).toContain("memory");
  });

  it("runs a script with an imported agent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentscript-"));
    const scriptFile = join(dir, "main.as");
    const workerFile = join(dir, "worker.as");
    writeFileSync(
      workerFile,
      `
      agent Worker {
        main func(input) {
          return {
            ok: true,
            value: input.value
          }
        }
      }
    `,
    );
    writeFileSync(
      scriptFile,
      `
      import agent Worker from "./worker.as"

      main agent App {
        main func(input) {
          return Worker(input)
        }
      }
    `,
    );

    const code = await main([scriptFile, "--input", '{"value":"loaded"}']);

    expect(code).toBe(0);
    const output = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(output.value).toEqual({
      ok: true,
      value: "loaded",
    });
  });

  it("runs an agent-level REPL session", async () => {
    const input = new PassThrough();
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });

    const running = runRepl({ input, output });
    for (const line of [
      "main agent {",
      '  role "Assistant"',
      '  description "Return hello."',
      "  main func(input {}) {",
      "    return {",
      "      ok: true,",
      '      text: "hello"',
      "    }",
      "  }",
      "}",
      ":check",
      ":run {}",
      ":trace",
      ":exit",
    ]) {
      input.write(`${line}\n`);
      await new Promise((resolve) => setImmediate(resolve));
    }
    input.end();
    const code = await running;

    expect(errorSpy).not.toHaveBeenCalled();
    expect(code).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("ok");
    expect(logSpy.mock.calls.flat().join("\n")).toContain('"text": "hello"');
  });

  it("checks npm and node tool authorization in the REPL", async () => {
    const input = new PassThrough();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    const running = runRepl({ input, output });
    for (const line of [
      ':import tool Path from "node:path"',
      "main agent {",
      "  main func(input {}) {",
      "    return input",
      "  }",
      "}",
      ":check",
      ":exit",
    ]) {
      input.write(`${line}\n`);
      await new Promise((resolve) => setImmediate(resolve));
    }
    input.end();
    const code = await running;

    expect(code).toBe(0);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("Node module 'path' is not allowed");
  });

  it("loads a file into the REPL session", async () => {
    const input = new PassThrough();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    const running = runRepl({ input, output });
    for (const line of [":load tutorials/helloworld.as", ":check", ":exit"]) {
      input.write(`${line}\n`);
      await new Promise((resolve) => setImmediate(resolve));
    }
    input.end();
    const code = await running;

    expect(errorSpy).not.toHaveBeenCalled();
    expect(code).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("loaded 1 agent");
    expect(logSpy.mock.calls.flat().join("\n")).toContain("ok");
  });
});
