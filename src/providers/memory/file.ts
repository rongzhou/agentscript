import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { RuntimeError } from "../../runtime/core/errors.js";
import type { RuntimeObject, RuntimeValue } from "../../runtime/values/values.js";
import type { MemoryAddRequest, MemoryQueryRequest } from "../../runtime/values/providers.js";
import { createMemoryEnvelope, isMemoryEnvelope, matchesQuery, readLimit, type MemoryEnvelope } from "./shared.js";

export class FileMemoryBackend {
  add(request: MemoryAddRequest, path: string): RuntimeValue {
    mkdirSync(dirname(path), { recursive: true });
    const envelope = createMemoryEnvelope(request.record as RuntimeObject);
    appendFileSync(path, `${JSON.stringify(envelope)}\n`, "utf8");
    return envelope;
  }

  query(request: MemoryQueryRequest, path: string): RuntimeValue {
    const query = request.query as RuntimeObject;
    const limit = readLimit(query.limit);
    if (!existsSync(path)) return [];

    const records = readJsonl(path)
      .reverse()
      .filter((item) => matchesQuery(item.record, query));
    return records.slice(0, limit);
  }
}

function readJsonl(path: string): MemoryEnvelope[] {
  const text = readFileSync(path, "utf8");
  const result: MemoryEnvelope[] = [];
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RuntimeError(`Invalid memory JSONL at ${path}:${index + 1}: ${message}`);
    }
    if (!isMemoryEnvelope(value)) {
      throw new RuntimeError(`Invalid memory JSONL envelope at ${path}:${index + 1}`);
    }
    result.push(value);
  }
  return result;
}
