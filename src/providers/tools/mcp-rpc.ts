import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { RuntimeError } from "../../runtime/errors.js";
import type { McpServerConfig } from "./mcp-config.js";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: number;
  error: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export class StdioJsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly stderr: string[] = [];
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly serverKey: string,
    private readonly config: McpServerConfig,
  ) {
    this.child = spawn(config.command, config.args, {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => this.captureStderr(chunk));
    this.child.on("error", (error) =>
      this.failAll(new RuntimeError(`MCP server '${this.serverKey}' failed: ${error.message}`)),
    );
    this.child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.failAll(
          new RuntimeError(
            `MCP server '${this.serverKey}' exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
          ),
        );
      }
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new RuntimeError(`MCP server '${this.serverKey}' is closed`));
    }
    const id = this.nextId++;
    const payload = params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RuntimeError(`MCP server '${this.serverKey}' request '${method}' timed out`));
      }, this.config.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write(payload, reject, id);
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const payload = params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params };
    this.write(payload);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.failAll(new RuntimeError(`MCP server '${this.serverKey}' closed`));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        resolve();
      }, 1000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.child.kill("SIGTERM");
    });
  }

  private write(payload: unknown, reject?: (error: Error) => void, id?: number): void {
    const line = `${JSON.stringify(payload)}\n`;
    this.child.stdin.write(line, (error) => {
      if (!error) return;
      if (id !== undefined) {
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(id);
        }
      }
      reject?.(new RuntimeError(`MCP server '${this.serverKey}' write failed: ${error.message}`));
    });
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.failAll(new RuntimeError(`MCP server '${this.serverKey}' sent invalid JSON-RPC: ${detail}`));
      return;
    }
    if (!isJsonRpcResponse(message)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if ("error" in message) {
      pending.reject(new RuntimeError(`MCP server '${this.serverKey}' error: ${formatRpcError(message.error)}`));
      return;
    }
    pending.resolve(message.result);
  }

  private captureStderr(chunk: Buffer): void {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.length > 0) this.stderr.push(line);
    }
    while (this.stderr.length > 20) this.stderr.shift();
  }

  private failAll(error: Error): void {
    const stderr = this.stderr.length > 0 ? `; stderr: ${this.stderr.join(" | ")}` : "";
    const finalError = new RuntimeError(`${error.message}${stderr}`);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(finalError);
    }
  }
}

function isJsonRpcResponse(value: unknown): value is JsonRpcSuccess | JsonRpcFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return message.jsonrpc === "2.0" && typeof message.id === "number" && ("result" in message || "error" in message);
}

function formatRpcError(error: JsonRpcFailure["error"]): string {
  const code = typeof error.code === "number" ? `${error.code} ` : "";
  const message = typeof error.message === "string" ? error.message : "unknown error";
  return `${code}${message}`.trim();
}
