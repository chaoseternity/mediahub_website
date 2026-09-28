import { auth } from "@/lib/auth";
import { getHandoverCodeByCode } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

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

  const handover = await getHandoverCodeByCode(code);
  if (!handover) {
    return NextResponse.json({ error: "Handover code not found." }, { status: 404 });
  }

  return NextResponse.json(handover);
}
