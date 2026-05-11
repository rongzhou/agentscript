import {
  FILE_SCHEME,
  ENV_SCHEME,
  HTTP_SCHEME,
  HTTPS_SCHEME,
  MCP_SCHEME,
  NODE_SCHEME,
  NPM_SCHEME,
  SHELL_SCHEME,
} from "../../language/schemes.js";
import type { ToolProvider } from "../../runtime/types.js";
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
  constructor(workspaceRoot = process.cwd()) {
    const workspace = new Workspace(workspaceRoot);
    const http = new HttpToolProvider();
    const mcp = new McpToolProvider(workspaceRoot);
    const npmRegistry = loadNpmRegistry(workspaceRoot);
    super(
      {
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

export function createDefaultToolProvider(workspaceRoot = process.cwd()): ToolProvider {
  return new HostToolProvider(workspaceRoot);
}
