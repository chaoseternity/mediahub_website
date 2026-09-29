/**
 * Cloudflare D1 database adapter for MediaHub.
 * Provides a unified tagged template literal `sql` interface that runs on:
 *   1. Cloudflare Workers (production & preview) via `@opennextjs/cloudflare` D1 binding (`env.DB`).
 *   2. Local development & Jest test suites via `better-sqlite3`.
 *
 * Schema management:
 *   - D1 (production/preview): the schema is owned by `migrations/*.sql`
 *     (`npm run db:migration:remote`). `ensureSchema()` only runs one cheap probe per isolate
 *     and logs any missing tables/indexes; it never issues DDL.
 *   - better-sqlite3 (tests, local scripts): the full `SCHEMA_SQL` bootstrap is applied once
 *     per database instance.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { SCHEMA_SQL, setTestDb, getTestDb } from "./test-db";
export { setTestDb, getTestDb };

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
      nodeSqliteInstance = new Database(":memory:");
      nodeSqliteInstance.pragma("journal_mode = WAL");
      nodeSqliteInstance.pragma("foreign_keys = ON");
      nodeSqliteInstance.exec(SCHEMA_SQL);
      bootstrappedNodeDbs.add(nodeSqliteInstance);
    } catch (err) {
      console.warn("Notice: better-sqlite3 not available or failed to initialize:", err);
    }
  }
  return nodeSqliteInstance;
}

// ---------------------------------------------------------------------------
// Schema check / bootstrap
// ---------------------------------------------------------------------------

/**
 * Objects that the migrations in `migrations/` create. If any is missing on D1, the
 * migrations have not been applied to that database.
 */
export const REQUIRED_TABLES = [
  "users",
  "nfc_cards",
  "tags",
  "equipment",
  "equipment_tags",
  "checkouts",
  "events",
  "event_oics",
  "event_ics",
  "event_equipment",
  "event_deployments",
  "event_section_rehearsals",
  "sop_documents",
  "checkout_reminders",
  "reservations",
  "handover_codes",
  "audit_sessions",
  "audit_records",
  "storage_map_layout",
] as const;

/** Indexes the code relies on for correctness (not just speed), with the migration that adds them. */
export const REQUIRED_INDEXES: Record<string, string> = {
  idx_checkouts_one_open: "0005_integrity_fixes.sql",
  idx_reminders_unique_window: "0006_data_layer_fixes.sql",
  idx_tags_name_lower: "0006_data_layer_fixes.sql",
};

/** WeakSet of better-sqlite3 instances that already had SCHEMA_SQL applied. */
const bootstrappedNodeDbs = new WeakSet<object>();
let d1ProbePromise: Promise<void> | null = null;

async function probeD1Schema(d1: D1Database): Promise<void> {
  try {
    const { results } = await d1
      .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')")
      .all<{ type: string; name: string }>();
    const present = new Set((results ?? []).map((r) => r.name));
    const missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));
    const missingIndexes = Object.keys(REQUIRED_INDEXES).filter((i) => !present.has(i));
    if (missingTables.length > 0 || missingIndexes.length > 0) {
      const migrations = new Set(missingIndexes.map((i) => REQUIRED_INDEXES[i]));
      console.error(
        "[DB] D1 schema is out of date. " +
          (missingTables.length > 0 ? `Missing tables: ${missingTables.join(", ")}. ` : "") +
          (missingIndexes.length > 0 ? `Missing indexes: ${missingIndexes.join(", ")}. ` : "") +
          (migrations.size > 0 ? `Pending migration(s): ${[...migrations].join(", ")}. ` : "") +
          "Apply migrations with `npm run db:migration:remote` (or `wrangler d1 migrations apply <db> --remote`)."
      );
    }
  } catch (err) {
    console.error("[DB] Could not verify the D1 schema (sqlite_master probe failed):", err);
  }
}

/**
 * Local (better-sqlite3) databases created from an older SCHEMA_SQL: add columns that newer
 * SCHEMA_SQL indexes depend on, so the bootstrap below doesn't fail half-way.
 */
function upgradeLocalSchema(db: any): void {
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'checkout_reminders'")
    .get();
  if (!hasTable) return;
  const cols = db.prepare("PRAGMA table_info(checkout_reminders)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "window_key")) {
    db.exec("ALTER TABLE checkout_reminders ADD COLUMN window_key TEXT");
  }
}

/**
 * On D1: one memoised `sqlite_master` probe per isolate that logs missing migrations. It never
 * creates tables (migrations own the production schema) and never re-runs per request.
 *
 * On better-sqlite3 (tests/scripts): applies SCHEMA_SQL once per database instance.
 */
export async function ensureSchema(): Promise<void> {
  const d1 = await getD1Database();
  if (d1) {
    if (!d1ProbePromise) d1ProbePromise = probeD1Schema(d1);
    return d1ProbePromise;
  }

  const localDb = getNodeSqlite();
  if (localDb && !bootstrappedNodeDbs.has(localDb)) {
    try {
      upgradeLocalSchema(localDb);
      localDb.exec(SCHEMA_SQL);
    } catch (err) {
      console.warn("Notice: SCHEMA_SQL bootstrap on local SQLite failed:", err);
    }
    bootstrappedNodeDbs.add(localDb);
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export interface QueryResult<T> {
  rows: T[];
  /** Rows returned for SELECT/RETURNING statements; rows changed for other writes. */
  rowCount: number;
}

/** A parameterised statement built by `stmt` (or `rawStmt`) for use with `batch`. */
export interface BoundStatement {
  readonly query: string;
  readonly values: unknown[];
}

function buildQuery(strings: TemplateStringsArray, values: unknown[]): BoundStatement {
  let query = "";
  for (let i = 0; i < strings.length; i++) {
    query += strings[i];
    if (i < values.length) query += "?";
  }
  return { query, values };
}

function sanitizeValues(values: unknown[]): unknown[] {
  return values.map((v) => {
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v === undefined) return null;
    return v;
  });
}

function returnsRows(query: string): boolean {
  return /^\s*(SELECT|WITH|PRAGMA)/i.test(query) || /RETURNING/i.test(query);
}

/** Builds a statement with `?` placeholders (same rules as `sql`) without executing it. */
export function stmt(strings: TemplateStringsArray, ...values: unknown[]): BoundStatement {
  return buildQuery(strings, values);
}

/** Builds a statement from an already-parameterised query string (`?` placeholders). */
export function rawStmt(query: string, values: unknown[] = []): BoundStatement {
  return { query, values };
}

/** Executes a query string with `?` placeholders. Prefer the `sql` tagged template. */
export async function query<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  const sanitizedValues = sanitizeValues(values);
  const wantsRows = returnsRows(text);

  const d1 = await getD1Database();
  if (d1) {
    const prepared =
      sanitizedValues.length > 0 ? d1.prepare(text).bind(...sanitizedValues) : d1.prepare(text);
    if (wantsRows) {
      const { results } = await prepared.all<T>();
      const rows = results ?? [];
      return { rows, rowCount: rows.length };
    }
    const result = await prepared.run();
    return { rows: [], rowCount: result.meta?.changes ?? 0 };
  }

  // Node.js fallback (Jest tests, scripts)
  const localDb = getNodeSqlite();
  if (localDb) {
    const prepared = localDb.prepare(text);
    if (wantsRows) {
      const rows = prepared.all(...sanitizedValues) as T[];
      return { rows, rowCount: rows.length };
    }
    const info = prepared.run(...sanitizedValues);
    return { rows: [], rowCount: info.changes };
  }

  throw new Error("No database driver available (neither Cloudflare D1 nor SQLite).");
}

export async function sql<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<QueryResult<T>> {
  const built = buildQuery(strings, values);
  return query<T>(built.query, built.values);
}

/**
 * Executes several statements atomically: either all of them commit or none do.
 *
 *   await batch([
 *     stmt`DELETE FROM equipment_tags WHERE equipment_id = ${id}`,
 *     stmt`INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (${id}, ${tagId})`,
 *   ]);
 *
 * - D1: `d1.batch([...])` (runs as one SQL transaction; any failure rolls back the batch).
 * - better-sqlite3: runs inside `db.transaction(...)`.
 *
 * Returns one result per statement, in order (same shape as `sql`). Statements cannot see each
 * other's JS results, so later statements must reference earlier ones in SQL (e.g. subqueries).
 * Rejects with the failing statement's error.
 */
export async function batch<T = Record<string, unknown>>(
  statements: BoundStatement[]
): Promise<QueryResult<T>[]> {
  if (statements.length === 0) return [];

  const d1 = await getD1Database();
  if (d1) {
    const prepared = statements.map((s) => {
      const vals = sanitizeValues(s.values);
      return vals.length > 0 ? d1.prepare(s.query).bind(...vals) : d1.prepare(s.query);
    });
    const results = await d1.batch<T>(prepared);
    return results.map((r, i) => {
      if (returnsRows(statements[i].query)) {
        const rows = (r.results ?? []) as T[];
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: r.meta?.changes ?? 0 };
    });
  }

  const localDb = getNodeSqlite();
  if (localDb) {
    const run = localDb.transaction((list: BoundStatement[]) =>
      list.map((s) => {
        const prepared = localDb.prepare(s.query);
        const vals = sanitizeValues(s.values);
        if (returnsRows(s.query)) {
          const rows = prepared.all(...vals) as T[];
          return { rows, rowCount: rows.length };
        }
        const info = prepared.run(...vals);
        return { rows: [] as T[], rowCount: info.changes as number };
      })
    );
    return run(statements);
  }

  throw new Error("No database driver available (neither Cloudflare D1 nor SQLite).");
}
