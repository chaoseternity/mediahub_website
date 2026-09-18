import { auth } from "@/lib/auth";
import { getNfcMemberData } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const rawNfcValue = searchParams.get("nfc_value") || searchParams.get("nfc_id");
  const nfcValue = rawNfcValue?.trim();

  if (!nfcValue || nfcValue.length > 100) {
    return NextResponse.json({ error: "Missing or invalid nfc_value parameter (max 100 characters)" }, { status: 400 });
  }

  const data = await getNfcMemberData(nfcValue);
  if (!data) {
    return NextResponse.json({ found: false, nfc_value: nfcValue.trim() }, { status: 200 });
  }

  return NextResponse.json({ found: true, ...data }, { status: 200 });
}
