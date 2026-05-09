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
  add(request: MemoryAddRequest, target: SqliteMemoryTarget): RuntimeValue {
    mkdirSync(dirname(target.path), { recursive: true });
    const db = openSqlite(target.path);
    try {
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
    } finally {
      db.close();
    }
  }

  query(request: MemoryQueryRequest, target: SqliteMemoryTarget): RuntimeValue {
    const query = request.query as RuntimeObject;
    const limit = readLimit(query.limit);
    if (!existsSync(target.path)) return [];

    const db = openSqlite(target.path);
    try {
      const conditions = ["namespace = ?"];
      const params: (string | number)[] = [target.namespace];

      if (typeof query.kind === "string") {
        conditions.push("kind = ?");
        params.push(query.kind);
      }
      if (typeof query.text === "string") {
        conditions.push("(text LIKE ? ESCAPE '\\' OR record_json LIKE ? ESCAPE '\\')");
        const pattern = `%${escapeLike(query.text)}%`;
        params.push(pattern, pattern);
      }

      const needPostFilter = query.where !== undefined;
      const sql = `
        SELECT id, created_at, updated_at, record_json
        FROM memory_records
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
        ${needPostFilter ? "" : "LIMIT ?"}
      `;
      const sqlParams = needPostFilter ? params : [...params, limit];
      const rows = db.prepare(sql).all(...sqlParams) as unknown as SqliteMemoryRow[];

      const records = rows.map((row) => rowToEnvelope(row)).filter((item) => matchesQuery(item.record, query));

      return records.slice(0, limit);
    } finally {
      db.close();
    }
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

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
