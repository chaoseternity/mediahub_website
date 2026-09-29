import { auth } from "@/lib/auth";
import { recordAuditScan } from "@/lib/db";
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

const identifierSchema = z.string().trim().min(1).max(200);

/** Accepts snake_case/camelCase session keys and `identifier`/`code` (the client sends both). */
const AuditScanSchema = z.object({
  session_id: z.unknown().optional(),
  sessionId: z.unknown().optional(),
  identifier: z.unknown().optional(),
  code: z.unknown().optional(),
  method: z.unknown().optional(),
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

  const parsed = AuditScanSchema.safeParse(body.data);
  if (!parsed.success) {
    return errorResponse(400, "Invalid request body. Expected { session_id, identifier, method? }.");
  }

  const sId = sessionIdSchema.safeParse(parsed.data.session_id ?? parsed.data.sessionId);
  if (!sId.success) {
    return errorResponse(400, "Invalid session ID.");
  }

  const identifier = identifierSchema.safeParse(parsed.data.identifier ?? parsed.data.code);
  if (!identifier.success) {
    return errorResponse(400, "Equipment identifier is required (max 200 characters).");
  }

  const userId = Number(session.user.id);
  const rawMethod = parsed.data.method;
  const scanMethod = rawMethod === "nfc" ? "nfc" : rawMethod === "qr" ? "qr" : "manual";

  try {
    const result = await recordAuditScan({
      session_id: sId.data,
      equipment_identifier: identifier.data,
      scanned_by: userId,
      method: scanMethod,
    });

    if (!result.success) {
      // Unknown session / equipment → 404; session no longer in progress → 409.
      return resultErrorResponse(result.error, "Failed to record audit scan.");
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to record audit scan.");
  }
}
