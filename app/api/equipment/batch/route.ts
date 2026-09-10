import { auth } from "@/lib/auth";
import { batchUpsertEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const BatchItemSchema = z.object({
  name: z.string().min(1),
  serial_number: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  description: z.string().nullable().optional(),
  condition: z.enum(["Working", "Impaired", "In repairs", "Broken"]).default("Working"),
  location: z.string().default("Media Room"),
});

const BatchPayloadSchema = z.object({
  items: z.array(BatchItemSchema).min(1, "At least one item is required"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden. Admin role required." }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = BatchPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = await batchUpsertEquipment(parsed.data.items);
    return NextResponse.json({
      success: true,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      errors: result.errors,
    });
  } catch (err) {
    console.error("Batch upsert error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
