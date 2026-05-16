import { RuntimeError } from "../../runtime/core/errors.js";
import type { RuntimeValue } from "../../runtime/values/values.js";
import type { ToolCallRequest, ToolProvider } from "../../runtime/values/providers.js";
import { expectRuntimeObject, readRequiredString } from "./shared.js";

export class EnvToolProvider implements ToolProvider {
  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    if (request.method !== "get") {
      throw new RuntimeError(`Unsupported env method '${request.method}'. Supported: get`);
    }
    const args = expectRuntimeObject(request.args[0], "Env.get");
    return { ok: true, value: process.env[readRequiredString(args.name, "Env.get.name")] ?? null };
  }
}
