/**
 * Unified database adapter for MediaHub.
 * Provides a unified tagged template literal `sql` interface and `query` / `batch` that runs on:
 *   1. Cloudflare Workers (production & preview) via `@opennextjs/cloudflare` D1 binding (`env.DB`).
 *   2. Vercel / Neon via `@vercel/postgres` (`process.env.POSTGRES_URL` or `DATABASE_URL`).
 *   3. Local development & Jest test suites via `better-sqlite3`.
 *
 * Schema management:
 *   - D1 (production/preview): the schema is owned by `migrations/*.sql`
 *     (`npm run db:migration:remote`). `ensureSchema()` only runs one cheap probe per isolate
 *     and logs any missing tables/indexes; it never issues DDL.
 *   - Postgres (Vercel/Neon): `ensureSchema()` bootstraps tables, indexes, and compatibility
 *     functions (`group_concat`, `julianday`, `datetime`) once per isolate.
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
    // Outside Cloudflare context
  }

  return null;
}

let postgresModuleInstance: any = null;

export async function getPostgres() {
  if (getTestDb()) return null;
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) return null;
  if (!postgresModuleInstance) {
    try {
      const pg = await import("@vercel/postgres");
      postgresModuleInstance = pg;
    } catch {
      postgresModuleInstance = null;
    }
  }
  return postgresModuleInstance;
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

export const REQUIRED_INDEXES: Record<string, string> = {
  idx_checkouts_one_open: "0005_integrity_fixes.sql",
  idx_reminders_unique_window: "0006_data_layer_fixes.sql",
  idx_tags_name_lower: "0006_data_layer_fixes.sql",
};

const bootstrappedNodeDbs = new WeakSet<object>();
let d1ProbePromise: Promise<void> | null = null;
let pgProbePromise: Promise<void> | null = null;

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

async function ensurePostgresSchema(pg: any): Promise<void> {
  async function runSafe(queryFn: () => Promise<unknown>, desc: string) {
    try {
      await queryFn();
    } catch (err) {
      console.warn(`[Postgres] Schema step warning for ${desc}:`, err);
    }
  }

  const { sql } = pg;

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        google_id TEXT NOT NULL,
        image TEXT,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'editor', 'viewer')),
        provider TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    "CREATE TABLE users"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS nfc_cards (
        id SERIAL PRIMARY KEY,
        nfc_value TEXT NOT NULL UNIQUE,
        member_name TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    "CREATE TABLE nfc_cards"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    "CREATE TABLE tags"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS equipment (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        serial_number TEXT,
        condition TEXT NOT NULL DEFAULT 'Working' CHECK(condition IN ('Working','Impaired','Broken','Missing','Retired')),
        quantity INT NOT NULL DEFAULT 1,
        location TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available','Checked Out','In Event','In Event (Rehearsal)','Unavailable (In Repairs)','Unavailable (Broken)','Unavailable (Missing)','Unavailable (Retired)')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    "CREATE TABLE equipment"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS equipment_tags (
        equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        tag_id INT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (equipment_id, tag_id)
      );
    `,
    "CREATE TABLE equipment_tags"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS checkouts (
        id SERIAL PRIMARY KEY,
        equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        checked_out_by INT REFERENCES users(id) ON DELETE SET NULL,
        checked_out_by_name TEXT NOT NULL,
        checked_out_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        expected_return_at TIMESTAMP WITH TIME ZONE,
        returned_at TIMESTAMP WITH TIME ZONE,
        notes TEXT,
        nfc_value TEXT,
        nfc_id TEXT,
        checkout_location TEXT
      );
    `,
    "CREATE TABLE checkouts"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        start_time TIMESTAMP WITH TIME ZONE NOT NULL,
        end_time TIMESTAMP WITH TIME ZONE NOT NULL,
        location TEXT NOT NULL,
        created_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        has_rehearsal BOOLEAN DEFAULT FALSE,
        rehearsal_start_time TIMESTAMP WITH TIME ZONE,
        rehearsal_end_time TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    "CREATE TABLE events"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS event_oics (
        event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (event_id, user_id)
      );
    `,
    "CREATE TABLE event_oics"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS event_ics (
        event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        section TEXT NOT NULL CHECK(section IN ('pa', 'lights', 'sound', 'av')),
        PRIMARY KEY (event_id, user_id, section)
      );
    `,
    "CREATE TABLE event_ics"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS event_equipment (
        id SERIAL PRIMARY KEY,
        event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        section TEXT NOT NULL CHECK(section IN ('pa', 'lights', 'sound', 'av')),
        added_by INT REFERENCES users(id) ON DELETE SET NULL,
        added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        used_for_rehearsal BOOLEAN DEFAULT FALSE
      );
    `,
    "CREATE TABLE event_equipment"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS event_deployments (
        id SERIAL PRIMARY KEY,
        event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        section TEXT NOT NULL CHECK(section IN ('pa', 'lights', 'sound', 'av')),
        added_by INT REFERENCES users(id) ON DELETE SET NULL,
        added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        attending_rehearsal BOOLEAN DEFAULT FALSE,
        response_status TEXT NOT NULL DEFAULT 'no_reply' CHECK(response_status IN ('attending', 'not_attending', 'no_reply')),
        responded_at TIMESTAMP WITH TIME ZONE
      );
    `,
    "CREATE TABLE event_deployments"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS event_section_rehearsals (
        event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        section TEXT NOT NULL CHECK(section IN ('pa', 'lights', 'sound', 'av')),
        participating BOOLEAN DEFAULT FALSE,
        rehearsal_conducted BOOLEAN DEFAULT FALSE,
        notes TEXT,
        PRIMARY KEY (event_id, section)
      );
    `,
    "CREATE TABLE event_section_rehearsals"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS sop_documents (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('pa', 'lights', 'sound', 'av', 'general')),
        file_name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_size INT NOT NULL,
        content_text TEXT NOT NULL,
        uploaded_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    "CREATE TABLE sop_documents"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS checkout_reminders (
        id SERIAL PRIMARY KEY,
        checkout_id INT NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
        reminder_type TEXT NOT NULL CHECK(reminder_type IN ('due_soon', 'overdue')),
        sent_to_email TEXT NOT NULL,
        sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        window_key TEXT
      );
    `,
    "CREATE TABLE checkout_reminders"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        reserved_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reserved_by_name TEXT NOT NULL,
        start_time TIMESTAMP WITH TIME ZONE NOT NULL,
        end_time TIMESTAMP WITH TIME ZONE NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled', 'fulfilled')),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    "CREATE TABLE reservations"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS handover_codes (
        id SERIAL PRIMARY KEY,
        checkout_id INT NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
        equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        from_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code TEXT NOT NULL UNIQUE,
        qr_payload TEXT NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'claimed', 'expired', 'revoked')),
        claimed_by INT REFERENCES users(id) ON DELETE SET NULL,
        claimed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    "CREATE TABLE handover_codes"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS audit_sessions (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        started_by INT REFERENCES users(id) ON DELETE SET NULL,
        started_by_name TEXT,
        status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'cancelled')),
        started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP WITH TIME ZONE,
        total_items INT DEFAULT 0,
        found_count INT DEFAULT 0,
        missing_count INT DEFAULT 0,
        notes TEXT
      );
    `,
    "CREATE TABLE audit_sessions"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS audit_records (
        id SERIAL PRIMARY KEY,
        session_id INT NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
        equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'missing' CHECK(status IN ('exists', 'missing')),
        scanned_at TIMESTAMP WITH TIME ZONE,
        scanned_by INT REFERENCES users(id) ON DELETE SET NULL,
        method TEXT CHECK(method IN ('nfc', 'qr', 'manual')),
        UNIQUE(session_id, equipment_id)
      );
    `,
    "CREATE TABLE audit_records"
  );

  await runSafe(
    () => sql`
      CREATE TABLE IF NOT EXISTS storage_map_layout (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    "CREATE TABLE storage_map_layout"
  );

  // Column changes for existing tables. users.username is retired: display names come solely
  // from the OAuth name.
  await runSafe(() => sql`ALTER TABLE users DROP COLUMN IF EXISTS username;`, "DROP users username");
  await runSafe(() => sql`ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS nfc_value TEXT;`, "ALTER checkouts nfc_value");
  await runSafe(() => sql`ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS nfc_id TEXT;`, "ALTER checkouts nfc_id");
  await runSafe(() => sql`ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS checkout_location TEXT;`, "ALTER checkouts checkout_location");
  await runSafe(() => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS has_rehearsal BOOLEAN DEFAULT FALSE;`, "ALTER events has_rehearsal");
  await runSafe(() => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS rehearsal_start_time TIMESTAMP WITH TIME ZONE;`, "ALTER events rehearsal_start_time");
  await runSafe(() => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS rehearsal_end_time TIMESTAMP WITH TIME ZONE;`, "ALTER events rehearsal_end_time");
  await runSafe(() => sql`ALTER TABLE checkout_reminders ADD COLUMN IF NOT EXISTS window_key TEXT;`, "ALTER checkout_reminders window_key");
  await runSafe(() => sql`ALTER TABLE audit_sessions ADD COLUMN IF NOT EXISTS started_by_name TEXT;`, "ALTER audit_sessions started_by_name");

  // Constraints and Indexes
  await runSafe(
    () => sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_checkouts_one_open ON checkouts(equipment_id) WHERE returned_at IS NULL;`,
    "INDEX idx_checkouts_one_open"
  );
  await runSafe(
    () => sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_unique_window ON checkout_reminders(checkout_id, reminder_type, window_key);`,
    "INDEX idx_reminders_unique_window"
  );
  await runSafe(
    () => sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_lower ON tags(LOWER(name));`,
    "INDEX idx_tags_name_lower"
  );
  await runSafe(
    () => sql`CREATE INDEX IF NOT EXISTS idx_event_equipment_equipment ON event_equipment(equipment_id);`,
    "INDEX idx_event_equipment_equipment"
  );
  await runSafe(
    () => sql`CREATE INDEX IF NOT EXISTS idx_audit_records_session ON audit_records(session_id, status);`,
    "INDEX idx_audit_records_session"
  );
  await runSafe(
    () => sql`CREATE INDEX IF NOT EXISTS idx_reservations_eq_time ON reservations(equipment_id, start_time, end_time);`,
    "INDEX idx_reservations_eq_time"
  );

  // PostgreSQL compatibility functions for SQLite queries
  await runSafe(
    () => sql`
      CREATE OR REPLACE FUNCTION _mediahub_group_concat_step(text, text) RETURNS text AS $$
        SELECT CASE
          WHEN $1 IS NULL OR $1 = '' THEN $2
          WHEN $2 IS NULL OR $2 = '' THEN $1
          ELSE $1 || ',' || $2
        END;
      $$ LANGUAGE SQL IMMUTABLE;
    `,
    "CREATE FUNCTION _mediahub_group_concat_step"
  );

  await runSafe(
    () => sql`
      CREATE OR REPLACE AGGREGATE group_concat(text) (
        SFUNC = _mediahub_group_concat_step,
        STYPE = text,
        INITCOND = ''
      );
    `,
    "CREATE AGGREGATE group_concat"
  );

  await runSafe(
    () => sql`
      CREATE OR REPLACE FUNCTION julianday(text) RETURNS double precision AS $$
        SELECT CASE
          WHEN $1 IS NULL THEN NULL
          WHEN $1 = 'now' THEN (EXTRACT(EPOCH FROM now()) / 86400.0) + 2440587.5
          ELSE (EXTRACT(EPOCH FROM $1::timestamptz) / 86400.0) + 2440587.5
        END;
      $$ LANGUAGE SQL IMMUTABLE;
    `,
    "CREATE FUNCTION julianday(text)"
  );

  await runSafe(
    () => sql`
      CREATE OR REPLACE FUNCTION julianday(timestamptz) RETURNS double precision AS $$
        SELECT CASE
          WHEN $1 IS NULL THEN NULL
          ELSE (EXTRACT(EPOCH FROM $1) / 86400.0) + 2440587.5
        END;
      $$ LANGUAGE SQL IMMUTABLE;
    `,
    "CREATE FUNCTION julianday(timestamptz)"
  );

  await runSafe(
    () => sql`
      CREATE OR REPLACE FUNCTION julianday(timestamp) RETURNS double precision AS $$
        SELECT CASE
          WHEN $1 IS NULL THEN NULL
          ELSE (EXTRACT(EPOCH FROM $1) / 86400.0) + 2440587.5
        END;
      $$ LANGUAGE SQL IMMUTABLE;
    `,
    "CREATE FUNCTION julianday(timestamp)"
  );

  await runSafe(
    () => sql`
      CREATE OR REPLACE FUNCTION datetime() RETURNS text AS $$
        SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS');
      $$ LANGUAGE SQL IMMUTABLE;
    `,
    "CREATE FUNCTION datetime()"
  );

  await runSafe(
    () => sql`
      CREATE OR REPLACE FUNCTION datetime(text) RETURNS text AS $$
        SELECT CASE
          WHEN $1 IS NULL THEN NULL
          WHEN $1 = 'now' THEN to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
          ELSE to_char($1::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
        END;
      $$ LANGUAGE SQL IMMUTABLE;
    `,
    "CREATE FUNCTION datetime(text)"
  );

  await runSafe(
    () => sql`
      CREATE OR REPLACE FUNCTION datetime(timestamptz) RETURNS text AS $$
        SELECT CASE
          WHEN $1 IS NULL THEN NULL
          ELSE to_char($1 AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
        END;
      $$ LANGUAGE SQL IMMUTABLE;
    `,
    "CREATE FUNCTION datetime(timestamptz)"
  );
}

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
 * Ensures database schema is ready:
 * - On D1: one memoised `sqlite_master` probe per isolate.
 * - On Postgres: runs table/function definitions once per isolate.
 * - On better-sqlite3 (tests/scripts): applies SCHEMA_SQL once per database instance.
 */
export async function ensureSchema(): Promise<void> {
  const d1 = await getD1Database();
  if (d1) {
    if (!d1ProbePromise) d1ProbePromise = probeD1Schema(d1);
    return d1ProbePromise;
  }

  const pg = await getPostgres();
  if (pg) {
    if (!pgProbePromise) pgProbePromise = ensurePostgresSchema(pg);
    return pgProbePromise;
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

export function toPostgresQuery(sqlText: string): string {
  let paramIdx = 1;
  let inString = false;
  let quoteChar = "";
  let result = "";

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    if (inString) {
      result += char;
      if (char === quoteChar) {
        if (i + 1 < sqlText.length && sqlText[i + 1] === quoteChar) {
          result += sqlText[++i];
        } else {
          inString = false;
        }
      }
    } else {
      if (char === "'" || char === '"') {
        inString = true;
        quoteChar = char;
        result += char;
      } else if (char === "?") {
        result += `$${paramIdx++}`;
      } else {
        result += char;
      }
    }
  }

  return result;
}

function sanitizeValues(values: unknown[], isPostgres = false): unknown[] {
  return values.map((v) => {
    if (typeof v === "boolean") {
      return isPostgres ? v : v ? 1 : 0;
    }
    if (v === undefined) return null;
    return v;
  });
}

function normalizeRow(row: any): any {
  if (!row || typeof row !== "object") return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
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
  const wantsRows = returnsRows(text);

  const d1 = await getD1Database();
  if (d1) {
    const sanitizedValues = sanitizeValues(values, false);
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

  const pg = await getPostgres();
  if (pg) {
    const pgText = toPostgresQuery(text);
    const sanitizedValues = sanitizeValues(values, true);
    const res = await pg.sql.query(pgText, sanitizedValues);
    const rows = (res.rows ?? []).map(normalizeRow) as T[];
    return { rows, rowCount: res.rowCount ?? rows.length };
  }

  // Node.js fallback (Jest tests, scripts)
  const localDb = getNodeSqlite();
  if (localDb) {
    const sanitizedValues = sanitizeValues(values, false);
    const prepared = localDb.prepare(text);
    if (wantsRows) {
      const rows = prepared.all(...sanitizedValues) as T[];
      return { rows, rowCount: rows.length };
    }
    const info = prepared.run(...sanitizedValues);
    return { rows: [], rowCount: info.changes };
  }

  throw new Error("No database driver available (neither Cloudflare D1, PostgreSQL, nor SQLite).");
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
 */
export async function batch<T = Record<string, unknown>>(
  statements: BoundStatement[]
): Promise<QueryResult<T>[]> {
  if (statements.length === 0) return [];

  const d1 = await getD1Database();
  if (d1) {
    const prepared = statements.map((s) => {
      const vals = sanitizeValues(s.values, false);
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

  const pg = await getPostgres();
  if (pg) {
    const client = await pg.db.connect();
    try {
      await client.query("BEGIN");
      const results: QueryResult<T>[] = [];
      for (const s of statements) {
        const pgText = toPostgresQuery(s.query);
        const vals = sanitizeValues(s.values, true);
        const res = await client.query(pgText, vals);
        const rows = (res.rows ?? []).map(normalizeRow) as T[];
        results.push({ rows, rowCount: res.rowCount ?? rows.length });
      }
      await client.query("COMMIT");
      return results;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  const localDb = getNodeSqlite();
  if (localDb) {
    const run = localDb.transaction((list: BoundStatement[]) =>
      list.map((s) => {
        const prepared = localDb.prepare(s.query);
        const vals = sanitizeValues(s.values, false);
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

  throw new Error("No database driver available (neither Cloudflare D1, PostgreSQL, nor SQLite).");
}
