import { auth } from "@/lib/auth";
import { completeAuditSession } from "@/lib/db";
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
    const markMissing = body.mark_missing_in_catalog ?? body.markMissingInCatalog;

    const sId = Number(rawSessionId);
    if (!Number.isInteger(sId) || sId <= 0) {
      return NextResponse.json({ error: "Invalid session ID." }, { status: 400 });
    }

    const result = await completeAuditSession(sId, {
      markMissingAsCatalogMissing: Boolean(markMissing),
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to complete audit session.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
