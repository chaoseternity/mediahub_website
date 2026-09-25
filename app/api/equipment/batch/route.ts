import { auth } from "@/lib/auth";
import { batchUpsertEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const BatchItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  serial_number: z.string().trim().max(100).nullable().optional(),
  tags: z.array(z.string().trim().max(50)).max(20).default([]),
  description: z.string().trim().max(2000).nullable().optional(),
  condition: z.enum(["Working", "Impaired", "Broken", "Missing", "Retired"]).default("Working"),
  location: z.string().trim().max(200).default("Media Room"),
});

const BatchPayloadSchema = z.object({
  items: z.array(BatchItemSchema).min(1, "At least one item is required").max(500, "Batch limit is 500 items"),
  deleteMissingIds: z.array(z.number().int().positive()).max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden. Admin role required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BatchPayloadSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return NextResponse.json({ error: `Validation error: ${issues}` }, { status: 400 });
  }

  try {

    const result = await batchUpsertEquipment(parsed.data.items, parsed.data.deleteMissingIds);
    return NextResponse.json({
      success: true,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      deletedCount: result.deletedCount,
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
