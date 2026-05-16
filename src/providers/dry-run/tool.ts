import { NODE_SCHEME, NPM_SCHEME } from "../../language/schemes.js";
import { uriScheme } from "../../language/uri.js";
import type { RuntimeValue } from "../../runtime/values/values.js";
import type { ToolCallRequest, ToolProvider } from "../../runtime/values/providers.js";
import { createDefaultToolProvider } from "../tools/host.js";
import { checkNodeImport, checkNpmImport, loadNpmRegistry, type NpmRegistry } from "../../language/npm-registry.js";

class DryRunToolProvider implements ToolProvider {
  private readonly registry: NpmRegistry;

  constructor(
    workspaceRoot: string,
    private readonly fallback: ToolProvider,
  ) {
    this.registry = loadNpmRegistry(workspaceRoot);
  }

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const scheme = uriScheme(request.uri);
    if (scheme === NPM_SCHEME) {
      checkNpmImport(request.uri, this.registry);
      return null;
    }
    if (scheme === NODE_SCHEME) {
      checkNodeImport(request.uri, this.registry);
      return null;
    }
    return this.fallback.call(request);
  }

  async close(): Promise<void> {
    await this.fallback.close?.();
  }
}

export function createDryRunToolProvider(
  workspaceRoot = process.cwd(),
  hostNamespaces: Record<string, ToolProvider> = {},
): ToolProvider {
  return new DryRunToolProvider(workspaceRoot, createDefaultToolProvider(workspaceRoot, hostNamespaces));
}
