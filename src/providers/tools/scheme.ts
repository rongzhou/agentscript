import { RuntimeError } from "../../runtime/errors.js";
import { isDisposable } from "../../runtime/types.js";
import { uriScheme } from "../../runtime/uri.js";
import type { Disposable, RuntimeValue, ToolCallRequest, ToolProvider } from "../../runtime/types.js";

export class SchemeToolProvider implements ToolProvider, Disposable {
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
    await Promise.all([...providers].filter(isDisposable).map((provider) => provider.close()));
  }
}
