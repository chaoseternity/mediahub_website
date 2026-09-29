import { auth } from "@/lib/auth";
import { getReservationById, cancelReservation, fulfillReservation } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, resultErrorResponse, toErrorResponse, zodErrorMessage, errorResponse } from "@/lib/api-errors";

const PatchReservationSchema = z.object({
  action: z.enum(["fulfill"], { error: "Unsupported action." }).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Reservations are admin-only." }, { status: 403 });
  }

  const { id } = await params;
  const resId = Number(id);
  if (!Number.isInteger(resId) || resId <= 0) {
    return NextResponse.json({ error: "Invalid reservation ID." }, { status: 400 });
  }

  try {
    const reservation = await getReservationById(resId);
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }
    return NextResponse.json(reservation);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to load reservation.");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Reservations are admin-only." }, { status: 403 });
  }

  const { id } = await params;
  const resId = Number(id);
  if (!Number.isInteger(resId) || resId <= 0) {
    return NextResponse.json({ error: "Invalid reservation ID." }, { status: 400 });
  }

  const userId = Number(session.user.id);
  const isAdmin = session.user.role === "admin";

  try {
    const result = await cancelReservation(resId, userId, isAdmin);
    if (!result.success) {
      // "Forbidden: ..." → 403, "Reservation not found." → 404, already cancelled/fulfilled → 409.
      return resultErrorResponse(result.error, "Failed to cancel reservation.");
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to cancel reservation.");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Reservations are admin-only." }, { status: 403 });
  }

  const { id } = await params;
  const resId = Number(id);
  if (!Number.isInteger(resId) || resId <= 0) {
    return NextResponse.json({ error: "Invalid reservation ID." }, { status: 400 });
  }

  const body = await readJsonBody(req, { allowEmpty: true });
  if (!body.ok) return body.response;
  const parsed = PatchReservationSchema.safeParse(body.data);
  if (!parsed.success) {
    return errorResponse(400, zodErrorMessage(parsed.error));
  }
  const action = parsed.data.action ?? "fulfill";

  if (action === "fulfill") {
    try {
      const result = await fulfillReservation(resId);
      if (!result.success) {
        // Includes checkout failures such as "Equipment is not available for checkout (...)" → 409.
        return resultErrorResponse(result.error, "Failed to fulfil reservation.");
      }
      return NextResponse.json({ success: true, checkout: result.checkout });
    } catch (err: unknown) {
      return toErrorResponse(err, "Failed to fulfil reservation.");
    }
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
