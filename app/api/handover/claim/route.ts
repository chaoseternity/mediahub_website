import { auth } from "@/lib/auth";
import { claimHandoverCode } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { code, notes } = body;

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return NextResponse.json({ error: "Handover code is required." }, { status: 400 });
    }

    const userId = Number(session.user.id);
    const userName = session.user.name || session.user.username || "Borrower";

    const result = await claimHandoverCode({
      code: code.trim().toUpperCase(),
      claimed_by_id: userId,
      claimed_by_name: userName,
      notes: notes ?? null,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, checkout: result.checkout });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to claim handover.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
