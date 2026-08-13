import { auth } from "@/lib/auth";
import { getAllEvents, createEvent, getUserByEmail } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CreateEventSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  start_time: z.string().min(1, "Start time is required"),
  end_time: z.string().min(1, "End time is required"),
  location: z.string().min(1, "Location is required"),
  has_rehearsal: z.boolean().optional().default(false),
  rehearsal_start_time: z.string().optional(),
  rehearsal_end_time: z.string().optional(),
  oic_user_ids: z.array(z.number().int()).optional().default([]),
  photo_ic_ids: z.array(z.number().int()).optional().default([]),
  video_ic_ids: z.array(z.number().int()).optional().default([]),
  av_ic_ids: z.array(z.number().int()).optional().default([]),
});

export async function GET() {
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
