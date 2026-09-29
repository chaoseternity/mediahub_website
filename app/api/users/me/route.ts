import { auth } from "@/lib/auth";
import { updateUsername } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { validationErrorResponse } from "@/lib/api-errors";
import { usernameErrorResponse } from "../username-errors";
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
    return validationErrorResponse(parsed.error);
  }

  const userId = Number(session.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user session" }, { status: 400 });
  }

  try {
    await updateUsername(userId, parsed.data.username);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    // Name collisions with another user's username/display name → 409 with the data layer's
    // message; invalid names → 400; anything unexpected → generic 500.
    return usernameErrorResponse(err, "Failed to update profile");
  }
}
