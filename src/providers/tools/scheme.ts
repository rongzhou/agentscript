import { RuntimeError } from "../../runtime/core/errors.js";
import type { Disposable } from "../../runtime/values/providers.js";
import { uriScheme } from "../../language/uri.js";
import type { RuntimeValue } from "../../runtime/values/values.js";
import type { ToolCallRequest, ToolProvider } from "../../runtime/values/providers.js";
import { closeDisposableProviders } from "./shared.js";

export class SchemeToolProvider implements ToolProvider, Disposable {
  constructor(
    private readonly providers: Record<string, ToolProvider>,
    private readonly unsupportedSchemeLabel = "tool URI scheme",
  ) {}

  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const scheme = uriScheme(request.uri);
    const provider = this.providers[scheme];
    if (!provider) {
      throw new RuntimeError(`Unsupported ${this.unsupportedSchemeLabel} '${scheme}'`);
    }
    return provider.call(request);
  }

  async close(): Promise<void> {
    await closeDisposableProviders(this.providers);
  }
}
