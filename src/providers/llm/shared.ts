import { RuntimeError } from "../../runtime/errors.js";
import type { GenerateRequest, JsonObject, JsonValue, RuntimeValue } from "../../runtime/types.js";
import type { FetchLike } from "./types.js";

export function budgetToTokenLimit(request: GenerateRequest): number | undefined {
  if (!request.maxOutput) {
    return undefined;
  }
  if (request.maxOutput.unit === "k") {
    return Math.max(1, Math.floor(request.maxOutput.amount * 1000));
  }
  return Math.max(1, Math.floor(request.maxOutput.amount));
}

export async function postJson(
  fetchImpl: FetchLike,
  url: string,
  body: JsonObject,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<JsonValue> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted) {
      throw new RuntimeError(`LLM provider request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw new RuntimeError(`LLM provider request failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new RuntimeError(`LLM provider request failed (${response.status}): ${text}`);
  }
  return parseProviderJson(text);
}

export function finalizeLlmResponse(text: string, request: GenerateRequest): RuntimeValue {
  return request.returnShape ? parseJsonText(text) : text;
}

/**
 * Parses LLM text as JSON for structured generate responses.
 * Candidate order is: the entire text, fenced markdown blocks, then the first balanced JSON object.
 */
export function parseJsonText(text: string): RuntimeValue {
  const candidates = [text, ...extractJsonCandidates(text)];
  try {
    return JSON.parse(candidates[0]!) as RuntimeValue;
  } catch {
    for (const candidate of candidates.slice(1)) {
      try {
        return JSON.parse(candidate) as RuntimeValue;
      } catch {
        continue;
      }
    }
    throw new RuntimeError(`LLM provider did not return JSON: ${snippet(text)}`);
  }
}

export function readPath(value: JsonValue, path: Array<string | number>): string {
  let current: JsonValue | undefined = value;
  for (const segment of path) {
    if (current === null || current === undefined) {
      break;
    }
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
    } else if (typeof current === "object" && typeof segment === "string") {
      current = (current as Record<string, JsonValue>)[segment];
    } else {
      current = undefined;
    }
  }
  if (typeof current !== "string") {
    throw new RuntimeError(`LLM provider response is missing '${path.join(".")}'`);
  }
  return current;
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function requireApiKey(provided: string | undefined, environmentName: string, providerLabel: string): string {
  const apiKey = provided ?? process.env[environmentName];
  if (!apiKey) {
    throw new RuntimeError(`${environmentName} is required for ${providerLabel}:// models`);
  }
  return apiKey;
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(fenced)) {
    if (match[1]) {
      candidates.push(match[1].trim());
    }
  }
  const object = extractFirstJsonObject(text);
  if (object) {
    candidates.push(object);
  }
  return candidates;
}

function extractFirstJsonObject(text: string): string | undefined {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (start >= 0 && inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (start >= 0 && char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (start < 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === "}" && start >= 0) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function parseProviderJson(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new RuntimeError(`LLM provider returned invalid JSON response: ${snippet(text)}`);
  }
}

function snippet(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}
