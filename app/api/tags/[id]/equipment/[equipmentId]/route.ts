import { auth } from "@/lib/auth";
import { removeTagFromEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { resultErrorResponse, toErrorResponse } from "@/lib/api-errors";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; equipmentId: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, equipmentId } = await params;
  const tagId = Number(id);
  const eqId = Number(equipmentId);
  if (!Number.isInteger(tagId) || tagId <= 0 || !Number.isInteger(eqId) || eqId <= 0) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  try {
    const result = await removeTagFromEquipment(eqId, tagId);
    if (!result.success) return resultErrorResponse(result.error, "Failed to remove tag from equipment", 409);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to remove tag from equipment");
  }
}
