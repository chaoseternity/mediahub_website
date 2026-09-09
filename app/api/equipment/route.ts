import { auth } from "@/lib/auth";
import { getAllEquipment, createEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CreateEquipmentSchema = z.object({
  name: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1, "At least one tag is required"),
  description: z.string().optional(),
  serial_number: z.string().optional(),
  condition: z.enum(["New", "Good", "Fair", "Poor"]).default("Good"),
  location: z.string().min(1),
  status: z
    .enum(["Available", "Checked Out", "Under Maintenance", "Retired"])
    .default("Available"),
});

export async function GET() {
  const equipment = await getAllEquipment();
  return NextResponse.json(equipment);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = CreateEquipmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const item = await createEquipment(parsed.data);
  return NextResponse.json(item, { status: 201 });
}
