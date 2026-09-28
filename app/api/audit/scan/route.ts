import { auth } from "@/lib/auth";
import { recordAuditScan } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Forbidden: Verified or Admin role required." }, { status: 403 });
  }

  try {
    const body = await req.json();
    const rawSessionId = body.session_id ?? body.sessionId;
    const rawIdentifier = body.identifier ?? body.code;

    const sId = Number(rawSessionId);
    if (!Number.isInteger(sId) || sId <= 0) {
      return NextResponse.json({ error: "Invalid session ID." }, { status: 400 });
    }

    if (!rawIdentifier || typeof rawIdentifier !== "string" || !rawIdentifier.trim()) {
      return NextResponse.json({ error: "Equipment identifier is required." }, { status: 400 });
    }

    const identifier = rawIdentifier.trim();

    const userId = Number(session.user.id);
    const scanMethod = body.method === "nfc" ? "nfc" : body.method === "qr" ? "qr" : "manual";

    const result = await recordAuditScan({
      session_id: sId,
      equipment_identifier: identifier.trim(),
      scanned_by: userId,
      method: scanMethod,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record audit scan.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
