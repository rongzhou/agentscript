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
import { Workspace } from "./shared.js";

export class HostToolProvider extends SchemeToolProvider {
  constructor(workspaceRoot = process.cwd()) {
    const workspace = new Workspace(workspaceRoot);
    const http = new HttpToolProvider();
    const mcp = new McpToolProvider(workspaceRoot);
    const npmRegistry = loadNpmRegistry(workspaceRoot);
    super(
      {
        env: new EnvToolProvider(),
        file: new FileToolProvider(workspace),
        http,
        https: http,
        mcp,
        node: new NodeToolProvider(npmRegistry),
        npm: new NpmToolProvider(npmRegistry, workspaceRoot),
        sh: new ShellToolProvider(workspace),
      },
      "host tool scheme",
    );
  }
}

export function createDefaultToolProvider(workspaceRoot = process.cwd()): ToolProvider {
  return new HostToolProvider(workspaceRoot);
}
