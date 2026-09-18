import { auth } from "@/lib/auth";
import { getAllEvents, createEvent, getUserByEmail } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CreateEventSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(2000).optional(),
  start_time: z.string().min(1, "Start time is required").max(100),
  end_time: z.string().min(1, "End time is required").max(100),
  location: z.string().trim().min(1, "Location is required").max(200),
  has_rehearsal: z.boolean().optional().default(false),
  rehearsal_start_time: z.string().max(100).optional(),
  rehearsal_end_time: z.string().max(100).optional(),
  oic_user_ids: z.array(z.number().int().positive()).max(20).optional().default([]),
  photo_ic_ids: z.array(z.number().int().positive()).max(20).optional().default([]),
  video_ic_ids: z.array(z.number().int().positive()).max(20).optional().default([]),
  av_ic_ids: z.array(z.number().int().positive()).max(20).optional().default([]),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const events = await getAllEvents();
  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can create events" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = CreateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const currentUser = await getUserByEmail(session.user.email!);
  const newEvent = await createEvent({
    name: parsed.data.name,
    description: parsed.data.description,
    start_time: parsed.data.start_time,
    end_time: parsed.data.end_time,
    location: parsed.data.location,
    created_by: currentUser?.id ?? null,
    has_rehearsal: parsed.data.has_rehearsal,
    rehearsal_start_time: parsed.data.rehearsal_start_time,
    rehearsal_end_time: parsed.data.rehearsal_end_time,
    oic_user_ids: parsed.data.oic_user_ids,
    photo_ic_ids: parsed.data.photo_ic_ids,
    video_ic_ids: parsed.data.video_ic_ids,
    av_ic_ids: parsed.data.av_ic_ids,
  });

  return NextResponse.json(newEvent, { status: 201 });
}
