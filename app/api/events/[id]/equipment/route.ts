import { auth } from "@/lib/auth";
import { getEventById, getUserByEmail, attachEquipmentToEventSection, detachEquipmentFromEventSection } from "@/lib/db";
import type { EventSection } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const EquipmentEventSchema = z.object({
  equipment_id: z.number().int(),
  section: z.enum(["photo", "video", "av"]).optional().default("photo"),
});

async function canManageEventEquipment(eventId: number, section: EventSection, userEmail: string, role: string): Promise<boolean> {
  if (role === "admin") return true;
  const event = await getEventById(eventId);
  if (!event) return false;
  const currentUser = await getUserByEmail(userEmail);
  if (!currentUser) return false;
  if (event.oics.some((u) => u.id === currentUser.id)) return true;
  const secIcs = event.section_ics[section] || [];
  return secIcs.some((ic) => ic.id === currentUser.id);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const eventId = Number(id);

  const body = await req.json();
  const parsed = EquipmentEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const isAllowed = await canManageEventEquipment(eventId, parsed.data.section, session.user.email!, session.user.role);
  if (!isAllowed) {
    return NextResponse.json({ error: "Only admins, OICs, and section ICs can add equipment to this event" }, { status: 403 });
  }

  const currentUser = await getUserByEmail(session.user.email!);
  const result = await attachEquipmentToEventSection(eventId, parsed.data.equipment_id, parsed.data.section, false, currentUser?.id ?? null);
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

  const body = await req.json();
  const parsed = EquipmentEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const isAllowed = await canManageEventEquipment(eventId, parsed.data.section, session.user.email!, session.user.role);
  if (!isAllowed) {
    return NextResponse.json({ error: "Only admins, OICs, and section ICs can remove equipment from this event" }, { status: 403 });
  }

  const result = await detachEquipmentFromEventSection(eventId, parsed.data.equipment_id, parsed.data.section);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
