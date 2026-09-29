import { auth } from "@/lib/auth";
import { getAllEquipment, createEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse, validationErrorResponse } from "@/lib/api-errors";
import { z } from "zod";

/** Statuses an admin may set directly. */
const MANUAL_EQUIPMENT_STATUSES = [
  "Available",
  "Unavailable (In Repairs)",
  "Unavailable (Broken)",
  "Unavailable (Missing)",
  "Unavailable (Retired)",
] as const;

const CreateEquipmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  tags: z.array(z.string().trim().min(1).max(50)).min(1, "At least one tag is required").max(20),
  description: z.string().trim().max(2000).optional(),
  serial_number: z.string().trim().max(100).optional(),
  condition: z.enum(["Working", "Impaired", "Broken", "Missing", "Retired"]).default("Working"),
  location: z.string().trim().min(1).max(200),
  // "Checked Out" / "In Event" statuses are derived from checkouts and event allocations and
  // can't be set by hand (an item marked checked out with no checkout could never be returned).
  status: z
    .enum(MANUAL_EQUIPMENT_STATUSES, {
      error: `status must be one of: ${MANUAL_EQUIPMENT_STATUSES.join(", ")}`,
    })
    .default("Available"),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const equipment = await getAllEquipment();
    return NextResponse.json(equipment);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to load equipment");
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateEquipmentSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const item = await createEquipment(parsed.data);
    return NextResponse.json(item, { status: 201 });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to create equipment");
  }
}
