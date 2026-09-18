import { auth } from "@/lib/auth";
import { getEventById, updateEvent, deleteEvent, getUserByEmail } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateEventSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  start_time: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), "Start time must be a valid date"),
  end_time: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), "End time must be a valid date"),
  location: z.string().trim().min(1).max(200).optional(),
  has_rehearsal: z.boolean().optional(),
  rehearsal_start_time: z
    .string()
    .max(100)
    .nullable()
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), "Rehearsal start time must be a valid date"),
  rehearsal_end_time: z
    .string()
    .max(100)
    .nullable()
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), "Rehearsal end time must be a valid date"),
  oic_user_ids: z.array(z.number().int().positive()).max(20).optional(),
  photo_ic_ids: z.array(z.number().int().positive()).max(20).optional(),
  video_ic_ids: z.array(z.number().int().positive()).max(20).optional(),
  av_ic_ids: z.array(z.number().int().positive()).max(20).optional(),
});

export async function GET(
  _req: NextRequest,
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
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(event);
}

export async function PUT(
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
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const currentUser = await getUserByEmail(session.user.email!);
  const isAdmin = session.user.role === "admin";
  const isOic = currentUser ? event.oics.some((oic) => oic.id === currentUser.id) : false;

  if (!isAdmin && !isOic) {
    return NextResponse.json({ error: "Only Admins and OICs can edit event details" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = UpdateEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    // Non-admin OICs cannot rename event title
    if (!isAdmin && parsed.data.name && parsed.data.name !== event.name) {
      return NextResponse.json({ error: "Event name can only be changed by Admin accounts" }, { status: 403 });
    }

    // Non-admin OICs cannot modify who the OICs are
    if (!isAdmin && parsed.data.oic_user_ids !== undefined) {
      return NextResponse.json({ error: "OICs can only be assigned by Admin accounts" }, { status: 403 });
    }

    const updated = await updateEvent(eventId, parsed.data);
    return NextResponse.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update event";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Events can only be deleted by Admin accounts" }, { status: 403 });
  }

  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
  }

  try {
    const result = await deleteEvent(eventId);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "Event not found." ? 404 : 409 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete event";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
