import { auth } from "@/lib/auth";
import { getEquipmentById, updateEquipment, deleteEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, toErrorResponse, validationErrorResponse } from "@/lib/api-errors";
import { z } from "zod";

/** Statuses an admin may set directly. */
const MANUAL_EQUIPMENT_STATUSES = [
  "Available",
  "Unavailable (In Repairs)",
  "Unavailable (Broken)",
  "Unavailable (Missing)",
  "Unavailable (Retired)",
] as const;

/** Verified (non-admin) members may only edit the description. */
const VerifiedUpdateSchema = z.object({
  description: z.string({ error: "description must be a string" }).trim().max(2000).optional(),
});

const UpdateEquipmentSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  description: z.string().trim().max(2000).optional(),
  serial_number: z.string().trim().max(100).optional(),
  condition: z.enum(["Working", "Impaired", "Broken", "Missing", "Retired"]).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  // "Checked Out" / "In Event" / "In Event (Rehearsal)" are derived from checkouts and event
  // allocations; setting them by hand would leave an item that can never be returned.
  status: z
    .enum(MANUAL_EQUIPMENT_STATUSES, {
      error: `status must be one of: ${MANUAL_EQUIPMENT_STATUSES.join(", ")}`,
    })
    .optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const eqId = Number(id);
  if (!Number.isInteger(eqId) || eqId <= 0) {
    return NextResponse.json({ error: "Invalid equipment ID" }, { status: 400 });
  }

  try {
    const item = await getEquipmentById(eqId);
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(item);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to load equipment");
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role } = session.user;
  if (role !== "admin" && role !== "verified") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const eqId = Number(id);
  if (!Number.isInteger(eqId) || eqId <= 0) {
    return NextResponse.json({ error: "Invalid equipment ID" }, { status: 400 });
  }

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  let update: z.infer<typeof UpdateEquipmentSchema>;
  if (role === "verified") {
    // Verified users may only update the description field; other keys are ignored.
    const raw = body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as { description?: unknown }).description
      : undefined;
    const parsed = VerifiedUpdateSchema.safeParse({ description: raw });
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }
    update = parsed.data;
  } else {
    const parsed = UpdateEquipmentSchema.safeParse(body.data);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }
    update = parsed.data;
  }

  try {
    const updated = await updateEquipment(eqId, update);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to update equipment");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const eqId = Number(id);
  if (!Number.isInteger(eqId) || eqId <= 0) {
    return NextResponse.json({ error: "Invalid equipment ID" }, { status: 400 });
  }

  try {
    const result = await deleteEquipment(eqId);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "Equipment not found." ? 404 : 409 }
      );
    }
    if (result.retired) {
      // Items with checkout/reservation/audit/event history are retired instead of deleted
      // so that history is preserved.
      return NextResponse.json({
        success: true,
        retired: true,
        message: "This equipment has usage history, so it was retired instead of deleted.",
      });
    }
    return NextResponse.json({ success: true, retired: false });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to delete equipment");
  }
}
