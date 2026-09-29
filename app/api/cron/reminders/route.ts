import { auth } from "@/lib/auth";
import { processReturnReminders, getPendingReturnReminders } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";
import { timingSafeEqualString } from "@/lib/request-security";

export const runtime = "nodejs";

/**
 * Who may do what:
 * - A request carrying the cron secret (`Authorization: Bearer <CRON_SECRET>` — what Vercel Cron
 *   sends with GET — or `x-cron-secret`) may run the reminders via GET or POST.
 * - An admin SESSION may only preview pending reminders via GET (no side effects), so a link
 *   or <img> pointing at this URL can't trigger emails (CSRF).
 * - Admin-triggered sending (including `force`, which bypasses the 24h dedupe) requires POST,
 *   which the middleware CSRF-protects.
 */
function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (timingSafeEqualString(token, secret)) return true;
  }

  const customHeader = req.headers.get("x-cron-secret");
  if (customHeader && timingSafeEqualString(customHeader.trim(), secret)) {
    return true;
  }

  return false;
}

async function isAdminSession(): Promise<boolean> {
  const session = await auth();
  return session?.user?.role === "admin";
}

function unauthorized() {
  return NextResponse.json(
    { error: "Unauthorized. Cron secret or Admin privileges required." },
    { status: 401 }
  );
}

async function preview() {
  const pending = await getPendingReturnReminders();
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    preview: true,
    count: pending.length,
    items: pending,
  });
}

async function run(req: NextRequest, force: boolean) {
  const results = await processReturnReminders({
    origin: req.nextUrl.origin,
    force,
  });
  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    ...results,
  });
}

export async function GET(req: NextRequest) {
  const isCron = isAuthorizedCron(req);
  const isAdmin = isCron ? false : await isAdminSession();

  if (!isCron && !isAdmin) {
    return unauthorized();
  }

  const { searchParams } = new URL(req.url);
  const previewOnly = searchParams.get("preview") === "true";

  try {
    // Admin sessions only ever get a side-effect-free preview over GET.
    if (previewOnly || !isCron) {
      return await preview();
    }
    // The scheduled job never forces: the 24h dedupe always applies to cron runs.
    return await run(req, false);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to process return reminders");
  }
}

export async function POST(req: NextRequest) {
  const isCron = isAuthorizedCron(req);
  const isAdmin = isCron ? false : await isAdminSession();

  if (!isCron && !isAdmin) {
    return unauthorized();
  }

  const { searchParams } = new URL(req.url);
  const previewOnly = searchParams.get("preview") === "true";
  // Only an admin (via a CSRF-protected POST) may bypass the 24h dedupe.
  const force = isAdmin && searchParams.get("force") === "true";

  try {
    if (previewOnly) {
      return await preview();
    }
    return await run(req, force);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to process return reminders");
  }
}
