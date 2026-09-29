import { auth } from "@/lib/auth";
import { getStorageMapData, getStorageMapConfig, saveStorageMapConfig, updateEquipment } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJsonBody, toErrorResponse, zodErrorMessage } from "@/lib/api-errors";

const MAX_CABINETS = 50;
const MAX_SHELVES_PER_CABINET = 50;
const MAX_NAME_LENGTH = 100;
/** equipment.location is limited to 200 characters; a location is "<cabinet> - <shelf>". */
const MAX_LOCATION_LENGTH = 200;

const nameString = (label: string) =>
  z
    .string({ error: `${label} must be a string` })
    .trim()
    .min(1, `${label} is required`)
    .max(MAX_NAME_LENGTH, `${label} cannot exceed ${MAX_NAME_LENGTH} characters`);

const MoveItemSchema = z
  .object({
    action: z.literal("move_item"),
    equipment_id: z.union(
      [
        z.number().int().positive(),
        z
          .string()
          .trim()
          .regex(/^[1-9]\d{0,15}$/)
          .transform(Number),
      ],
      { error: "equipment_id must be a positive integer" }
    ),
    cabinet: nameString("cabinet"),
    shelf: nameString("shelf"),
  })
  .refine((d) => `${d.cabinet} - ${d.shelf}`.length <= MAX_LOCATION_LENGTH, {
    message: `Combined cabinet and shelf name cannot exceed ${MAX_LOCATION_LENGTH - 3} characters`,
    path: ["shelf"],
  });

const CabinetConfigSchema = z.object({
  id: z
    .string({ error: "cabinet id must be a string" })
    .trim()
    .min(1, "cabinet id is required")
    .max(MAX_NAME_LENGTH, `cabinet id cannot exceed ${MAX_NAME_LENGTH} characters`),
  name: nameString("cabinet name"),
  description: z
    .string({ error: "cabinet description must be a string" })
    .trim()
    .max(500, "cabinet description cannot exceed 500 characters")
    .optional(),
  shelves: z
    .array(nameString("shelf name"), { error: "shelves must be an array of names" })
    .max(MAX_SHELVES_PER_CABINET, `A cabinet cannot have more than ${MAX_SHELVES_PER_CABINET} shelves`),
});

const SaveConfigSchema = z.object({
  action: z.literal("save_config"),
  cabinets: z
    .array(CabinetConfigSchema, { error: "Invalid cabinets configuration array" })
    .max(MAX_CABINETS, `Layout cannot have more than ${MAX_CABINETS} cabinets`),
});

const ResetConfigSchema = z.object({ action: z.literal("reset_config") });

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [cabinets, config] = await Promise.all([getStorageMapData(), getStorageMapConfig()]);

    return NextResponse.json({
      cabinets,
      config,
      isAdmin: session.user.role === "admin",
    });
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to load storage map");
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden: Only administrators can modify storage layout and assignments." },
      { status: 403 }
    );
  }

  const body = await readJsonBody(req);
  if (!body.ok) return body.response;

  const action =
    body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as { action?: unknown }).action
      : undefined;

  try {
    if (action === "move_item") {
      const parsed = MoveItemSchema.safeParse(body.data);
      if (!parsed.success) return errorResponse(400, zodErrorMessage(parsed.error));
      const { equipment_id, cabinet, shelf } = parsed.data;

      const newLocation = `${cabinet} - ${shelf}`;
      const updated = await updateEquipment(equipment_id, { location: newLocation });
      if (!updated) {
        return NextResponse.json({ error: "Equipment not found or update failed" }, { status: 404 });
      }

      const freshCabinets = await getStorageMapData();
      return NextResponse.json({
        success: true,
        location: newLocation,
        cabinets: freshCabinets,
      });
    }

    if (action === "save_config") {
      const parsed = SaveConfigSchema.safeParse(body.data);
      if (!parsed.success) return errorResponse(400, zodErrorMessage(parsed.error));

      await saveStorageMapConfig(parsed.data.cabinets);
      const freshCabinets = await getStorageMapData();
      return NextResponse.json({
        success: true,
        cabinets: freshCabinets,
      });
    }

    if (action === "reset_config") {
      const parsed = ResetConfigSchema.safeParse(body.data);
      if (!parsed.success) return errorResponse(400, zodErrorMessage(parsed.error));

      await saveStorageMapConfig([]);
      const freshCabinets = await getStorageMapData();
      return NextResponse.json({
        success: true,
        cabinets: freshCabinets,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    // saveStorageMapConfig throws a clear message for structurally invalid layouts (→ 400);
    // anything unexpected is logged and reported generically.
    return toErrorResponse(err, "Failed to process storage map action");
  }
}
