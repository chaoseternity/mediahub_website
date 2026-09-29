import { auth } from "@/lib/auth";
import { getActiveAuditSession, getAuditSessionDetails, startAuditSession } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, toErrorResponse, validationErrorResponse } from "@/lib/api-errors";

const StartAuditSchema = z.object({
  name: z.string({ error: "name must be a string" }).trim().max(200, "name cannot exceed 200 characters").nullable().optional(),
  notes: z.string({ error: "notes must be a string" }).trim().max(1000, "notes cannot exceed 1000 characters").nullable().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admin access required." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const sessionIdParam = searchParams.get("id");

  try {
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
      return NextResponse.json({ active: null, session: null, records: [] });
    }

    const details = await getAuditSessionDetails(active.id);
    return NextResponse.json({
      active,
      session: details?.session ?? active,
      records: details?.records ?? [],
      ...(details?.session ?? active),
    });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to load audit session.");
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admin access required." }, { status: 403 });
  }

  // The body is optional (defaults apply), but when present it must be a well-formed object.
  const body = await readJsonBody(req, { allowEmpty: true });
  if (!body.ok) return body.response;
  const parsed = StartAuditSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const name = parsed.data.name || `Inventory Audit (${new Date().toLocaleDateString("en-GB")})`;
    const notes = parsed.data.notes || null;
    const userId = Number(session.user.id);

    const auditSession = await startAuditSession({
      name,
      started_by: userId,
      notes,
    });

    const details = await getAuditSessionDetails(auditSession.id);

    return NextResponse.json({ ...auditSession, ...(details || { records: [] }) }, { status: 201 });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to start audit session.");
  }
}
