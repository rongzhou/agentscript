import { RuntimeError } from "../../runtime/core/errors.js";
import { isObject } from "../../runtime/values/guards.js";
import { sanitizeForJson } from "../../runtime/values/json.js";
import type { RuntimeObject, RuntimeValue } from "../../runtime/values/values.js";
import type { ToolCallRequest, ToolProvider } from "../../runtime/values/providers.js";
import { loadMcpRegistry, type McpRegistry } from "./mcp-config.js";
import { McpClient } from "./mcp-client.js";
import { expectObject } from "./shared.js";

export class McpToolProvider implements ToolProvider {
  private readonly registry: McpRegistry;
  private readonly clients = new Map<string, McpClient>();

  constructor(workspaceRoot = process.cwd()) {
    this.registry = loadMcpRegistry(workspaceRoot);
  }

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const key = mcpServerKey(request.uri);
    const client = this.clientFor(key);
    const { tool, args } = parseMcpToolCall(request);
    const result = await client.callTool(tool, args);
    return normalizeMcpResult(result);
  }

  async close(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(clients.map((client) => client.close()));
  }

  private clientFor(key: string): McpClient {
    const existing = this.clients.get(key);
    if (existing) return existing;
    const config = this.registry.mcpServers[key];
    if (!config) {
      throw new RuntimeError(`MCP server '${key}' not found in agentscript.mcp.json`);
    }
    const client = new McpClient(key, config);
    this.clients.set(key, client);
    return client;
  }
}

function mcpServerKey(uri: string): string {
  const parsed = new URL(uri);
  const path = parsed.pathname.replace(/^\//, "");
  const key = [parsed.hostname, path].filter((part) => part.length > 0).join("/");
  if (key.length === 0) {
    throw new RuntimeError(`MCP URI '${uri}' must include a server key`);
  }
  return key;
}

function parseMcpToolCall(request: ToolCallRequest): { tool: string; args: Record<string, RuntimeValue> } {
  if (request.method === "call") {
    if (request.args.length !== 1) {
      throw new RuntimeError("MCP call expects one object argument");
    }
    const arg = expectObject(request.args[0], "MCP call");
    const tool = arg.tool;
    if (typeof tool !== "string" || tool.length === 0) {
      throw new RuntimeError(`MCP ${request.toolName}.call tool is required`);
    }
    const args = arg.args ?? {};
    if (!isObject(args)) {
      throw new RuntimeError(`MCP ${request.toolName}.call args must be an object`);
    }
    return { tool, args: args as Record<string, RuntimeValue> };
  }

  if (request.args.length > 1) {
    throw new RuntimeError(`MCP ${request.toolName}.${request.method} expects zero or one argument`);
  }
  if (request.args.length === 0) {
    return { tool: request.method, args: {} };
  }
  const arg = expectObject(request.args[0], `MCP ${request.toolName}.${request.method}`);
  return { tool: request.method, args: arg as Record<string, RuntimeValue> };
}

function normalizeMcpResult(value: RuntimeValue): RuntimeObject {
  if (!isObject(value)) {
    throw new RuntimeError("MCP tools/call result must be an object");
  }
  const isError = value.isError === true;
  const content = Array.isArray(value.content) ? value.content : [];
  const structured = value.structuredContent ?? null;
  return {
    ok: !isError,
    text: extractText(content),
    content: sanitizeForJson(content),
    structured: sanitizeForJson(structured),
    isError,
  };
}

function extractText(content: RuntimeValue[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (isObject(item) && item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("\n");
}
