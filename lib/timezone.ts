/**
 * Shared date parsing/formatting in the club's time zone.
 *
 * SQLite's CURRENT_TIMESTAMP / datetime('now') produce "YYYY-MM-DD HH:MM:SS" in UTC with no
 * zone designator, which `new Date()` would otherwise read as local time. Formatting with a
 * fixed `timeZone` also keeps server-rendered output identical to the client's (no hydration
 * mismatch) and makes emails/webhooks sent from UTC Workers show local time.
 */

export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Singapore";
export const APP_LOCALE = "en-GB";

const SQLITE_UTC_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a DB/ISO timestamp. SQLite "YYYY-MM-DD HH:MM:SS" values are treated as UTC. */
export function parseDbDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = value.trim();
  const d = SQLITE_UTC_RE.test(s) ? new Date(s.replace(" ", "T") + "Z") : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True for a bare "YYYY-MM-DD" value (a calendar date with no time). */
export function isDateOnly(value: string | null | undefined): boolean {
  return !!value && DATE_ONLY_RE.test(value.trim());
}

/**
 * End of a calendar day in APP_TIMEZONE, for date-only due dates ("2026-10-01" is due until
 * 23:59:59.999 that day local time, not midnight UTC).
 */
export function endOfAppDay(dateOnly: string): Date {
  const [y, m, d] = dateOnly.trim().split("-").map(Number);
  // Guess at UTC end of day, then correct by the zone's offset at that instant.
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  return new Date(guess - zoneOffsetMs(new Date(guess)));
}

function zoneOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Due/expected-return instant: date-only values mean end of that day in APP_TIMEZONE. */
export function parseDueDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return isDateOnly(value) ? endOfAppDay(value) : parseDbDate(value);
}

type Formattable = string | number | Date | null | undefined;

function format(value: Formattable, options: Intl.DateTimeFormatOptions, fallback: string): string {
  const d = typeof value === "string" && isDateOnly(value) ? endOfAppDay(value) : parseDbDate(value);
  if (!d) return typeof value === "string" && value ? value : fallback;
  return d.toLocaleString(APP_LOCALE, { timeZone: APP_TIMEZONE, ...options });
}

/** e.g. "29 Sept 2026, 14:05" */
export function formatDateTime(value: Formattable, fallback = "—"): string {
  return format(value, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }, fallback);
}

/** e.g. "29 Sept 2026" */
export function formatDate(value: Formattable, fallback = "—"): string {
  return format(value, { day: "numeric", month: "short", year: "numeric" }, fallback);
}

/** e.g. "14:05" */
export function formatTime(value: Formattable, fallback = "—"): string {
  return format(value, { hour: "2-digit", minute: "2-digit", hour12: false }, fallback);
}

/** e.g. "Tue, 29 Sept 2026, 14:05" — for emails and notifications. */
export function formatLongDateTime(value: Formattable, fallback = "—"): string {
  return format(
    value,
    { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false },
    fallback
  );
}
