import { auth } from "@/lib/auth";
import { getStorageMapData, getStorageMapConfig, saveStorageMapConfig, updateEquipment } from "@/lib/db";
import type { StorageMapConfigCabinet } from "@/lib/types";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [cabinets, config] = await Promise.all([
    getStorageMapData(),
    getStorageMapConfig(),
  ]);

  return NextResponse.json({
    cabinets,
    config,
    isAdmin: session.user.role === "admin",
  });
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

  try {
    const body = await req.json();

    if (body.action === "move_item") {
      const equipmentId = Number(body.equipment_id);
      const cabinet = String(body.cabinet || "").trim();
      const shelf = String(body.shelf || "").trim();

      if (!equipmentId || !cabinet || !shelf) {
        return NextResponse.json(
          { error: "Missing required fields: equipment_id, cabinet, shelf" },
          { status: 400 }
        );
      }

      const newLocation = `${cabinet} - ${shelf}`;
      const updated = await updateEquipment(equipmentId, { location: newLocation });
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

    if (body.action === "save_config") {
      const cabinets = body.cabinets as StorageMapConfigCabinet[];
      if (!Array.isArray(cabinets)) {
        return NextResponse.json({ error: "Invalid cabinets configuration array" }, { status: 400 });
      }

      await saveStorageMapConfig(cabinets);
      const freshCabinets = await getStorageMapData();
      return NextResponse.json({
        success: true,
        cabinets: freshCabinets,
      });
    }

    if (body.action === "reset_config") {
      await saveStorageMapConfig([]);
      const freshCabinets = await getStorageMapData();
      return NextResponse.json({
        success: true,
        cabinets: freshCabinets,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to process storage map action" }, { status: 500 });
  }
}
