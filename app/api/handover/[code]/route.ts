import { auth } from "@/lib/auth";
import { getHandoverCodeByCode } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { code } = await params;
  if (!code) {
    return NextResponse.json({ error: "Handover code is required." }, { status: 400 });
  }
  if (code.length > 32) {
    return NextResponse.json({ error: "Handover code not found." }, { status: 404 });
  }

  let handover: Awaited<ReturnType<typeof getHandoverCodeByCode>>;
  try {
    handover = await getHandoverCodeByCode(code);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to look up handover code.");
  }
  // Only the code's creator (or an admin) may look it up, so this endpoint can't be used
  // to test guessed codes. Unauthorised callers get the same 404 as an unknown code.
  const isCreator = handover && handover.from_user_id === Number(session.user.id);
  if (!handover || (!isCreator && session.user.role !== "admin")) {
    return NextResponse.json({ error: "Handover code not found." }, { status: 404 });
  }

  return NextResponse.json(handover);
}
