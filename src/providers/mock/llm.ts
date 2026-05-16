import type { RuntimeValue } from "../../runtime/values/values.js";
import type { JsonObject, JsonValue } from "../../runtime/values/values.js";
import type { GenerateRequest, LlmProvider } from "../../runtime/values/providers.js";

export class MockLlmProvider implements LlmProvider {
  async generate(request: GenerateRequest): Promise<RuntimeValue> {
    return request.builtContext.returnSchema ? buildValueFromJsonSchema(request.builtContext.returnSchema) : null;
  }
}

function buildValueFromJsonSchema(schema: JsonObject): JsonValue {
  if (schema.type === "object") {
    const properties = isJsonObject(schema.properties) ? schema.properties : {};
    const result: JsonObject = {};
    for (const [key, value] of Object.entries(properties)) {
      result[key] = isJsonObject(value) ? buildValueFromJsonSchema(value) : null;
    }
    return result;
  }
  if (schema.type === "array") return [];
  if (schema.type === "string") return "";
  if (schema.type === "number") return 0;
  if (schema.type === "boolean") return true;
  return {};
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
