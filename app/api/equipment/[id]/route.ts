import { auth } from "@/lib/auth";
import { getEquipmentById, updateEquipment, deleteEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateEquipmentSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  description: z.string().trim().max(2000).optional(),
  serial_number: z.string().trim().max(100).optional(),
  condition: z.enum(["Working", "Impaired", "Broken", "Missing", "Retired"]).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  status: z
    .enum(["Available", "Checked Out", "In Event", "In Event (Rehearsal)", "Unavailable (In Repairs)", "Unavailable (Broken)", "Unavailable (Missing)", "Unavailable (Retired)"])
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

  const item = await getEquipmentById(eqId);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(item);
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

  const body = await req.json();
  // Verified users may only update the description field
  const allowedBody = role === "verified" ? { description: body.description } : body;
  const parsed = UpdateEquipmentSchema.safeParse(allowedBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await updateEquipment(eqId, parsed.data);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
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

  const result = await deleteEquipment(eqId);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}
