/**
 * Dev-only: a D1Database-compatible adapter backed by better-sqlite3.
 * This is ONLY loaded when getCloudflareContext() is unavailable (i.e. `next dev`).
 * Never imported in production — the Cloudflare Workers runtime uses real D1.
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { SCHEMA_SQL } from "./test-db";

let _db: Database.Database | null = null;

function getLocalDb(): Database.Database {
  if (_db) return _db;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, "dev.sqlite3");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  _db = db;
  return db;
}

// ---------------------------------------------------------------------------
// D1-compatible statement wrapper
// ---------------------------------------------------------------------------

class LocalStatement {
  private sql: string;
  private params: unknown[];

  constructor(sql: string, params: unknown[] = []) {
    this.sql = sql;
    this.params = params;
  }

  bind(...params: unknown[]): LocalStatement {
    return new LocalStatement(this.sql, params);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const db = getLocalDb();
    try {
      const stmt = db.prepare(this.sql);
      const row = stmt.get(...(this.params as Parameters<typeof stmt.get>));
      return (row ?? null) as T | null;
    } catch {
      return null;
    }
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const db = getLocalDb();
    try {
      const stmt = db.prepare(this.sql);
      const rows = stmt.all(...(this.params as Parameters<typeof stmt.all>));
      return { results: rows as T[] };
    } catch {
      return { results: [] };
    }
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    const db = getLocalDb();
    try {
      const stmt = db.prepare(this.sql);
      const info = stmt.run(...(this.params as Parameters<typeof stmt.run>));
      return { meta: { last_row_id: info.lastInsertRowid as number, changes: info.changes } };
    } catch {
      return { meta: { last_row_id: 0, changes: 0 } };
    }
  }
}

// ---------------------------------------------------------------------------
// D1Database-like façade
// ---------------------------------------------------------------------------

export const localD1 = {
  prepare(sql: string): LocalStatement {
    return new LocalStatement(sql);
  },

  async batch(statements: LocalStatement[]): Promise<void> {
    const db = getLocalDb();
    const runAll = db.transaction(() => {
      for (const stmt of statements) {
        // Access private fields via type cast for the batch transaction
        const s = stmt as unknown as { sql: string; params: unknown[] };
        db.prepare(s.sql).run(...(s.params as Parameters<ReturnType<typeof db.prepare>["run"]>));
      }
    });
    runAll();
  },
} as const;
