import { auth } from "@/lib/auth";
import { updateUserRole, updateUsername, updateUserNfcId, deleteUser } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateUserSchema = z.union([
  z.object({ role: z.enum(["admin", "verified", "viewer"]) }),
  z.object({ username: z.string().trim().min(1).max(50) }),
  z.object({ nfc_id: z.string().trim().nullable() }),
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
  const body = await req.json();
  const parsed = UpdateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    if ("role" in parsed.data) {
      await updateUserRole(Number(id), parsed.data.role);
    } else if ("username" in parsed.data) {
      await updateUsername(Number(id), parsed.data.username);
    } else if ("nfc_id" in parsed.data) {
      await updateUserNfcId(Number(id), parsed.data.nfc_id || null);
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update user";
    return NextResponse.json({ error: msg }, { status: 400 });
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
  if (String(session.user.id) === id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  await deleteUser(Number(id));
  return NextResponse.json({ success: true });
}
