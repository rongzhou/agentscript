import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/parser.js";
import { buildContext } from "../src/runtime/context.js";
import { ProtocolLlmProvider, parseLlmUri } from "../src/providers/llm/index.js";
import type { GenerateRequest, JsonObject, LlmBinding } from "../src/runtime/types.js";

const mainModel: LlmBinding = {
  __agentScriptResource: "llm",
  name: "Qwen",
  uri: "ollama://localhost:11434/qwen3.6",
};

describe("parseLlmUri", () => {
  it("parses openai, anthropic, and ollama model URIs", () => {
    expect(parseLlmUri({ ...mainModel, uri: "openai://gpt-4.1-mini" })).toEqual({
      protocol: "openai",
      model: "gpt-4.1-mini",
    });
    expect(parseLlmUri({ ...mainModel, uri: "anthropic://claude-sonnet-4-0" })).toEqual({
      protocol: "anthropic",
      model: "claude-sonnet-4-0",
    });
    expect(parseLlmUri({ ...mainModel, uri: "ollama://localhost:11434/qwen3.6" })).toEqual({
      protocol: "ollama",
      model: "qwen3.6",
      baseUrl: "http://localhost:11434",
    });
    expect(() => parseLlmUri({ ...mainModel, uri: "ollama:qwen3.6" })).toThrow();
  });
});

describe("ProtocolLlmProvider", () => {
  it("calls OpenAI chat completions with structured output", async () => {
    const calls: Array<{ url: string; body: JsonObject; headers: HeadersInit | undefined }> = [];
    const provider = new ProtocolLlmProvider({
      openaiApiKey: "test-key",
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as JsonObject,
          headers: init?.headers,
        });
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({ ok: true }),
              },
            },
          ],
        });
      },
    });

    const result = await provider.generate(makeRequest("openai://gpt-4.1-mini"));

    expect(result).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.body.response_format).toMatchObject({
      type: "json_schema",
    });
  });

  it("passes provider hints to OpenAI requests", async () => {
    const calls: JsonObject[] = [];
    const provider = new ProtocolLlmProvider({
      openaiApiKey: "test-key",
      fetch: async (_input, init) => {
        calls.push(JSON.parse(String(init?.body)) as JsonObject);
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({ ok: true }),
              },
            },
          ],
        });
      },
    });

    await provider.generate({
      ...makeRequest("openai://gpt-4.1-mini"),
      temperature: 0.2,
      think: "high",
      strict: true,
    });

    expect(calls[0]).toMatchObject({
      temperature: 0.2,
      reasoning_effort: "high",
    });
    expect((calls[0]!.response_format as JsonObject).json_schema).toMatchObject({
      strict: true,
    });
  });

  it("calls Anthropic messages API", async () => {
    const calls: JsonObject[] = [];
    const provider = new ProtocolLlmProvider({
      anthropicApiKey: "test-key",
      fetch: async (_input, init) => {
        calls.push(JSON.parse(String(init?.body)) as JsonObject);
        return jsonResponse({
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true }),
            },
          ],
        });
      },
    });

    const result = await provider.generate(makeRequest("anthropic://claude-sonnet-4-0"));

    expect(result).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      model: "claude-sonnet-4-0",
      max_tokens: 100,
    });
  });

  it("calls Ollama chat API with schema format and generation options", async () => {
    const calls: Array<{ url: string; body: JsonObject }> = [];
    const provider = new ProtocolLlmProvider({
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as JsonObject,
        });
        return jsonResponse({
          message: {
            content: JSON.stringify({ ok: true }),
          },
        });
      },
    });

    const result = await provider.generate({
      ...makeRequest("ollama://localhost:11434/qwen3.6"),
      temperature: 0.7,
      think: "high",
    });

    expect(result).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("http://localhost:11434/api/chat");
    expect(calls[0]!.body).toMatchObject({
      model: "qwen3.6",
      stream: false,
      think: "high",
    });
    expect(calls[0]!.body.options).toMatchObject({ num_predict: 100, temperature: 0.7 });
    expect(calls[0]!.body.format).toMatchObject({ type: "object" });
  });

  it("reports Ollama thinking output without final content", async () => {
    const provider = new ProtocolLlmProvider({
      fetch: async () =>
        jsonResponse({
          message: {
            content: "",
            thinking: "reasoning used all available tokens",
          },
        }),
    });

    await expect(
      provider.generate({
        ...makeRequest("ollama://localhost:11434/qwen3.6"),
        think: true,
      }),
    ).rejects.toThrow("Increase generate max_output or disable think");
  });

  it("reports invalid provider JSON with response context", async () => {
    const provider = new ProtocolLlmProvider({
      openaiApiKey: "test-key",
      fetch: async () => new Response("not json", { status: 200 }),
    });

    await expect(provider.generate(makeRequest("openai://gpt-4.1-mini"))).rejects.toThrow(
      /invalid JSON response: not json/,
    );
  });

  it("extracts embedded JSON from model text", async () => {
    const provider = new ProtocolLlmProvider({
      openaiApiKey: "test-key",
      fetch: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: `Here is the answer: ${JSON.stringify({ ok: true })}`,
              },
            },
          ],
        }),
    });

    await expect(provider.generate(makeRequest("openai://gpt-4.1-mini"))).resolves.toEqual({ ok: true });
  });

  it("extracts fenced JSON from model text", async () => {
    const provider = new ProtocolLlmProvider({
      openaiApiKey: "test-key",
      fetch: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: `\`\`\`json\n${JSON.stringify({ ok: true })}\n\`\`\``,
              },
            },
          ],
        }),
    });

    await expect(provider.generate(makeRequest("openai://gpt-4.1-mini"))).resolves.toEqual({ ok: true });
  });

  it("times out provider requests", async () => {
    const provider = new ProtocolLlmProvider({
      openaiApiKey: "test-key",
      timeoutMs: 1,
      fetch: async (_input, init) => {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
        throw new Error("unreachable");
      },
    });

    await expect(provider.generate(makeRequest("openai://gpt-4.1-mini"))).rejects.toThrow(/timed out/);
  });
});

function makeRequest(uri: string): GenerateRequest {
  const ast = parse(`
    agent A {
      func act(input) {
        return generate({ input: "answer", max_output: 100 }) -> {
            ok boolean
        }
      }
    }
  `);
  const stmt = ast.agents[0]!.functions[0]!.body[0]!;
  if (stmt.kind !== "ReturnStmt" || stmt.value.kind !== "GenerateExpr") {
    throw new Error("unexpected test AST");
  }

  const model = { ...mainModel, uri };
  const maxOutput = stmt.value.options.maxOutput;
  const builtContext = buildContext({
    agentName: "A",
    model,
    identity: {},
    instruction: "answer",
    returnShape: stmt.value.returnShape,
    uses: [],
    maxOutput,
  });

  return {
    agentName: "A",
    model,
    identity: {},
    instruction: "answer",
    returnShape: stmt.value.returnShape,
    context: [],
    builtContext,
    maxOutput,
    strict: false,
    debug: false,
  };
}

function jsonResponse(value: JsonObject): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
