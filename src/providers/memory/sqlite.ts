import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RuntimeError } from "../../runtime/errors.js";
import { isObject } from "../../runtime/guards.js";
import type { MemoryAddRequest, MemoryQueryRequest, RuntimeObject, RuntimeValue } from "../../runtime/types.js";
import { createMemoryEnvelope, matchesQuery, readLimit, type MemoryEnvelope } from "./shared.js";

interface SqliteMemoryRow {
  id: string;
  created_at: string;
  updated_at: string;
  record_json: string;
}

export interface SqliteMemoryTarget {
  path: string;
  namespace: string;
}

export class SqliteMemoryBackend {
  private readonly databases = new Map<string, DatabaseSync>();

  add(request: MemoryAddRequest, target: SqliteMemoryTarget): RuntimeValue {
    mkdirSync(dirname(target.path), { recursive: true });
    const db = this.database(target.path);
    const envelope = createMemoryEnvelope(request.record as RuntimeObject);
    db.prepare(`
        INSERT INTO memory_records (namespace, id, created_at, updated_at, kind, text, record_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
      target.namespace,
      envelope.id,
      envelope.created_at,
      envelope.updated_at,
      typeof envelope.record.kind === "string" ? envelope.record.kind : null,
      typeof envelope.record.text === "string" ? envelope.record.text : null,
      JSON.stringify(envelope.record),
    );
    return envelope;
  }

  query(request: MemoryQueryRequest, target: SqliteMemoryTarget): RuntimeValue {
    const query = request.query as RuntimeObject;
    const limit = readLimit(query.limit);
    if (!existsSync(target.path)) return [];

    const db = this.database(target.path);
    const conditions = ["namespace = ?"];
    const params: (string | number)[] = [target.namespace];

    if (typeof query.kind === "string") {
      conditions.push("kind = ?");
      params.push(query.kind);
    }

    const needPostFilter = query.text !== undefined || query.where !== undefined;
    const sql = `
        SELECT id, created_at, updated_at, record_json
        FROM memory_records
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
        ${needPostFilter ? "" : "LIMIT ?"}
      `;
    const sqlParams = needPostFilter ? params : [...params, limit];
    const rows = db
      .prepare(sql)
      .all(...sqlParams)
      .map(readSqliteMemoryRow);

    const records = rows.map(rowToEnvelope).filter((item) => matchesQuery(item.record, query));

    return records.slice(0, limit);
  }

  async close(): Promise<void> {
    for (const db of this.databases.values()) {
      db.close();
    }
    this.databases.clear();
  }

  private database(path: string): DatabaseSync {
    let db = this.databases.get(path);
    if (!db) {
      db = openSqlite(path);
      this.databases.set(path, db);
    }
    return db;
  }
}

function openSqlite(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_records (
      namespace TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      kind TEXT,
      text TEXT,
      record_json TEXT NOT NULL,
      PRIMARY KEY (namespace, id)
    )
  `);
  return db;
}

function readSqliteMemoryRow(value: unknown): SqliteMemoryRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuntimeError("Invalid sqlite memory row: expected an object");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string" ||
    typeof row.record_json !== "string"
  ) {
    throw new RuntimeError("Invalid sqlite memory row: expected string id, timestamps, and record_json");
  }
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    record_json: row.record_json,
  };
}

function rowToEnvelope(row: SqliteMemoryRow): MemoryEnvelope {
  let record: RuntimeValue;
  try {
    record = JSON.parse(row.record_json) as RuntimeValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RuntimeError(`Invalid sqlite memory record '${row.id}': ${message}`);
  }
  if (!isObject(record)) {
    throw new RuntimeError(`Invalid sqlite memory record '${row.id}': record_json must be an object`);
  }
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    record,
  };
}
