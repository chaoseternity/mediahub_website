import { auth } from "@/lib/auth";
import { getEquipmentByTagId, addTagToEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const tagId = Number(id);
  if (!Number.isInteger(tagId) || tagId <= 0) {
    return NextResponse.json({ error: "Invalid tag ID" }, { status: 400 });
  }
  const equipment = await getEquipmentByTagId(tagId);
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
  const tagId = Number(id);
  if (!Number.isInteger(tagId) || tagId <= 0) {
    return NextResponse.json({ error: "Invalid tag ID" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = AddEquipmentSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {

    const result = await addTagToEquipment(parsed.data.equipmentId, tagId);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: result.error?.includes("not found") ? 404 : 409 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to add tag to equipment";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
