import { RuntimeError } from "../../runtime/errors.js";
import type { Disposable } from "../../runtime/disposable.js";
import { uriScheme } from "../../language/uri.js";
import type { RuntimeValue, ToolCallRequest, ToolProvider } from "../../runtime/types.js";
import { EnvToolProvider } from "./env.js";
import { FileToolProvider } from "./file.js";
import { HttpToolProvider } from "./http.js";
import { McpToolProvider } from "./mcp.js";
import { NodeToolProvider } from "./node.js";
import { NpmToolProvider } from "./npm.js";
import { loadNpmRegistry } from "./npm-registry.js";
import { ShellToolProvider } from "./shell.js";
import { closeDisposableProviders, Workspace } from "./shared.js";

export class HostToolProvider implements ToolProvider, Disposable {
  private readonly providers: Record<string, ToolProvider>;

  constructor(workspaceRoot = process.cwd()) {
    const workspace = new Workspace(workspaceRoot);
    const http = new HttpToolProvider();
    const mcp = new McpToolProvider(workspaceRoot);
    const npmRegistry = loadNpmRegistry(workspaceRoot);
    this.providers = {
      env: new EnvToolProvider(),
      file: new FileToolProvider(workspace),
      http,
      https: http,
      mcp,
      node: new NodeToolProvider(npmRegistry),
      npm: new NpmToolProvider(npmRegistry, workspaceRoot),
      sh: new ShellToolProvider(workspace),
    };
  }

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const scheme = uriScheme(request.uri);
    const provider = this.providers[scheme];
    if (!provider) {
      throw new RuntimeError(`Unsupported host tool scheme '${scheme}'`);
    }
    return provider.call(request);
  }

  async close(): Promise<void> {
    await closeDisposableProviders(this.providers);
  }
}

export function createDefaultToolProvider(workspaceRoot = process.cwd()): ToolProvider {
  return new HostToolProvider(workspaceRoot);
}
