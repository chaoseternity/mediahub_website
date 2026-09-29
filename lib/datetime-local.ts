/**
 * Helpers for <input type="datetime-local">.
 *
 * datetime-local inputs work in the browser's LOCAL time zone and use the
 * "YYYY-MM-DDTHH:mm" format. Stored timestamps are ISO strings (UTC), so they
 * must be converted to local wall-clock time for display, and back to ISO on
 * save. Using `toISOString().slice(0, 16)` to fill the input is wrong: it
 * shows UTC wall-clock time, and every save then shifts the value by the UTC
 * offset.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Convert a stored timestamp (ISO string or Date) into a local "YYYY-MM-DDTHH:mm" value. */
export function toLocalInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Convert a local "YYYY-MM-DDTHH:mm" input value into an ISO (UTC) string. */
export function fromLocalInputValue(localValue: string): string {
  // new Date("YYYY-MM-DDTHH:mm") (no zone designator) is parsed as local time.
  return new Date(localValue).toISOString();
}
