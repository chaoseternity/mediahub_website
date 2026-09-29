import { auth } from "@/lib/auth";
import { getEventById, updateEvent, deleteEvent, getUserByEmail } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, toErrorResponse, validationErrorResponse } from "@/lib/api-errors";

const UpdateEventSchema = z
  .object({
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

/**
 * Validates the event's timing AFTER merging the update onto the stored event, so a partial
 * update (e.g. only end_time) can't produce end < start, and rehearsal times stay consistent.
 * Returns an error message, or null when valid.
 */
function validateMergedTimes(
  existing: {
    start_time: string;
    end_time: string;
    has_rehearsal: boolean | number | null;
    rehearsal_start_time: string | null;
    rehearsal_end_time: string | null;
  },
  update: z.infer<typeof UpdateEventSchema>
): string | null {
  const start = update.start_time ?? existing.start_time;
  const end = update.end_time ?? existing.end_time;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs <= startMs) {
    return "Event end time must be after the start time";
  }

  const hasRehearsal = update.has_rehearsal ?? Boolean(existing.has_rehearsal);
  if (!hasRehearsal) return null;

  const rehStart =
    update.rehearsal_start_time !== undefined ? update.rehearsal_start_time : existing.rehearsal_start_time;
  const rehEnd =
    update.rehearsal_end_time !== undefined ? update.rehearsal_end_time : existing.rehearsal_end_time;

  const touchesRehearsal =
    update.has_rehearsal !== undefined ||
    update.rehearsal_start_time !== undefined ||
    update.rehearsal_end_time !== undefined;
  if (!rehStart || !rehEnd) {
    // Only reject when this update is what leaves the rehearsal incomplete, so legacy rows
    // with has_rehearsal but no times can still be edited in other respects.
    return touchesRehearsal ? "Rehearsal start and end times are required when the event has a rehearsal" : null;
  }

  const rehStartMs = Date.parse(rehStart);
  const rehEndMs = Date.parse(rehEnd);
  if (!Number.isNaN(rehStartMs) && !Number.isNaN(rehEndMs) && rehEndMs <= rehStartMs) {
    return "Rehearsal end time must be after the rehearsal start time";
  }
  return null;
}

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateEventSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  const timingError = validateMergedTimes(event, parsed.data);
  if (timingError) {
    return errorResponse(400, timingError);
  }

  try {
    // Non-admin OICs cannot rename event title
    if (!isAdmin && parsed.data.name && parsed.data.name !== event.name) {
      return NextResponse.json({ error: "Event name can only be changed by Admin accounts" }, { status: 403 });
    }

    // Non-admin OICs cannot modify who the OICs are
    if (!isAdmin && parsed.data.oic_user_ids !== undefined) {
      return NextResponse.json({ error: "OICs can only be assigned by Admin accounts" }, { status: 403 });
    }

    const updated = await updateEvent(eventId, parsed.data);
    if (!updated) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to update event");
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
    return toErrorResponse(err, "Failed to delete event");
  }
}
