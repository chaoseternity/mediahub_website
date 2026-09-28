import { auth } from "@/lib/auth";
import { createHandoverCode, getEquipmentById } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const eqId = Number(id);
  if (!Number.isInteger(eqId) || eqId <= 0) {
    return NextResponse.json({ error: "Invalid equipment ID." }, { status: 400 });
  }

  const equipment = await getEquipmentById(eqId);
  if (!equipment) {
    return NextResponse.json({ error: "Equipment not found." }, { status: 404 });
  }

  if (!equipment.active_checkout) {
    return NextResponse.json({ error: "Cannot handover equipment that is not currently checked out." }, { status: 400 });
  }

  const userId = Number(session.user.id);
  const isAdmin = session.user.role === "admin";
  const checkedOutById = equipment.active_checkout.checked_out_by;

  if (!isAdmin && checkedOutById !== null && checkedOutById !== userId) {
    return NextResponse.json(
      { error: "Forbidden: You can only generate a handover code for equipment checked out to you." },
      { status: 403 }
    );
  }

  try {
    const handover = await createHandoverCode(equipment.active_checkout.id, userId);
    return NextResponse.json(handover, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate handover code.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
