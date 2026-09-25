import { auth } from "@/lib/auth";
import { getAllEquipment, createEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CreateEquipmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  tags: z.array(z.string().trim().min(1).max(50)).min(1, "At least one tag is required").max(20),
  description: z.string().trim().max(2000).optional(),
  serial_number: z.string().trim().max(100).optional(),
  condition: z.enum(["Working", "Impaired", "Broken", "Missing", "Retired"]).default("Working"),
  location: z.string().trim().min(1).max(200),
  status: z
    .enum(["Available", "Checked Out", "Unavailable (In Repairs)", "Unavailable (Broken)", "Unavailable (Missing)", "Unavailable (Retired)"])
    .default("Available"),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const equipment = await getAllEquipment();
  return NextResponse.json(equipment);
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
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {

    const item = await createEquipment(parsed.data);
    return NextResponse.json(item, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create equipment";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
