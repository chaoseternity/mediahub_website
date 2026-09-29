import { auth } from "@/lib/auth";
import { getUserById, updateUserRole, updateUsername, deleteUser } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { resultErrorResponse, toErrorResponse, validationErrorResponse } from "@/lib/api-errors";
import { usernameErrorResponse } from "../username-errors";
import { z } from "zod";

const UpdateUserSchema = z.union([
  z.object({ role: z.enum(["admin", "verified", "viewer"]) }),
  z.object({
    username: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .regex(/^[\p{L}\p{N}_\-. ]+$/u, "Username contains invalid characters"),
  }),
]);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateUserSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const isSelf =
    Number(session.user.id) === userId ||
    Boolean(session.user.email && user.email.toLowerCase() === session.user.email.toLowerCase());

  if ("role" in parsed.data && isSelf && parsed.data.role !== "admin") {
    return NextResponse.json({ error: "Cannot demote your own admin account" }, { status: 400 });
  }

  if ("role" in parsed.data) {
    try {
      const result = await updateUserRole(userId, parsed.data.role);
      if (!result.success) {
        return resultErrorResponse(result.error, "Failed to update user role");
      }
      return NextResponse.json({ success: true });
    } catch (err: unknown) {
      // e.g. demoting an ADMIN_EMAILS admin (ConfiguredAdminError) → 403 with its message.
      return toErrorResponse(err, "Failed to update user role");
    }
  }

  try {
    await updateUsername(userId, parsed.data.username);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return usernameErrorResponse(err, "Failed to update username");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const isSelf =
    Number(session.user.id) === userId ||
    Boolean(session.user.email && user.email.toLowerCase() === session.user.email.toLowerCase());

  if (isSelf) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  try {
    const result = await deleteUser(userId);
    if (!result.success) {
      return resultErrorResponse(result.error, "Failed to delete user");
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to delete user");
  }
}
