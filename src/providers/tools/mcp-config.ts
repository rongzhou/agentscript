import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RuntimeError } from "../../runtime/errors.js";
import { expectPlainObject } from "./shared.js";

export interface McpRegistry {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpServerConfig {
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const CONFIG_FILE = "agentscript.mcp.json";

export function loadMcpRegistry(workspaceRoot: string): McpRegistry {
  const path = join(workspaceRoot, CONFIG_FILE);
  if (!existsSync(path)) {
    return { mcpServers: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeError(`Invalid MCP registry '${CONFIG_FILE}': ${message}`);
  }

  return parseMcpRegistry(parsed);
}

function parseMcpRegistry(value: unknown): McpRegistry {
  const root = expectPlainObject(value, "MCP registry");
  const serversValue = root.mcpServers;
  if (serversValue === undefined) {
    return { mcpServers: {} };
  }
  const servers = expectPlainObject(serversValue, "MCP registry mcpServers");
  const result: Record<string, McpServerConfig> = {};
  for (const [key, item] of Object.entries(servers)) {
    result[key] = parseServerConfig(key, item);
  }
  return { mcpServers: result };
}

function parseServerConfig(key: string, value: unknown): McpServerConfig {
  const server = expectPlainObject(value, `MCP server '${key}'`);
  if (server.transport !== "stdio") {
    throw new RuntimeError(`MCP server '${key}' transport must be 'stdio'`);
  }
  if (typeof server.command !== "string" || server.command.length === 0) {
    throw new RuntimeError(`MCP server '${key}' command is required`);
  }
  return {
    transport: "stdio",
    command: server.command,
    args: readStringArray(server.args, `MCP server '${key}' args`),
    env: readEnv(server.env, key),
    timeoutMs: readTimeout(server.timeoutMs, key),
  };
}

function readStringArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new RuntimeError(`${name} must be a string array`);
  }
  return value;
}

function readEnv(value: unknown, key: string): Record<string, string> {
  if (value === undefined) return {};
  const env = expectPlainObject(value, `MCP server '${key}' env`);
  const result: Record<string, string> = {};
  for (const [name, item] of Object.entries(env)) {
    if (typeof item !== "string") {
      throw new RuntimeError(`MCP server '${key}' env '${name}' must be a string`);
    }
    result[name] = expandEnvValue(item);
  }
  return result;
}

function readTimeout(value: unknown, key: string): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new RuntimeError(`MCP server '${key}' timeoutMs must be a positive integer`);
}

function expandEnvValue(value: string): string {
  return value.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => process.env[name] ?? "");
}
