/**
 * Cloudflare D1 database adapter for MediaHub.
 * Provides a unified tagged template literal `sql` interface that runs on:
 *   1. Cloudflare Workers (production & preview) via `@opennextjs/cloudflare` D1 binding (`env.DB`).
 *   2. Local development & Jest test suites via `better-sqlite3`.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { SCHEMA_SQL, setTestDb, getTestDb } from "./test-db";
export { setTestDb, getTestDb };

let initialized = false;

/**
 * Retrieves the Cloudflare D1 Database binding if running in a Cloudflare context.
 */
export async function getD1Database(): Promise<D1Database | null> {
  if (getTestDb()) return null;

  // 1. Check globalThis binding (worker isolate)
  const globalEnv = (globalThis as any).env || (globalThis as any).__env__;
  if (globalEnv?.DB) {
    return globalEnv.DB as D1Database;
  }

  // 2. Check OpenNext Cloudflare Context
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    if ((ctx?.env as any)?.DB) {
      return (ctx.env as any).DB as D1Database;
    }
  } catch {
    // Outside Cloudflare context (e.g. Jest or standalone Node script)
  }

  return null;
}

let nodeSqliteInstance: any = null;

function getNodeSqlite() {
  if (getTestDb()) return getTestDb();
  if (!nodeSqliteInstance) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require("better-sqlite3");
      // Use local wrangler D1 state if available, otherwise in-memory
      nodeSqliteInstance = new Database(":memory:");
      nodeSqliteInstance.pragma("journal_mode = WAL");
      nodeSqliteInstance.pragma("foreign_keys = ON");
      nodeSqliteInstance.exec(SCHEMA_SQL);
    } catch (err) {
      console.warn("Notice: better-sqlite3 not available or failed to initialize:", err);
    }
  }
  return nodeSqliteInstance;
}

export async function ensureSchema(): Promise<void> {
  if (initialized) return;

  const d1 = await getD1Database();
  if (d1) {
    try {
      if (typeof (d1 as any).exec === "function") {
        await (d1 as any).exec(SCHEMA_SQL);
      }
    } catch {
      // If batch exec encounters an existing entity or syntax variation, proceed to individual statements
    }

    try {
      const statements = SCHEMA_SQL
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        try {
          await d1.prepare(statement).run();
        } catch {
          // If a table or index already exists, continue gracefully
        }
      }
    } catch (err) {
      console.warn("Notice: ensureSchema on D1 encountered error:", err);
    }

    try {
      await d1.prepare("SELECT 1 FROM audit_sessions LIMIT 1").run();
      await d1.prepare("SELECT 1 FROM reservations LIMIT 1").run();
      initialized = true;
    } catch {
      // Don't mark initialized if tables are still being provisioned
    }
    return;
  }

  const localDb = getNodeSqlite();
  if (localDb) {
    try {
      localDb.exec(SCHEMA_SQL);
    } catch {
      // Tables already exist
    }
  }
  initialized = true;
}

export async function sql<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  // Build parameterized SQL string with '?' placeholders
  let query = "";
  for (let i = 0; i < strings.length; i++) {
    query += strings[i];
    if (i < values.length) {
      query += "?";
    }
  }

  const sanitizedValues = values.map((v) => {
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v === undefined) return null;
    return v;
  });

  const d1 = await getD1Database();
  if (d1) {
    const isSelectOrReturning =
      /^\s*(SELECT|WITH|PRAGMA)/i.test(query) || /RETURNING/i.test(query);

    const stmt =
      sanitizedValues.length > 0
        ? d1.prepare(query).bind(...sanitizedValues)
        : d1.prepare(query);

    if (isSelectOrReturning) {
      const { results } = await stmt.all<T>();
      const rows = results ?? [];
      return { rows, rowCount: rows.length };
    } else {
      const result = await stmt.run();
      return { rows: [], rowCount: result.meta?.changes ?? 0 };
    }
  }

  // Node.js fallback (Jest tests, scripts)
  const localDb = getNodeSqlite();
  if (localDb) {
    const trimmed = query.trim();
    const isSelectOrReturning =
      /^\s*(SELECT|WITH|PRAGMA)/i.test(trimmed) || /RETURNING/i.test(trimmed);

    const stmt = localDb.prepare(query);
    if (isSelectOrReturning) {
      const rows = stmt.all(...sanitizedValues) as T[];
      return { rows, rowCount: rows.length };
    } else {
      const info = stmt.run(...sanitizedValues);
      return { rows: [], rowCount: info.changes };
    }
  }

  throw new Error("No database driver available (neither Cloudflare D1 nor SQLite).");
}
