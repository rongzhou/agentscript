import { RuntimeError } from "../../runtime/errors.js";
import { uriScheme } from "../../runtime/uri.js";
import type { RuntimeValue, ToolCallRequest, ToolProvider } from "../../runtime/types.js";

export class SchemeToolProvider implements ToolProvider {
  constructor(private readonly providers: Record<string, ToolProvider>) {}

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const scheme = uriScheme(request.uri);
    const provider = this.providers[scheme];
    if (!provider) {
      throw new RuntimeError(`Unsupported tool URI scheme '${scheme}'`);
    }
    return provider.call(request);
  }

  async close(): Promise<void> {
    const providers = new Set(Object.values(this.providers));
    await Promise.all([...providers].map((provider) => provider.close?.()));
  }
}
