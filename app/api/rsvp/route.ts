import { getDeploymentByToken, updateDeploymentRSVP } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { resultErrorResponse, validationErrorResponse } from "@/lib/api-errors";
import { z } from "zod";

const RSVPPostSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, "Token required")
    .max(100, "Invalid token length")
    .regex(/^[0-9a-zA-Z_-]+$/, "Invalid token format"),
  status: z.enum(["confirmed", "declined"]),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawToken = searchParams.get("token");
    const token = rawToken?.trim();

    if (!token || token.length > 100 || !/^[0-9a-zA-Z_-]+$/.test(token)) {
      return NextResponse.json({ error: "Token is required and must be valid" }, { status: 400 });
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
      section: details.section,
      responseStatus: details.response_status,
      respondedAt: details.responded_at,
      // RSVP closes once the event has ended (enforced again in updateDeploymentRSVP).
      eventEnded: Date.now() > new Date(details.event.end_time).getTime(),
    });
  } catch (err: unknown) {
    // Public endpoint: never expose internal error text.
    console.error("RSVP GET Error:", err);
    return NextResponse.json({ error: "Failed to load RSVP details" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RSVPPostSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const { token, status } = parsed.data;
    const result = await updateDeploymentRSVP(token, status);

    if (!result.success) {
      const isNotFound = result.error?.includes("Invalid or expired");
      const isClosed = result.error?.includes("has ended");
      if (isNotFound || isClosed) {
        return NextResponse.json({ error: result.error }, { status: isNotFound ? 404 : 410 });
      }
      return resultErrorResponse(result.error, "Failed to update RSVP");
    }

    return NextResponse.json({ success: true, status });
  } catch (err: unknown) {
    // Public endpoint: never expose internal error text.
    console.error("RSVP POST Error:", err);
    return NextResponse.json({ error: "Failed to submit RSVP" }, { status: 500 });
  }
}
