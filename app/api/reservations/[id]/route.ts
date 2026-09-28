import { auth } from "@/lib/auth";
import { getReservationById, cancelReservation, fulfillReservation } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const resId = Number(id);
  if (!Number.isInteger(resId) || resId <= 0) {
    return NextResponse.json({ error: "Invalid reservation ID." }, { status: 400 });
  }

  const reservation = await getReservationById(resId);
  if (!reservation) {
    return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
  }

  return NextResponse.json(reservation);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const resId = Number(id);
  if (!Number.isInteger(resId) || resId <= 0) {
    return NextResponse.json({ error: "Invalid reservation ID." }, { status: 400 });
  }

  const userId = Number(session.user.id);
  const isAdmin = session.user.role === "admin";

  const result = await cancelReservation(resId, userId, isAdmin);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const resId = Number(id);
  if (!Number.isInteger(resId) || resId <= 0) {
    return NextResponse.json({ error: "Invalid reservation ID." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action || "fulfill";

  if (action === "fulfill") {
    const result = await fulfillReservation(resId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, checkout: result.checkout });
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
