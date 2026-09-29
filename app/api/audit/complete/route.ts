import { auth } from "@/lib/auth";
import { completeAuditSession } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJsonBody, resultErrorResponse, toErrorResponse } from "@/lib/api-errors";

const sessionIdSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .trim()
    .regex(/^[1-9]\d{0,15}$/)
    .transform(Number),
]);

/** Accepts snake_case and camelCase keys (older clients send camelCase). */
const CompleteAuditSchema = z.object({
  session_id: z.unknown().optional(),
  sessionId: z.unknown().optional(),
  mark_missing_in_catalog: z.boolean().optional(),
  markMissingInCatalog: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admin access required." }, { status: 403 });
  }

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const parsed = CompleteAuditSchema.safeParse(body.data);
  if (!parsed.success) {
    return errorResponse(400, "Invalid request body. Expected { session_id, mark_missing_in_catalog? }.");
  }

  const sId = sessionIdSchema.safeParse(parsed.data.session_id ?? parsed.data.sessionId);
  if (!sId.success) {
    return errorResponse(400, "Invalid session ID.");
  }
  const markMissing = parsed.data.mark_missing_in_catalog ?? parsed.data.markMissingInCatalog ?? false;

  try {
    const result = await completeAuditSession(sId.data, {
      markMissingAsCatalogMissing: markMissing,
    });

    if (!result.success) {
      // "Audit session not found." → 404; already completed/cancelled → 409.
      return resultErrorResponse(result.error, "Failed to complete audit session.");
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to complete audit session.");
  }
}
