import { NextResponse } from "next/server";
import { InvalidOccurredAtError } from "@/lib/db";
import { isInternalErrorMessage } from "@/lib/api-errors";

/**
 * Maps an error thrown by an NFC db helper to an HTTP response.
 *
 * The offline queue treats 4xx as a permanent rejection (shown to the operator and
 * dropped) and 5xx as transient (kept and retried), so only genuine business-rule
 * failures may become 4xx. Anything unexpected (D1 outage, SQL error, bug) is a 500.
 */
export function nfcErrorResponse(err: unknown, fallback: string): NextResponse {
  const message = err instanceof Error && err.message ? err.message : fallback;

  if (err instanceof InvalidOccurredAtError) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  // Driver/runtime errors (D1/SQLite messages, TypeErrors, ...) are never business rejections,
  // even if their text happens to contain "not found" or "already exists".
  if (
    !(err instanceof Error) ||
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof SyntaxError ||
    isInternalErrorMessage(message)
  ) {
    console.error(`[nfc] ${fallback}:`, err);
    return NextResponse.json(
      { error: `${fallback}: unexpected server error. Please try again.` },
      { status: 500 }
    );
  }
  if (/^Invalid (equipment|NFC card) ID/i.test(message)) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (/not found/i.test(message)) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (
    /not available|already checked out|no active checkout|now belongs to|already exists/i.test(
      message
    )
  ) {
    return NextResponse.json({ error: message }, { status: 409 });
  }

  console.error(`[nfc] ${fallback}:`, err);
  return NextResponse.json(
    { error: `${fallback}: unexpected server error. Please try again.` },
    { status: 500 }
  );
}
