import { auth } from "@/lib/auth";
import { getActiveAuditSession, getAuditSessionDetails, startAuditSession } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sessionIdParam = searchParams.get("id");

  if (sessionIdParam) {
    const sId = Number(sessionIdParam);
    if (!Number.isInteger(sId) || sId <= 0) {
      return NextResponse.json({ error: "Invalid session ID." }, { status: 400 });
    }
    const details = await getAuditSessionDetails(sId);
    if (!details) {
      return NextResponse.json({ error: "Audit session not found." }, { status: 404 });
    }
    return NextResponse.json(details);
  }

  const active = await getActiveAuditSession();
  if (!active) {
    return NextResponse.json({ active: null });
  }

  const details = await getAuditSessionDetails(active.id);
  return NextResponse.json({ active, ...details });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admin and verified members can start audits
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Forbidden: Verified or Admin role required to run stock audit." }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const name = body.name?.trim() || `Inventory Audit (${new Date().toLocaleDateString("en-GB")})`;
    const notes = body.notes?.trim() || null;
    const userId = Number(session.user.id);

    const auditSession = await startAuditSession({
      name,
      started_by: userId,
      notes,
    });

    const details = await getAuditSessionDetails(auditSession.id);

    return NextResponse.json({ ...auditSession, ...(details || { records: [] }) }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to start audit session.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
