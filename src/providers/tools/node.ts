import type { RuntimeValue, ToolCallRequest, ToolProvider } from "../../runtime/types.js";
import { checkNodeImport, type NpmRegistry } from "./npm-registry.js";
import { invokeModuleMember } from "./module-tool.js";

export class NodeToolProvider implements ToolProvider {
  private readonly modules = new Map<string, unknown>();

  constructor(private readonly registry: NpmRegistry) {}

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const moduleName = checkNodeImport(request.uri, this.registry);
    const mod = await this.loadModule(moduleName);
    return invokeModuleMember(mod, request, { schemeLabel: "node", toolLabel: request.toolName });
  }

  private async loadModule(moduleName: string): Promise<unknown> {
    const target = `node:${moduleName}`;
    const cached = this.modules.get(target);
    if (cached) return cached;
    const mod = await import(target);
    this.modules.set(target, mod);
    return mod;
  }
}
