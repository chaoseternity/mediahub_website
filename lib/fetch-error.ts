/**
 * Client-side helpers for turning failed API responses into user-facing messages.
 *
 * API errors are `{ error: string }`, but older routes may still return a zod `flatten()`
 * object or a non-JSON body (e.g. an HTML 502 page), so this is defensive.
 */

export function errorMessageFrom(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const err = (body as { error?: unknown; message?: unknown }).error ?? (body as { message?: unknown }).message;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object") {
    // zod flatten(): { formErrors: string[], fieldErrors: Record<string, string[]> }
    const { formErrors, fieldErrors } = err as {
      formErrors?: unknown;
      fieldErrors?: Record<string, unknown>;
    };
    const parts: string[] = [];
    if (Array.isArray(formErrors)) parts.push(...formErrors.filter((m): m is string => typeof m === "string"));
    if (fieldErrors && typeof fieldErrors === "object") {
      for (const [field, msgs] of Object.entries(fieldErrors)) {
        if (Array.isArray(msgs) && msgs.length) parts.push(`${field}: ${msgs.join(", ")}`);
      }
    }
    if (parts.length) return parts.join("; ");
  }
  return fallback;
}

/** Read a failed Response's body and extract its error message. Never throws. */
export async function readErrorMessage(res: Response, fallback?: string): Promise<string> {
  const fb = fallback ?? `Request failed (${res.status})`;
  try {
    const body: unknown = await res.json();
    return errorMessageFrom(body, fb);
  } catch {
    return fb;
  }
}

/** Message for a thrown fetch/network error. */
export function networkErrorMessage(err: unknown, fallback = "Network error — please try again."): string {
  if (err instanceof Error && err.message && err.name !== "TypeError") return err.message;
  return fallback;
}
