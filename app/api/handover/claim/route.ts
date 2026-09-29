import { auth } from "@/lib/auth";
import { claimHandoverCode } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJsonBody, resultErrorResponse, toErrorResponse, zodErrorMessage } from "@/lib/api-errors";

const ClaimSchema = z.object({
  code: z
    .string({ error: "Handover code is required." })
    .trim()
    .min(1, "Handover code is required.")
    .max(32, "Invalid handover code."),
  notes: z
    .string({ error: "Notes must be a string of at most 500 characters." })
    .trim()
    .max(500, "Notes must be a string of at most 500 characters.")
    .nullable()
    .optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Claiming creates a checkout for the claimant, and viewers cannot check out equipment.
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Forbidden: Viewers cannot receive equipment." }, { status: 403 });
  }

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const parsed = ClaimSchema.safeParse(body.data);
  if (!parsed.success) {
    // Report the first problem only, so the messages above read naturally.
    return errorResponse(400, parsed.error.issues[0]?.message ?? zodErrorMessage(parsed.error));
  }

  const userId = Number(session.user.id);
  const userName = session.user.name || session.user.username || "Borrower";

  try {
    const result = await claimHandoverCode({
      code: parsed.data.code.toUpperCase(),
      claimed_by_id: userId,
      claimed_by_name: userName,
      notes: parsed.data.notes || null,
    });

    if (!result.success) {
      // Unknown code → 404; expired / loan ended → 410; already claimed/revoked → 409;
      // other rule violations (e.g. handing over to yourself) → 400.
      return resultErrorResponse(result.error, "Failed to claim handover.");
    }

    return NextResponse.json({ success: true, checkout: result.checkout });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to claim handover.");
  }
}
