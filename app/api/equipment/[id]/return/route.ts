import { auth } from "@/lib/auth";
import { returnCheckout, getEquipmentById, getUserByEmail } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const eqId = Number(id);
  if (!Number.isInteger(eqId) || eqId <= 0) {
    return NextResponse.json({ error: "Invalid equipment ID" }, { status: 400 });
  }

  const equipment = await getEquipmentById(eqId);
  if (!equipment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  const activeCheckout = equipment.active_checkout;
  if (!isAdmin && activeCheckout) {
    const dbUser = await getUserByEmail(session.user.email);
    const callerId = dbUser?.id ?? Number(session.user.id);
    const checkedOutById = activeCheckout.checked_out_by;

    const isBorrower =
      checkedOutById !== null && Number.isInteger(callerId) && callerId === checkedOutById;

    if (!isBorrower) {
      return NextResponse.json(
        { error: "Forbidden: You can only return equipment checked out to you, or ask an Admin to assist." },
        { status: 403 }
      );
    }
  }

  try {
    const checkout = await returnCheckout(eqId);
    return NextResponse.json(checkout);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Return failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
