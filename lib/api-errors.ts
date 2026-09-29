/**
 * Shared error handling for API route handlers.
 *
 * Goals:
 * - Never leak internal error text (D1/SQLite messages such as "UNIQUE constraint failed",
 *   "D1_TYPE_ERROR", TypeErrors, stack details) to clients — including the public /api/rsvp.
 * - Map the data layer's deliberate business errors (thrown `Error`s or `{ success: false, error }`
 *   results with human-readable messages) to the right 4xx status.
 * - Keep the `{ error: string }` response shape the frontend reads.
 *
 * Edge-safe: no Node-only imports.
 */
import { NextResponse } from "next/server";
import type { ZodError } from "zod";

/** An error whose message is safe to show to the client, with an explicit HTTP status. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function errorResponse(status: number, message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ...(extra ?? {}), error: message }, { status });
}

/**
 * Markers of internal/driver errors whose text must never reach the client, even when they
 * happen to contain words like "not found" or "already exists".
 */
const INTERNAL_ERROR_MARKERS =
  /D1_|SQLITE|constraint failed|no such (table|column|function)|syntax error|near "|datatype mismatch|database is locked|cannot read propert|is not a function|is not defined|of undefined|of null|unexpected token|in JSON|JSON\.parse|ECONN|ETIMEDOUT|fetch failed/i;

export function isInternalErrorMessage(message: string): boolean {
  return INTERNAL_ERROR_MARKERS.test(message);
}

/** Ordered: the first matching pattern decides the status. */
const KNOWN_ERROR_PATTERNS: Array<[RegExp, number]> = [
  [/^Forbidden\b/i, 403],
  [/not found|does not exist|invalid handover code|invalid or expired invitation/i, 404],
  [/has ended|has expired|is expired|no longer valid/i, 410],
  [
    /already (reserved|checked out|exists|taken|in use|been|claimed|returned|fulfilled|cancelled|completed|retired|registered)|is already|not available for checkout|is not available \(|not currently available|no active checkout|now belongs to|no longer (confirmed|in progress)|overlapping|conflict|in use|is (claimed|revoked|used|cancelled|completed)|please try again/i,
    409,
  ],
  [
    /^(invalid|cannot|can't|unable to|missing|must|please)\b|\b(not|only) available for\b|\b(is required|are required|must be|must not|cannot exceed|exceeds|too (long|many|large|far)|at most|at least|in the past|max(imum)? )/i,
    400,
  ],
];

/** Default status for the data layer's typed business errors (see lib/db.ts). */
const KNOWN_ERROR_NAMES: Record<string, number> = {
  /** updateUsername: invalid name (400) or "already taken" collision (409 via message). */
  UsernameTakenError: 400,
  /** updateUserRole: the target is an ADMIN_EMAILS administrator and can't be demoted here. */
  ConfiguredAdminError: 403,
  /** createReservation: invalid times/notes, unavailable or unknown equipment. */
  ReservationValidationError: 400,
  /** saveStorageMapConfig: malformed cabinets configuration. */
  StorageMapConfigError: 400,
  /** createTag / tag normalisation. */
  InvalidTagNameError: 400,
  /** NFC offline replays with a bad/too-old timestamp. */
  InvalidOccurredAtError: 400,
};

/**
 * Classify an error message produced by the data layer.
 * Returns the status for a known business error, or null for anything unknown/internal.
 */
export function classifyErrorMessage(message: string | null | undefined): number | null {
  if (!message || typeof message !== "string") return null;
  const msg = message.trim();
  if (!msg || msg.length > 500) return null;
  if (INTERNAL_ERROR_MARKERS.test(msg)) return null;
  for (const [pattern, status] of KNOWN_ERROR_PATTERNS) {
    if (pattern.test(msg)) return status;
  }
  return null;
}

/**
 * Classify a thrown value. Only plain `Error`s (and `HttpError`s / errors carrying an explicit
 * 4xx `status`) are candidates — TypeError, RangeError, SyntaxError etc. are always internal.
 */
export function classifyError(err: unknown): { status: number; message: string } | null {
  if (err instanceof HttpError) {
    return { status: err.status, message: err.message };
  }
  if (!(err instanceof Error)) return null;
  if (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof SyntaxError ||
    err instanceof ReferenceError ||
    err instanceof EvalError ||
    err instanceof URIError
  ) {
    return null;
  }

  const explicit = (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof explicit === "number" && explicit >= 400 && explicit < 500 && err.message && !INTERNAL_ERROR_MARKERS.test(err.message)) {
    return { status: explicit, message: err.message };
  }

  // Typed business errors thrown by lib/db (matched by name so this module needn't import the
  // data layer). The message decides when it matches a known pattern (e.g. "already taken" →
  // 409, "not found" → 404); otherwise the class's default status applies.
  const defaultForName = KNOWN_ERROR_NAMES[err.name];
  if (defaultForName !== undefined && err.message && !INTERNAL_ERROR_MARKERS.test(err.message)) {
    return { status: classifyErrorMessage(err.message) ?? defaultForName, message: err.message };
  }

  const status = classifyErrorMessage(err.message);
  return status === null ? null : { status, message: err.message };
}

/**
 * Convert a caught error into a response. Known business errors keep their message and get a
 * 4xx status; anything else is logged server-side and answered with a generic 500.
 *
 * @param fallbackMessage Generic, user-safe message for unexpected errors (e.g. "Failed to create reservation").
 */
export function toErrorResponse(
  err: unknown,
  fallbackMessage: string,
  options?: { logLabel?: string; unknownStatus?: number }
): NextResponse {
  const known = classifyError(err);
  if (known) return errorResponse(known.status, known.message);
  console.error(`[api] ${options?.logLabel ?? fallbackMessage}:`, err);
  return errorResponse(options?.unknownStatus ?? 500, fallbackMessage);
}

/**
 * Convert a `{ success: false, error }` result from the data layer into a response.
 * Known messages get their mapped status (or `defaultStatus` when they look like an ordinary
 * business rejection); unrecognised/internal-looking messages become a generic 500.
 */
export function resultErrorResponse(
  error: string | null | undefined,
  fallbackMessage: string,
  defaultStatus = 400
): NextResponse {
  if (!error || typeof error !== "string") return errorResponse(defaultStatus, fallbackMessage);
  const status = classifyErrorMessage(error);
  if (status !== null) return errorResponse(status, error);
  if (INTERNAL_ERROR_MARKERS.test(error) || error.length > 500) {
    console.error(`[api] ${fallbackMessage}:`, error);
    return errorResponse(500, fallbackMessage);
  }
  // A deliberate, human-readable business message we don't have a pattern for.
  return errorResponse(defaultStatus, error);
}

/** One-line summary of a zod error for the `{ error: string }` response shape. */
export function zodErrorMessage(error: ZodError, max = 3): string {
  const parts = error.issues.slice(0, max).map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  const more = error.issues.length > max ? ` (+${error.issues.length - max} more)` : "";
  return (parts.join("; ") || "Invalid request body") + more;
}

export function validationErrorResponse(error: ZodError): NextResponse {
  return errorResponse(400, zodErrorMessage(error));
}

/**
 * Parse a JSON request body. Malformed JSON → 400 response.
 * With `allowEmpty`, an empty body yields `{}` (for endpoints whose body is optional).
 */
export async function readJsonBody(
  req: Request,
  options?: { allowEmpty?: boolean }
): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: errorResponse(400, "Invalid request body") };
  }
  if (!text.trim()) {
    if (options?.allowEmpty) return { ok: true, data: {} };
    return { ok: false, response: errorResponse(400, "Request body is required") };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, response: errorResponse(400, "Invalid JSON body") };
  }
}

/**
 * The request's declared Content-Length, or null when absent/invalid. Lets upload routes reject
 * oversized bodies BEFORE buffering them with `req.formData()`.
 */
export function declaredContentLength(req: Request): number | null {
  const headers = (req as { headers?: Headers }).headers;
  const raw = headers && typeof headers.get === "function" ? headers.get("content-length") : null;
  if (!raw || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/** Minimal shape of an uploaded file from `FormData.get()` (a `File`/`Blob`, not a string). */
export interface UploadedFileLike {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * True when a FormData value is an uploaded file. Duck-typed rather than `instanceof File`
 * because `File` differs (or is missing) across Node, Workers and test runtimes.
 */
export function isUploadedFile(value: unknown): value is UploadedFileLike {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<UploadedFileLike>;
  return typeof v.size === "number" && typeof v.arrayBuffer === "function" &&
    (v.name === undefined || typeof v.name === "string") &&
    (v.type === undefined || typeof v.type === "string");
}
