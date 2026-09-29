import { auth } from "@/lib/auth";
import { getReservations, createReservation } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ReservationStatus } from "@/lib/types";
import { errorResponse, readJsonBody, toErrorResponse, zodErrorMessage } from "@/lib/api-errors";

const RESERVATION_STATUSES = ["confirmed", "cancelled", "fulfilled"] as const satisfies readonly ReservationStatus[];

const dateTimeString = (label: string) =>
  z
    .string({ error: `${label} must be a date/time string` })
    .trim()
    .min(1, `${label} is required`)
    .max(100, `${label} is too long`)
    .refine((v) => !Number.isNaN(Date.parse(v)), `${label} must be a valid date/time`);

const optionalText = (label: string) =>
  z
    .string({ error: `${label} must be a string` })
    .max(1000, `${label} cannot exceed 1000 characters`)
    .nullable()
    .optional();

/** Accepts `start_time`/`end_time` or the legacy `start_date`/`end_date` aliases. */
const CreateReservationSchema = z
  .object({
    equipment_id: z.union(
      [
        z.number().int().positive(),
        z
          .string()
          .trim()
          .regex(/^[1-9]\d{0,15}$/)
          .transform(Number),
      ],
      { error: "Invalid equipment ID." }
    ),
    start_time: dateTimeString("start_time").optional(),
    start_date: dateTimeString("start_date").optional(),
    end_time: dateTimeString("end_time").optional(),
    end_date: dateTimeString("end_date").optional(),
    notes: optionalText("notes"),
    purpose: optionalText("purpose"),
  })
  .refine((d) => Boolean((d.start_time ?? d.start_date) && (d.end_time ?? d.end_date)), {
    message: "start_time and end_time are required.",
    path: ["start_time"],
  })
  .refine(
    (d) => {
      const start = d.start_time ?? d.start_date;
      const end = d.end_time ?? d.end_date;
      if (!start || !end) return true;
      return Date.parse(start) < Date.parse(end);
    },
    { message: "Invalid timeframe: start_time must be strictly before end_time.", path: ["end_time"] }
  );

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Reservations are admin-only." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const equipmentIdParam = searchParams.get("equipmentId");
  const reservedByParam = searchParams.get("reservedBy");
  const statusParam = searchParams.get("status");

  if (statusParam && !(RESERVATION_STATUSES as readonly string[]).includes(statusParam)) {
    return errorResponse(400, `Invalid status filter. Use one of: ${RESERVATION_STATUSES.join(", ")}.`);
  }

  const equipment_id = equipmentIdParam ? Number(equipmentIdParam) : undefined;
  const reserved_by = reservedByParam ? Number(reservedByParam) : undefined;

  try {
    const reservations = await getReservations({
      equipment_id: equipment_id && Number.isInteger(equipment_id) ? equipment_id : undefined,
      reserved_by: reserved_by && Number.isInteger(reserved_by) ? reserved_by : undefined,
      status: (statusParam as ReservationStatus | null) || undefined,
    });
    return NextResponse.json(reservations);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to load reservations.");
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Reservations are admin-only." }, { status: 403 });
  }

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const parsed = CreateReservationSchema.safeParse(body.data);
  if (!parsed.success) {
    return errorResponse(400, zodErrorMessage(parsed.error));
  }

  const { equipment_id, notes, purpose } = parsed.data;
  const start_time = (parsed.data.start_time ?? parsed.data.start_date)!;
  const end_time = (parsed.data.end_time ?? parsed.data.end_date)!;

  const userId = Number(session.user.id);
  const userName = session.user.name || "Club Member";

  try {
    const reservation = await createReservation({
      equipment_id,
      reserved_by: userId,
      reserved_by_name: userName,
      start_time,
      end_time,
      notes: notes?.trim() || purpose?.trim() || null,
    });

    return NextResponse.json(reservation, { status: 201 });
  } catch (err: unknown) {
    // Business rejections from the data layer (overlap → 409, invalid/past timeframe,
    // unavailable equipment, notes too long → 400, unknown equipment → 404) keep their
    // message; anything else is logged and reported generically.
    return toErrorResponse(err, "Failed to create reservation.");
  }
}
