import { uriScheme } from "../language/uri.js";
import { checkNodeImport, checkNpmImport, loadNpmRegistry } from "../providers/tools/npm-registry.js";
import { createDefaultToolProvider } from "../providers/tools/index.js";
import { buildValueFromShape } from "../runtime/shape.js";
import type { GenerateRequest, LlmProvider, RuntimeValue, ToolCallRequest, ToolProvider } from "../runtime/types.js";

export class DryRunLlmProvider implements LlmProvider {
  async generate(request: GenerateRequest): Promise<RuntimeValue> {
    return request.returnShape ? buildValueFromShape(request.returnShape) : null;
  }
}

class DryRunToolProvider implements ToolProvider {
  private readonly registry = loadNpmRegistry(process.cwd());

  constructor(private readonly fallback: ToolProvider) {}

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const scheme = uriScheme(request.uri);
    if (scheme === "npm") {
      checkNpmImport(request.uri, this.registry);
      return null;
    }
    if (scheme === "node") {
      checkNodeImport(request.uri, this.registry);
      return null;
    }
    return this.fallback.call(request);
  }
}

export function createDryRunToolProvider(): ToolProvider {
  return new DryRunToolProvider(createDefaultToolProvider(process.cwd()));
}
