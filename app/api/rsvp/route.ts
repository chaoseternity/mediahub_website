import { getDeploymentByToken, updateDeploymentRSVP } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const RSVPPostSchema = z.object({
  token: z.string().min(1, "Token required"),
  status: z.enum(["confirmed", "declined"]),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    const details = await getDeploymentByToken(token);
    if (!details) {
      return NextResponse.json({ error: "Invalid or expired invitation link" }, { status: 404 });
    }

    return NextResponse.json({
      eventName: details.event.name,
      eventDescription: details.event.description,
      startTime: details.event.start_time,
      endTime: details.event.end_time,
      location: details.event.location,
      hasRehearsal: details.event.has_rehearsal,
      rehearsalStartTime: details.event.rehearsal_start_time,
      rehearsalEndTime: details.event.rehearsal_end_time,
      attendingRehearsal: details.attending_rehearsal,
      userName: details.user.name,
      userEmail: details.user.email,
      section: details.section,
      responseStatus: details.response_status,
      respondedAt: details.responded_at,
    });
  } catch (err: unknown) {
    console.error("RSVP GET Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load RSVP details" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RSVPPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { token, status } = parsed.data;
    const result = await updateDeploymentRSVP(token, status);

    if (!result.success) {
      return NextResponse.json({ error: result.error || "Failed to update RSVP" }, { status: 400 });
    }

    return NextResponse.json({ success: true, status });
  } catch (err: unknown) {
    console.error("RSVP POST Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to submit RSVP" },
      { status: 500 }
    );
  }
}
