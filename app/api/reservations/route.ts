import { auth } from "@/lib/auth";
import { getReservations, createReservation } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import type { ReservationStatus } from "@/lib/types";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const equipmentIdParam = searchParams.get("equipmentId");
  const reservedByParam = searchParams.get("reservedBy");
  const statusParam = searchParams.get("status") as ReservationStatus | null;

  const equipment_id = equipmentIdParam ? Number(equipmentIdParam) : undefined;
  const reserved_by = reservedByParam ? Number(reservedByParam) : undefined;

  const reservations = await getReservations({
    equipment_id: equipment_id && Number.isInteger(equipment_id) ? equipment_id : undefined,
    reserved_by: reserved_by && Number.isInteger(reserved_by) ? reserved_by : undefined,
    status: statusParam || undefined,
  });

  return NextResponse.json(reservations);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { equipment_id, notes, purpose } = body;
    const start_time = body.start_time || body.start_date;
    const end_time = body.end_time || body.end_date;

    const eqId = Number(equipment_id);
    if (!Number.isInteger(eqId) || eqId <= 0) {
      return NextResponse.json({ error: "Invalid equipment ID." }, { status: 400 });
    }

    if (!start_time || !end_time) {
      return NextResponse.json({ error: "start_time and end_time are required." }, { status: 400 });
    }

    const userId = Number(session.user.id);
    const userName = session.user.name || session.user.username || "Club Member";

    const reservation = await createReservation({
      equipment_id: eqId,
      reserved_by: userId,
      reserved_by_name: userName,
      start_time,
      end_time,
      notes: notes || purpose || null,
    });

    return NextResponse.json(reservation, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create reservation.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
