import readline from "node:readline";

const tools = [
  {
    name: "echo",
    description: "Echo text",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
      },
    },
  },
  {
    name: "web-search",
    description: "Fake search",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
    },
  },
];

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (line.trim().length === 0) return;
  const message = JSON.parse(line);
  if (!message.id) return;

  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "mcp-echo-fixture", version: "1.0.0" },
    });
    return;
  }

  if (message.method === "tools/list") {
    respond(message.id, { tools });
    return;
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (name === "echo") {
      respond(message.id, {
        content: [{ type: "text", text: String(args.text ?? "") }],
        structuredContent: { echoed: args.text ?? "" },
        isError: false,
      });
      return;
    }
    if (name === "web-search") {
      respond(message.id, {
        content: [{ type: "text", text: `result for ${String(args.query ?? "")}` }],
        isError: false,
      });
      return;
    }
    error(message.id, -32602, `Unknown tool: ${name}`);
    return;
  }

  error(message.id, -32601, `Unknown method: ${message.method}`);
});

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function error(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}
