import { auth } from "@/lib/auth";
import { removeTagFromEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; equipmentId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, equipmentId } = await params;
  const result = await removeTagFromEquipment(Number(equipmentId), Number(id));
  if (!result.success)
    return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ success: true });
}
