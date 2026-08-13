import { auth } from "@/lib/auth";
import {
  getEventById,
  getUserByEmail,
  attachEquipmentToEventSection,
  detachEquipmentFromEventSection,
  addDeploymentToEventSection,
  removeDeploymentFromEventSection,
  updateSectionRehearsalConfig,
} from "@/lib/db";
import type { EventSection } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const SectionEquipmentSchema = z.object({
  action: z.enum(["add_equipment", "remove_equipment", "add_deployment", "remove_deployment", "update_rehearsal"]),
  section: z.enum(["photo", "video", "av"]),
  equipment_id: z.number().int().optional(),
  user_id: z.number().int().optional(),
  used_for_rehearsal: z.boolean().optional(),
  attending_rehearsal: z.boolean().optional(),
  participating: z.boolean().optional(),
  rehearsal_equipment_ids: z.array(z.number().int()).optional(),
  rehearsal_user_ids: z.array(z.number().int()).optional(),
});

async function verifySectionPermission(eventId: number, section: EventSection, userEmail: string, role: string): Promise<boolean> {
  if (role === "admin") return true;
  const event = await getEventById(eventId);
  if (!event) return false;
  const currentUser = await getUserByEmail(userEmail);
  if (!currentUser) return false;

  // OICs can manage any section
  const isOic = event.oics.some((oic) => oic.id === currentUser.id);
  if (isOic) return true;

  // Section ICs can manage their section
  const sectionIcs = event.section_ics[section] || [];
  return sectionIcs.some((ic) => ic.id === currentUser.id);
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
  const parsed = SectionEquipmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { action, section } = parsed.data;
  const isAllowed = await verifySectionPermission(eventId, section, session.user.email!, session.user.role);
  if (!isAllowed) {
    return NextResponse.json(
      { error: `You do not have permission to manage the ${section.toUpperCase()} section for this event` },
      { status: 403 }
    );
  }

  const currentUser = await getUserByEmail(session.user.email!);

  if (action === "add_equipment") {
    if (!parsed.data.equipment_id) return NextResponse.json({ error: "equipment_id required" }, { status: 400 });
    await attachEquipmentToEventSection(eventId, parsed.data.equipment_id, section, parsed.data.used_for_rehearsal ?? false, currentUser?.id ?? null);
  } else if (action === "remove_equipment") {
    if (!parsed.data.equipment_id) return NextResponse.json({ error: "equipment_id required" }, { status: 400 });
    await detachEquipmentFromEventSection(eventId, parsed.data.equipment_id, section);
  } else if (action === "add_deployment") {
    if (!parsed.data.user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
    await addDeploymentToEventSection(eventId, parsed.data.user_id, section, parsed.data.attending_rehearsal ?? false, currentUser?.id ?? null);
  } else if (action === "remove_deployment") {
    if (!parsed.data.user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
    await removeDeploymentFromEventSection(eventId, parsed.data.user_id, section);
  } else if (action === "update_rehearsal") {
    await updateSectionRehearsalConfig(
      eventId,
      section,
      parsed.data.participating ?? false,
      parsed.data.rehearsal_equipment_ids,
      parsed.data.rehearsal_user_ids
    );
  }

  const updatedEvent = await getEventById(eventId);
  return NextResponse.json(updatedEvent);
}
