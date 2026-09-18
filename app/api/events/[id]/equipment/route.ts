import { auth } from "@/lib/auth";
import {
  getEventById,
  getEquipmentById,
  getUserByEmail,
  attachEquipmentToEventSection,
  detachEquipmentFromEventSection,
} from "@/lib/db";
import type { AppEvent, EventSection } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const EquipmentEventSchema = z.object({
  equipment_id: z.number().int().positive(),
  section: z.enum(["photo", "video", "av"]).optional().default("photo"),
});

function canManageEventEquipment(event: AppEvent, section: EventSection, userEmail: string, role: string, currentUserId?: number): boolean {
  if (role === "admin") return true;
  if (currentUserId && event.oics.some((u) => u.id === currentUserId)) return true;
  const secIcs = event.section_ics[section] || [];
  return !!currentUserId && secIcs.some((ic) => ic.id === currentUserId);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = EquipmentEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const event = await getEventById(eventId);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const currentUser = await getUserByEmail(session.user.email!);
  const isAllowed = canManageEventEquipment(event, parsed.data.section, session.user.email!, session.user.role, currentUser?.id);
  if (!isAllowed) {
    return NextResponse.json({ error: "Only admins, OICs, and section ICs can add equipment to this event" }, { status: 403 });
  }

  const equipment = await getEquipmentById(parsed.data.equipment_id);
  if (!equipment) {
    return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
  }

  try {
    const result = await attachEquipmentToEventSection(eventId, parsed.data.equipment_id, parsed.data.section, false, currentUser?.id ?? null);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to attach equipment to event:", err);
    return NextResponse.json({ error: "Failed to attach equipment to event" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
  }

  const event = await getEventById(eventId);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = EquipmentEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const currentUser = await getUserByEmail(session.user.email!);
  const isAllowed = canManageEventEquipment(event, parsed.data.section, session.user.email!, session.user.role, currentUser?.id);
  if (!isAllowed) {
    return NextResponse.json({ error: "Only admins, OICs, and section ICs can remove equipment from this event" }, { status: 403 });
  }

  try {
    const result = await detachEquipmentFromEventSection(eventId, parsed.data.equipment_id, parsed.data.section);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to detach equipment from event:", err);
    return NextResponse.json({ error: "Failed to detach equipment from event" }, { status: 500 });
  }
}
