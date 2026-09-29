import { auth } from "@/lib/auth";
import { createHandoverCode, getEquipmentById } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";

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

  // Handovers only exist for checkouts made under an admin account (enforced again in
  // createHandoverCode, which also rejects NFC-station checkouts), so only admins can
  // generate a code.
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden: Handover is only available for equipment checked out under an admin account." },
      { status: 403 }
    );
  }

  const userId = Number(session.user.id);

  try {
    const handover = await createHandoverCode(equipment.active_checkout.id, userId);
    return NextResponse.json(handover, { status: 201 });
  } catch (err: unknown) {
    // Ineligible loans (NFC-station / non-admin checkouts) → 400, "Forbidden: ..." → 403,
    // missing loan → 404; anything unexpected is logged and reported generically.
    return toErrorResponse(err, "Failed to generate handover code.");
  }
}
