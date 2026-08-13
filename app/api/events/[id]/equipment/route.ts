import { auth } from "@/lib/auth";
import { getEventById, getUserByEmail, attachEquipmentToEvent, detachEquipmentFromEvent } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const EquipmentEventSchema = z.object({
  equipment_id: z.number().int(),
});

async function canManageEventEquipment(eventId: number, userEmail: string, role: string): Promise<boolean> {
  if (role === "admin") return true;
  const event = await getEventById(eventId);
  if (!event) return false;
  const currentUser = await getUserByEmail(userEmail);
  if (!currentUser) return false;
  return event.ics.some((ic) => ic.id === currentUser.id);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const eventId = Number(id);

  const isAllowed = await canManageEventEquipment(eventId, session.user.email!, session.user.role);
  if (!isAllowed) {
    return NextResponse.json({ error: "Only admins and assigned ICs can add equipment to this event" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = EquipmentEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const currentUser = await getUserByEmail(session.user.email!);
  const result = await attachEquipmentToEvent(eventId, parsed.data.equipment_id, currentUser?.id ?? null);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const eventId = Number(id);

  const isAllowed = await canManageEventEquipment(eventId, session.user.email!, session.user.role);
  if (!isAllowed) {
    return NextResponse.json({ error: "Only admins and assigned ICs can remove equipment from this event" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = EquipmentEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await detachEquipmentFromEvent(eventId, parsed.data.equipment_id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
