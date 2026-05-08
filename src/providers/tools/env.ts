import { RuntimeError } from "../../runtime/errors.js";
import type { RuntimeValue, ToolCallRequest, ToolProvider } from "../../runtime/types.js";
import { expectObject, readRequiredString } from "./shared.js";

export class EnvToolProvider implements ToolProvider {
  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    if (request.method !== "get") {
      throw new RuntimeError(`Unsupported env method '${request.method}'. Supported: get`);
    }
    const args = expectObject(request.args[0], "Env.get");
    return process.env[readRequiredString(args.name, "Env.get.name")] ?? null;
  }
}
