import { auth } from "@/lib/auth";
import { updateUserNfcId, getUserById } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const AssignSchema = z.object({
  user_id: z.number().int().positive(),
  nfc_id: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = AssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await getUserById(parsed.data.user_id);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  try {
    await updateUserNfcId(parsed.data.user_id, parsed.data.nfc_id);
    return NextResponse.json({ success: true, memberName: user.name, nfc_id: parsed.data.nfc_id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to assign NFC Card";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
