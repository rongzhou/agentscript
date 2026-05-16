import { RuntimeError } from "../../runtime/core/errors.js";
import { sanitizeForJson } from "../../runtime/values/json.js";
import type { RuntimeValue } from "../../runtime/values/values.js";
import type { ToolCallRequest, ToolProvider } from "../../runtime/values/providers.js";
import { analyzeSource as analyzeArchitectSource } from "../compiler/analyze.js";
import { compileSpec as compileAgentSpec } from "../compiler/index.js";
import { asAgentSpecDraft } from "../spec/types.js";
import { validateSpec } from "../validator/index.js";
import { expectRuntimeObject, readRequiredString, softError } from "../../providers/tools/shared.js";

export class ArchitectToolProvider implements ToolProvider {
  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    if (new URL(request.uri).pathname.replace(/^\/$/, "") !== "") {
      return softError("invalid_uri", "host://architect does not accept a path");
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
    const args = expectRuntimeObject(request.args[0], "Architect.validateSpec");
    const draft = asAgentSpecDraft(args.spec);
    if (!draft) return invalidSpecInput();
    return toRuntimeValue(validateSpec(draft));
  }

  compileSpec(request: ToolCallRequest): RuntimeValue {
    const args = expectRuntimeObject(request.args[0], "Architect.compileSpec");
    const draft = asAgentSpecDraft(args.spec);
    if (!draft) return invalidSpecInput();
    return toRuntimeValue(compileAgentSpec(draft));
  }

  analyzeSource(request: ToolCallRequest): RuntimeValue {
    const args = expectRuntimeObject(request.args[0], "Architect.analyzeSource");
    const source = readRequiredString(args.source, "source");
    const result = analyzeArchitectSource(source);
    if (result.ok) return toRuntimeValue(result);
    const parseError = result.diagnostics.find((diagnostic) => diagnostic.code === "parse_error");
    return parseError
      ? { ok: false, code: "parse_error", message: parseError.message, diagnostics: [] }
      : toRuntimeValue(result);
  }
}

function invalidSpecInput(): RuntimeValue {
  return softError("invalid_input", "spec must be a JSON object");
}

function toRuntimeValue(value: unknown): RuntimeValue {
  return sanitizeForJson(value) as RuntimeValue;
}
