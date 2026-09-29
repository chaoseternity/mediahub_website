import type { NextResponse } from "next/server";
import { errorResponse, toErrorResponse } from "@/lib/api-errors";

/**
 * Maps errors thrown by `updateUsername` to responses.
 *
 * The data layer throws a clear, user-facing message when the name collides with another
 * user's username or display name (→ 409) or is invalid (→ 400). A raw UNIQUE-constraint
 * violation from the database (race between the check and the write) is also a collision.
 */
export function usernameErrorResponse(err: unknown, fallbackMessage: string): NextResponse {
  if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
    return errorResponse(409, "That name is already taken by another member. Please choose a different one.");
  }
  if (err instanceof Error && /taken|already (in use|exists|used)|collid|conflict/i.test(err.message)) {
    return toErrorResponse(Object.assign(new Error(err.message), { status: 409 }), fallbackMessage);
  }
  return toErrorResponse(err, fallbackMessage);
}
