import { uriScheme } from "../../language/uri.js";
import type { ToolCallRequest, ToolProvider } from "../../runtime/values/providers.js";
import { MockToolProvider } from "./tool.js";

export class HostPassthroughToolProvider implements ToolProvider {
  private readonly mock: ToolProvider = new MockToolProvider();

  constructor(private readonly host: ToolProvider) {}

  async call(request: ToolCallRequest): ReturnType<ToolProvider["call"]> {
    if (uriScheme(request.uri) === "host") {
      return this.host.call(request);
    }
    return this.mock.call(request);
  }

  async close(): Promise<void> {
    await this.host.close?.();
    await this.mock.close?.();
  }
}
