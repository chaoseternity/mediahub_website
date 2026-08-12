import { auth } from "@/lib/auth";
import { updateUsername } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UsernameSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(50, "Name must be 50 characters or less"),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = UsernameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await updateUsername(Number(session.user.id), parsed.data.username);
  return NextResponse.json({ success: true });
}
