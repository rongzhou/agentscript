import {
  FILE_SCHEME,
  ENV_SCHEME,
  HTTP_SCHEME,
  HTTPS_SCHEME,
  MCP_SCHEME,
  NODE_SCHEME,
  NPM_SCHEME,
  SHELL_SCHEME,
  OPTIMIZER_SCHEME,
} from "../../language/schemes.js";
import type { ToolProvider } from "../../runtime/types.js";
import { RuntimeError } from "../../runtime/errors.js";
import { OptimizerToolProvider, type OptimizerToolContext } from "../../toolchain/optimizer.js";
import { EnvToolProvider } from "./env.js";
import { FileToolProvider } from "./file.js";
import { HttpToolProvider } from "./http.js";
import { McpToolProvider } from "./mcp.js";
import { NodeToolProvider } from "./node.js";
import { NpmToolProvider } from "./npm.js";
import { loadNpmRegistry } from "./npm-registry.js";
import { SchemeToolProvider } from "./scheme.js";
import { ShellToolProvider } from "./shell.js";
import { Workspace } from "../shared/workspace.js";

export class HostToolProvider extends SchemeToolProvider {
  constructor(workspaceRoot = process.cwd(), optimizer?: Partial<OptimizerToolContext>) {
    const workspace = new Workspace(workspaceRoot);
    const http = new HttpToolProvider();
    const mcp = new McpToolProvider(workspaceRoot);
    const npmRegistry = loadNpmRegistry(workspaceRoot);
    super(
      {
        host: new HostNamespaceProvider({
          [OPTIMIZER_SCHEME]: new OptimizerToolProvider({
            workspaceRoot,
            ...optimizer,
          }),
        }),
        [ENV_SCHEME]: new EnvToolProvider(),
        [FILE_SCHEME]: new FileToolProvider(workspace),
        [HTTP_SCHEME]: http,
        [HTTPS_SCHEME]: http,
        [MCP_SCHEME]: mcp,
        [NODE_SCHEME]: new NodeToolProvider(npmRegistry),
        [NPM_SCHEME]: new NpmToolProvider(npmRegistry, workspaceRoot),
        [SHELL_SCHEME]: new ShellToolProvider(workspace),
      },
      "host tool scheme",
    );
  }
}

class HostNamespaceProvider implements ToolProvider {
  constructor(private readonly providers: Record<string, ToolProvider>) {}

  async call(request: Parameters<ToolProvider["call"]>[0]): ReturnType<ToolProvider["call"]> {
    const namespace = new URL(request.uri).hostname;
    const provider = this.providers[namespace];
    if (!provider) {
      throw new RuntimeError(`Unsupported host namespace '${namespace}'`);
    }
    return provider.call(request);
  }
}

export function createDefaultToolProvider(
  workspaceRoot = process.cwd(),
  optimizer?: Partial<OptimizerToolContext>,
): ToolProvider {
  return new HostToolProvider(workspaceRoot, optimizer);
}
