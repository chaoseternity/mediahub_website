import { auth } from "@/lib/auth";
import { getAllNfcCards } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Forbidden: Viewers cannot access NFC card records" }, { status: 403 });
  }

  const cards = await getAllNfcCards();
  return NextResponse.json(cards);
}
