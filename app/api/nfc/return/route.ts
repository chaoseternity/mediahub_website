import { auth } from "@/lib/auth";
import { nfcReturn, getAllEquipment, getEquipmentById, getNfcCardByValue } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const NfcReturnSchema = z.object({
  equipment_id: z.number().int().positive().optional(),
  equipment_ids: z.array(z.number().int().positive()).optional(),
  barcode: z.string().trim().optional(),
  nfc_value: z.string().trim().optional(),
  nfc_id: z.string().trim().optional(),
});

function findEquipmentByBarcode(equipmentList: Awaited<ReturnType<typeof getAllEquipment>>, rawCode: string) {
  const code = rawCode.trim().toLowerCase();
  if (!code) return undefined;

  const bySerial = equipmentList.find(
    (e) => e.serial_number && e.serial_number.toLowerCase() === code
  );
  if (bySerial) return bySerial;

  const byName = equipmentList.find((e) => e.name.toLowerCase() === code);
  if (byName) return byName;

  if (/^\d+$/.test(code)) {
    const numId = Number(code);
    const byId = equipmentList.find((e) => e.id === numId);
    if (byId) return byId;
  }

  return undefined;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = NfcReturnSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { barcode, equipment_ids } = parsed.data;
  const cardValue = (parsed.data.nfc_value || parsed.data.nfc_id || "").trim();

  // Handle batch return
  if (equipment_ids && equipment_ids.length > 0) {
    const checkouts = [];
    for (const eqId of equipment_ids) {
      const c = await nfcReturn(eqId);
      checkouts.push(c);
    }
    return NextResponse.json({ success: true, count: checkouts.length, checkouts });
  }

  let equipmentId = parsed.data.equipment_id;

  if (!equipmentId && !barcode) {
    return NextResponse.json({ error: "Either equipment_id, equipment_ids, or barcode is required" }, { status: 400 });
  }

  if (!equipmentId && barcode) {
    const allEq = await getAllEquipment();
    const found = findEquipmentByBarcode(allEq, barcode);
    if (!found) {
      return NextResponse.json({ error: `Equipment not found for code: "${barcode}"` }, { status: 404 });
    }
    equipmentId = found.id;
  }

  const equipment = await getEquipmentById(equipmentId!);
  if (!equipment) {
    return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
  }

  if (!equipment.active_checkout) {
    return NextResponse.json({ error: "This equipment is not currently checked out." }, { status: 409 });
  }

  // If nfc_value was provided, verify ownership or log warning
  if (cardValue) {
    const card = await getNfcCardByValue(cardValue);
    if (card) {
      const isSameCard =
        (equipment.active_checkout.nfc_value && equipment.active_checkout.nfc_value.toLowerCase() === cardValue.toLowerCase()) ||
        (equipment.active_checkout.nfc_id && equipment.active_checkout.nfc_id.toLowerCase() === cardValue.toLowerCase());

      if (!isSameCard && equipment.active_checkout.checked_out_by_name !== card.member_name) {
        return NextResponse.json({
          error: `This equipment is checked out to ${equipment.active_checkout.checked_out_by_name}, not this NFC card.`,
        }, { status: 409 });
      }
    }
  }

  try {
    const checkout = await nfcReturn(equipment.id);
    return NextResponse.json({ success: true, checkout, equipment });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Return failed";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
