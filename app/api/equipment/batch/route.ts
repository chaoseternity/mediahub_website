import { auth } from "@/lib/auth";
import { batchUpsertEquipment } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { isInternalErrorMessage, toErrorResponse } from "@/lib/api-errors";

const INTERNAL_ITEM_ERROR = "Unexpected database error while processing this item.";
import { z } from "zod";

const BatchItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  serial_number: z.string().trim().max(100).nullable().optional(),
  tags: z.array(z.string().trim().max(50)).max(20).default([]),
  description: z.string().trim().max(2000).nullable().optional(),
  condition: z.enum(["Working", "Impaired", "Broken", "Missing", "Retired"]).default("Working"),
  location: z.string().trim().max(200).default("Media Room"),
});

/**
 * Result of batchUpsertEquipment. `failed`/`failedCount` are optional here so this route works
 * both before and after the data layer started reporting per-item failures.
 */
type BatchResult = Awaited<ReturnType<typeof batchUpsertEquipment>> & {
  failed?: unknown[];
  failedCount?: number;
  notices?: string[];
  partial?: boolean;
};

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
    const result: BatchResult = await batchUpsertEquipment(parsed.data.items, parsed.data.deleteMissingIds);
    // Per-item failure messages may wrap raw database errors — mask those (and log them).
    const failed = (Array.isArray(result.failed) ? result.failed : []).map((f) => {
      if (f && typeof f === "object" && typeof (f as { error?: unknown }).error === "string") {
        const error = (f as { error: string }).error;
        if (isInternalErrorMessage(error)) {
          console.error("[api] batch import item failed:", error);
          return { ...(f as object), error: INTERNAL_ITEM_ERROR };
        }
      }
      return f;
    });
    const failedCount = typeof result.failedCount === "number" ? result.failedCount : failed.length;
    const partial = typeof result.partial === "boolean" ? result.partial : failedCount > 0;

    // Response contract (always HTTP 200 once the request itself was valid):
    //   success: !partial, partial: boolean (true when any item or deletion failed),
    //   createdCount, updatedCount, failedCount, failed[], deletedCount, retiredCount,
    //   notices[] (informational), errors[] (failures followed by notices, legacy)
    // The client uploads in chunks of <= 500 items and sends deleteMissingIds only with the
    // final chunk, then sums the counts across chunks.
    return NextResponse.json({
      success: !partial,
      partial,
      createdCount: result.createdCount ?? 0,
      updatedCount: result.updatedCount ?? 0,
      failedCount,
      failed,
      deletedCount: result.deletedCount ?? 0,
      retiredCount: result.retiredCount ?? 0,
      notices: Array.isArray(result.notices) ? result.notices : [],
      errors: (Array.isArray(result.errors) ? result.errors : []).map((e) => {
        if (typeof e !== "string" || !isInternalErrorMessage(e)) return e;
        const prefix = /^(Error processing "[^"]{0,200}"|Could not delete [^:]{0,200}):/.exec(e)?.[1];
        return prefix ? `${prefix}: ${INTERNAL_ITEM_ERROR}` : INTERNAL_ITEM_ERROR;
      }),
    });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to import equipment batch");
  }
}
