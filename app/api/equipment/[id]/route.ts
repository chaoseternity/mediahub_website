import { auth } from "@/lib/auth";
import { getEquipmentById, updateEquipment, deleteEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateEquipmentSchema = z.object({
  name: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  description: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: z.string().optional(),
  condition: z.enum(["New", "Good", "Fair", "Poor"]).optional(),
  location: z.string().min(1).optional(),
  status: z
    .enum(["Available", "Checked Out", "In Event", "Under Maintenance", "Retired"])
    .optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = await getEquipmentById(Number(id));
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
  const body = await req.json();
  // Verified users may only update the description field
  const allowedBody = role === "verified" ? { description: body.description } : body;
  const parsed = UpdateEquipmentSchema.safeParse(allowedBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await updateEquipment(Number(id), parsed.data);
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
  const result = await deleteEquipment(Number(id));
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}
