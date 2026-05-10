import { RuntimeError } from "../../runtime/errors.js";
import type { Disposable } from "../../runtime/disposable.js";
import { uriScheme } from "../../runtime/uri.js";
import type { RuntimeValue, ToolCallRequest, ToolProvider } from "../../runtime/types.js";
import { closeDisposableProviders } from "./shared.js";

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
    await closeDisposableProviders(this.providers);
  }
}
