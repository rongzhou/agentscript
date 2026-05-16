import { RuntimeError } from "../../runtime/core/errors.js";
import { isObject } from "../../runtime/values/guards.js";
import { sanitizeForJson } from "../../runtime/values/json.js";
import type { RuntimeValue } from "../../runtime/values/values.js";
import type { ToolCallRequest, ToolProvider } from "../../runtime/values/providers.js";
import { expectObject, parseJsonOrNull, readPositiveInteger, readRequiredString } from "./shared.js";

const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

export class HttpToolProvider implements ToolProvider {
  async call(request: ToolCallRequest): Promise<RuntimeValue> {
    const args = expectObject(request.args[0], `Http.${request.method}`);
    const url = resolveHttpUrl(request.uri, readRequiredString(args.url, "Http.url"));
    const timeout = readPositiveInteger(args.timeout, DEFAULT_HTTP_TIMEOUT_MS);
    const controller = new AbortController();
    const init: RequestInit = {
      method: request.method.toUpperCase(),
      signal: controller.signal,
    };
    if (isObject(args.headers)) {
      init.headers = sanitizeForJson(args.headers) as Record<string, string>;
    }
    if ("body" in args) {
      init.body = typeof args.body === "string" ? args.body : JSON.stringify(sanitizeForJson(args.body));
    }
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, init);
      const text = await response.text();
      return { ok: response.ok, status: response.status, body: text, json: parseJsonOrNull(text) };
    } finally {
      clearTimeout(timer);
    }
  }
}

function resolveHttpUrl(importUri: string, requestedUrl: string): string {
  const base = new URL(importUri);
  const target = new URL(requestedUrl, base);
  if (target.origin !== base.origin) {
    throw new RuntimeError(`HTTP tool URL origin '${target.origin}' does not match import origin '${base.origin}'`);
  }
  return target.toString();
}
