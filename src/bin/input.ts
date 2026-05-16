import { stdin as inputStream, stdout as outputStream } from "node:process";
import { createInterface } from "node:readline/promises";
import type { JsonObject, RuntimeValue } from "../runtime/values/values.js";
import type { InputProvider, InputRequest } from "../runtime/values/providers.js";

export function parseJsonObjectInput(source: string, label: string): JsonObject {
  const value = JSON.parse(source) as RuntimeValue;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function parseInteractiveInputValue(value: string): RuntimeValue {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  try {
    return JSON.parse(trimmed) as RuntimeValue;
  } catch {
    return value;
  }
}

export interface ReadlineQuestion {
  question(prompt: string): Promise<string>;
}

export function createReadlineInputProvider(reader: ReadlineQuestion): InputProvider {
  return {
    async read(request: InputRequest): Promise<RuntimeValue> {
      const answer = await reader.question(`${request.path.join(".")}: `);
      return parseInteractiveInputValue(answer);
    },
  };
}

export function createTerminalInputProvider(): (InputProvider & { close(): void }) | undefined {
  if (!inputStream.isTTY || !outputStream.isTTY) {
    return undefined;
  }
  const reader = createInterface({ input: inputStream, output: outputStream });
  return {
    ...createReadlineInputProvider(reader),
    close: () => reader.close(),
  };
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
