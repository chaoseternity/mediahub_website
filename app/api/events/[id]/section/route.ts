import { auth } from "@/lib/auth";
import {
  getEventById,
  getUserById,
  getUserByEmail,
  getEquipmentById,
  attachEquipmentToEventSection,
  detachEquipmentFromEventSection,
  addDeploymentToEventSection,
  removeDeploymentFromEventSection,
  updateSectionRehearsalConfig,
  resendDeploymentEmail,
} from "@/lib/db";
import { sendDeploymentInvitationEmail } from "@/lib/email";
import type { AppEvent, EventSection } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const SectionEquipmentSchema = z.object({
  action: z.enum([
    "add_equipment",
    "remove_equipment",
    "add_deployment",
    "remove_deployment",
    "update_rehearsal",
    "resend_deployment_email",
  ]),
  section: z.enum(["photo", "video", "av"]),
  equipment_id: z.number().int().positive().optional(),
  user_id: z.number().int().positive().optional(),
  used_for_rehearsal: z.boolean().optional(),
  attending_rehearsal: z.boolean().optional(),
  participating: z.boolean().optional(),
  rehearsal_equipment_ids: z.array(z.number().int().positive()).max(50).optional(),
  rehearsal_user_ids: z.array(z.number().int().positive()).max(50).optional(),
});

function verifySectionPermission(event: AppEvent, section: EventSection, userEmail: string, role: string, currentUserId?: number): boolean {
  if (role === "admin") return true;
  if (!currentUserId) return false;

  // OICs can manage any section
  const isOic = event.oics.some((oic) => oic.id === currentUserId);
  if (isOic) return true;

  // Section ICs can manage their section
  const sectionIcs = event.section_ics[section] || [];
  return sectionIcs.some((ic) => ic.id === currentUserId);
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

  const parsed = SectionEquipmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const event = await getEventById(eventId);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const { action, section } = parsed.data;
  const currentUser = await getUserByEmail(session.user.email!);
  const isAllowed = verifySectionPermission(event, section, session.user.email!, session.user.role, currentUser?.id);
  if (!isAllowed) {
    return NextResponse.json(
      { error: `You do not have permission to manage the ${section.toUpperCase()} section for this event` },
      { status: 403 }
    );
  }

  const origin = req.nextUrl.origin;

  try {
    if (action === "add_equipment") {
      if (!parsed.data.equipment_id) return NextResponse.json({ error: "equipment_id required" }, { status: 400 });
      const equipment = await getEquipmentById(parsed.data.equipment_id);
      if (!equipment) return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
      await attachEquipmentToEventSection(eventId, parsed.data.equipment_id, section, parsed.data.used_for_rehearsal ?? false, currentUser?.id ?? null);
    } else if (action === "remove_equipment") {
      if (!parsed.data.equipment_id) return NextResponse.json({ error: "equipment_id required" }, { status: 400 });
      await detachEquipmentFromEventSection(eventId, parsed.data.equipment_id, section);
    } else if (action === "add_deployment") {
      if (!parsed.data.user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
      const deployedUser = await getUserById(parsed.data.user_id);
      if (!deployedUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

      const result = await addDeploymentToEventSection(
        eventId,
        parsed.data.user_id,
        section,
        parsed.data.attending_rehearsal ?? false,
        currentUser?.id ?? null
      );

      // Trigger invitation email
      const rehConfig = event.section_rehearsals[section];
      await sendDeploymentInvitationEmail({
        toEmail: deployedUser.email,
        recipientName: deployedUser.name,
        eventName: event.name,
        eventDescription: event.description,
        section,
        startTime: event.start_time,
        endTime: event.end_time,
        location: event.location,
        hasRehearsal: event.has_rehearsal && rehConfig?.participating,
        rehearsalStartTime: event.rehearsal_start_time,
        rehearsalEndTime: event.rehearsal_end_time,
        attendingRehearsal: parsed.data.attending_rehearsal ?? false,
        token: result.token,
        origin,
      }).catch((e) => console.error("Non-blocking email send error:", e));
    } else if (action === "resend_deployment_email") {
      if (!parsed.data.user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
      const resendRes = await resendDeploymentEmail(eventId, parsed.data.user_id, section, origin);
      if (!resendRes.success) {
        return NextResponse.json({ error: resendRes.error }, { status: 404 });
      }
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
  } catch (err) {
    console.error("Event section update error:", err);
    return NextResponse.json({ error: "Failed to update event section" }, { status: 500 });
  }
}
