import { buildValueFromJsonSchema } from "../../runtime/schema-defaults.js";
import type { GenerateRequest, LlmProvider, RuntimeValue } from "../../runtime/types.js";

export class MockLlmProvider implements LlmProvider {
  async generate(request: GenerateRequest): Promise<RuntimeValue> {
    return request.builtContext.returnSchema ? buildValueFromJsonSchema(request.builtContext.returnSchema) : null;
  }
}
