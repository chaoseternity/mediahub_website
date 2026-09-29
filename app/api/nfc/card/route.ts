import { auth } from "@/lib/auth";
import { createNfcCard, getNfcCardByValue } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { validationErrorResponse } from "@/lib/api-errors";
import { z } from "zod";
import { nfcErrorResponse } from "../errors";

const CreateCardSchema = z.object({
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateCardSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    // Idempotent (e.g. an offline registration replayed after an earlier delivery
    // succeeded): the same card already registered to the same member is a success.
    const existing = await getNfcCardByValue(parsed.data.nfc_value);
    if (
      existing &&
      existing.member_name.trim().toLowerCase() === parsed.data.member_name.trim().toLowerCase()
    ) {
      return NextResponse.json({ success: true, card: existing, already_applied: 1 });
    }

    const card = await createNfcCard({
      nfc_value: parsed.data.nfc_value,
      member_name: parsed.data.member_name,
      notes: parsed.data.notes,
    });
    return NextResponse.json({ success: true, card }, { status: 201 });
  } catch (err: unknown) {
    return nfcErrorResponse(err, "Failed to register NFC card");
  }
}
