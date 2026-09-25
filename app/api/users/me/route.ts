import { auth } from "@/lib/auth";
import { updateUsername } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UsernameSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(50, "Name must be 50 characters or less")
    .regex(/^[\p{L}\p{N}_\-. ]+$/u, "Name contains invalid characters"),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UsernameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const userId = Number(session.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user session" }, { status: 400 });
  }

  try {
    await updateUsername(userId, parsed.data.username);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update profile";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
