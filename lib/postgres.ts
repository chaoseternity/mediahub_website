/**
 * Compatibility re-export for PostgreSQL database adapter.
 * MediaHub now uses a unified driver in `lib/d1.ts` that dynamically targets
 * Vercel Postgres / Neon when POSTGRES_URL is configured, Cloudflare D1 when
 * running on Cloudflare Workers, and SQLite in tests.
 */
export * from "./d1";
