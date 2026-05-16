import { RuntimeError } from "../../runtime/errors.js";
import type { RuntimeValue, ToolCallRequest, ToolProvider } from "../../runtime/types.js";
import { analyzeSource as analyzeArchitectSource } from "../analyze.js";
import { compileSpec } from "../compiler/index.js";
import { parseAgentSpecDraft } from "../spec/schema.js";
import { validateSpec } from "../validator/index.js";
import { expectObject, readRequiredString } from "../../providers/tools/shared.js";

export class ArchitectToolProvider implements ToolProvider {
  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    if (new URL(request.uri).pathname.replace(/^\/$/, "") !== "") {
      return {
        ok: false,
        code: "invalid_uri",
        message: "host://architect does not accept a path",
      };
    }
    switch (request.method) {
      case "validateSpec":
        return this.validateSpec(request);
      case "compileSpec":
        return this.compileSpec(request);
      case "analyzeSource":
        return this.analyzeSource(request);
      default:
        throw new RuntimeError(`Unknown Architect method '${request.method}'`);
    }
  }

  validateSpec(request: ToolCallRequest): RuntimeValue {
    const args = expectObject(request.args[0], "Architect.validateSpec");
    const draft = parseAgentSpecDraft(args.spec);
    if (!draft) return invalidSpecInput();
    return validateSpec(draft) as unknown as RuntimeValue;
  }

  compileSpec(request: ToolCallRequest): RuntimeValue {
    const args = expectObject(request.args[0], "Architect.compileSpec");
    const draft = parseAgentSpecDraft(args.spec);
    if (!draft) return invalidSpecInput();
    return compileSpec(draft) as unknown as RuntimeValue;
  }

  analyzeSource(request: ToolCallRequest): RuntimeValue {
    const args = expectObject(request.args[0], "Architect.analyzeSource");
    const source = readRequiredString(args.source, "source");
    const result = analyzeArchitectSource(source);
    if (result.ok) return result as unknown as RuntimeValue;
    const parseError = result.diagnostics.find((diagnostic) => diagnostic.code === "parse_error");
    return parseError
      ? { ok: false, code: "parse_error", message: parseError.message, diagnostics: [] }
      : (result as unknown as RuntimeValue);
  }
}

function invalidSpecInput(): RuntimeValue {
  return {
    ok: false,
    code: "invalid_input",
    message: "spec must be a JSON object",
  };
}
