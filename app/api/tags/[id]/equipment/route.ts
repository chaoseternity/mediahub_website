import { auth } from "@/lib/auth";
import { getEquipmentByTagId, addTagToEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const equipment = await getEquipmentByTagId(Number(id));
  return NextResponse.json(equipment);
}

const AddEquipmentSchema = z.object({ equipmentId: z.number().int().positive() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const parsed = AddEquipmentSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const result = await addTagToEquipment(parsed.data.equipmentId, Number(id));
  if (!result.success)
    return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ success: true });
}
