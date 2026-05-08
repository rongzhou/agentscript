import { RuntimeError } from "../../runtime/errors.js";
import { uriScheme } from "../../runtime/uri.js";
import type { RuntimeValue, ToolCallRequest, ToolProvider } from "../../runtime/types.js";
import { EnvToolProvider } from "./env.js";
import { FileToolProvider } from "./file.js";
import { HttpToolProvider } from "./http.js";
import { SchemeToolProvider } from "./scheme.js";
import { ShellToolProvider } from "./shell.js";
import { Workspace } from "./shared.js";

export class HostToolProvider implements ToolProvider {
  private readonly providers: Record<string, ToolProvider>;

  constructor(workspaceRoot = process.cwd()) {
    const workspace = new Workspace(workspaceRoot);
    const http = new HttpToolProvider();
    this.providers = {
      env: new EnvToolProvider(),
      file: new FileToolProvider(workspace),
      http,
      https: http,
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
}

export function createDefaultToolProvider(workspaceRoot = process.cwd()): ToolProvider {
  const host = new HostToolProvider(workspaceRoot);
  return new SchemeToolProvider({ env: host, file: host, http: host, https: host, sh: host });
}
