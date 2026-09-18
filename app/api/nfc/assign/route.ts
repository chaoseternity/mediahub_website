import { auth } from "@/lib/auth";
import { createNfcCard } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const AssignSchema = z.object({
  nfc_value: z.string().trim().min(1).max(100),
  member_name: z.string().trim().min(1).max(100),
  notes: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = AssignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const card = await createNfcCard({
      nfc_value: parsed.data.nfc_value,
      member_name: parsed.data.member_name,
      notes: parsed.data.notes,
    });
    return NextResponse.json({ success: true, card });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to register NFC Card";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
