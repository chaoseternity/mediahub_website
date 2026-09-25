import { auth } from "@/lib/auth";
import { processReturnReminders, getPendingReturnReminders } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token === secret) return true;
  }

  const customHeader = req.headers.get("x-cron-secret");
  if (customHeader && customHeader.trim() === secret) {
    return true;
  }

  return false;
}

export async function GET(req: NextRequest) {
  const isCron = isAuthorizedCron(req);
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  if (!isCron && !isAdmin) {
    return NextResponse.json(
      { error: "Unauthorized. Cron secret or Admin privileges required." },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "true";
  const previewOnly = searchParams.get("preview") === "true";

  if (previewOnly) {
    const pending = await getPendingReturnReminders();
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      count: pending.length,
      items: pending,
    });
  }

  const results = await processReturnReminders({
    origin: req.nextUrl.origin,
    force: isAdmin && force,
  });

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    ...results,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
