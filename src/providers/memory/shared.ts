import { randomUUID } from "node:crypto";
import { RuntimeError } from "../../runtime/core/errors.js";
import { isObject } from "../../runtime/values/guards.js";
import { runtimeValuesEqual, sanitizeForJson } from "../../runtime/values/json.js";
import type { RuntimeObject, RuntimeValue } from "../../runtime/values/values.js";

export interface MemoryEnvelope extends RuntimeObject {
  id: string;
  created_at: string;
  updated_at: string;
  record: RuntimeObject;
}

export function readLimit(value: RuntimeValue | undefined): number {
  if (value === undefined || value === null) return 10;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new RuntimeError("memory.query limit must be a positive integer");
  }
  return value;
}

export function createMemoryEnvelope(record: RuntimeObject): MemoryEnvelope {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    created_at: now,
    updated_at: now,
    record,
  };
}

export function matchesQuery(record: RuntimeObject, query: RuntimeObject): boolean {
  if (typeof query.kind === "string" && record.kind !== query.kind) return false;
  if (typeof query.text === "string" && !matchesText(record, query.text)) return false;
  if (query.where !== undefined) {
    if (!isObject(query.where)) {
      throw new RuntimeError("memory.query where must be an object");
    }
    for (const [key, expected] of Object.entries(query.where)) {
      if (!(key in record) || !runtimeValuesEqual(record[key], expected)) return false;
    }
  }
  return true;
}

export function isMemoryEnvelope(value: unknown): value is MemoryEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.created_at === "string" &&
    typeof item.updated_at === "string" &&
    typeof item.record === "object" &&
    item.record !== null &&
    !Array.isArray(item.record)
  );
}

function matchesText(record: RuntimeObject, text: string): boolean {
  const needle = text.toLowerCase();
  const candidates = [typeof record.text === "string" ? record.text : "", JSON.stringify(sanitizeForJson(record))];
  return candidates.some((candidate) => candidate.toLowerCase().includes(needle));
}
