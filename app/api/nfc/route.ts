import { auth } from "@/lib/auth";
import { getNfcMemberData } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const nfcId = searchParams.get("nfc_id");

  if (!nfcId || !nfcId.trim()) {
    return NextResponse.json({ error: "Missing nfc_id parameter" }, { status: 400 });
  }

  const data = await getNfcMemberData(nfcId.trim());
  if (!data) {
    return NextResponse.json({ found: false, nfc_id: nfcId.trim() }, { status: 200 });
  }

  return NextResponse.json({ found: true, ...data }, { status: 200 });
}
