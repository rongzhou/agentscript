import { RuntimeError } from "../../runtime/core/errors.js";
import type { RuntimeValue } from "../../runtime/values/values.js";
import type { McpServerConfig } from "./mcp-config.js";
import { StdioJsonRpcClient } from "./mcp-rpc.js";
import { expectJsonRecord } from "./shared.js";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: RuntimeValue;
}

const MCP_PROTOCOL_VERSION = "2025-03-26";
const CLIENT_VERSION = "unknown";

export class McpClient {
  private readonly rpc: StdioJsonRpcClient;
  private initialized = false;
  private tools: McpToolInfo[] | undefined;

  constructor(
    private readonly serverKey: string,
    config: McpServerConfig,
  ) {
    this.rpc = new StdioJsonRpcClient(serverKey, config);
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.ensureInitialized();
    if (this.tools) return this.tools;
    const result = await this.rpc.request("tools/list", {});
    this.tools = parseToolsList(this.serverKey, result);
    return this.tools;
  }

  async callTool(name: string, args: Record<string, RuntimeValue>): Promise<RuntimeValue> {
    const tools = await this.listTools();
    if (!tools.some((tool) => tool.name === name)) {
      const available = tools.map((tool) => tool.name).join(", ") || "none";
      throw new RuntimeError(
        `Unknown MCP tool '${name}' for server '${this.serverKey}'. Available tools: ${available}`,
      );
    }
    return this.rpc.request("tools/call", { name, arguments: args }) as Promise<RuntimeValue>;
  }

  async close(): Promise<void> {
    await this.rpc.close();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.rpc.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "agentscript",
        version: CLIENT_VERSION,
      },
    });
    this.rpc.notify("notifications/initialized", {});
    this.initialized = true;
  }
}

function parseToolsList(serverKey: string, value: unknown): McpToolInfo[] {
  const root = expectJsonRecord(value, `MCP server '${serverKey}' tools/list result`);
  if (!Array.isArray(root.tools)) {
    throw new RuntimeError(`MCP server '${serverKey}' tools/list result must contain tools array`);
  }
  return root.tools.map((item, index) => parseToolInfo(serverKey, item, index));
}

function parseToolInfo(serverKey: string, value: unknown, index: number): McpToolInfo {
  const tool = expectJsonRecord(value, `MCP server '${serverKey}' tool ${index}`);
  if (typeof tool.name !== "string" || tool.name.length === 0) {
    throw new RuntimeError(`MCP server '${serverKey}' tool ${index} name is required`);
  }
  const result: McpToolInfo = { name: tool.name };
  if (typeof tool.description === "string") {
    result.description = tool.description;
  }
  if (tool.inputSchema !== undefined) {
    result.inputSchema = tool.inputSchema as RuntimeValue;
  }
  return result;
}
