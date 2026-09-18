import { auth } from "@/lib/auth";
import { nfcCheckout, getAllEquipment, getEquipmentById, getNfcCardByValue } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const NfcCheckoutSchema = z.object({
  nfc_value: z.string().min(1).optional(),
  nfc_id: z.string().min(1).optional(),
  equipment_id: z.number().int().positive().optional(),
  equipment_ids: z.array(z.number().int().positive()).max(50, "Batch checkout is limited to 50 items").optional(),
  barcode: z.string().trim().max(200).optional(),
  notes: z.string().max(500).optional(),
  checkout_location: z.string().max(200).optional(),
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
  const parsed = NfcCheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const cardValue = (parsed.data.nfc_value || parsed.data.nfc_id || "").trim();
  if (!cardValue) {
    return NextResponse.json({ error: "nfc_value is required" }, { status: 400 });
  }

  const card = await getNfcCardByValue(cardValue);
  if (!card) {
    return NextResponse.json({ error: `NFC card "${cardValue}" not found in database` }, { status: 404 });
  }

  const { barcode, notes, checkout_location, equipment_ids } = parsed.data;

  // Handle batch checkout
  if (equipment_ids && equipment_ids.length > 0) {
    const checkouts = [];
    for (const eqId of equipment_ids) {
      const equipment = await getEquipmentById(eqId);
      if (!equipment) {
        return NextResponse.json({ error: `Equipment ID ${eqId} not found` }, { status: 404 });
      }
      if (equipment.status !== "Available") {
        return NextResponse.json(
          { error: `"${equipment.name}" is not available (Status: ${equipment.status})` },
          { status: 409 }
        );
      }
      const c = await nfcCheckout({
        equipmentId: eqId,
        nfcValue: cardValue,
        notes: notes || "Checked out via NFC Station",
        checkout_location,
      });
      checkouts.push(c);
    }
    return NextResponse.json({ success: true, count: checkouts.length, checkouts }, { status: 201 });
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

  // Check if this equipment is already checked out under THIS NFC card
  const activeCheckout = equipment.active_checkout;
  if (activeCheckout) {
    const isSameCard =
      (activeCheckout.nfc_value && activeCheckout.nfc_value.toLowerCase() === cardValue.toLowerCase()) ||
      (activeCheckout.nfc_id && activeCheckout.nfc_id.toLowerCase() === cardValue.toLowerCase());

    if (isSameCard) {
      return NextResponse.json(
        {
          error: "Equipment is already checked out to this NFC card.",
          alreadyCheckedOutByMember: true,
          equipment_id: equipment.id,
          equipment_name: equipment.name,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: `Equipment is currently checked out to ${activeCheckout.checked_out_by_name || "another member"}`,
      },
      { status: 409 }
    );
  }

  if (equipment.status !== "Available") {
    return NextResponse.json(
      { error: `Equipment is not available (Status: ${equipment.status})` },
      { status: 409 }
    );
  }

  try {
    const checkout = await nfcCheckout({
      equipmentId: equipment.id,
      nfcValue: cardValue,
      notes: notes || "Checked out via NFC Station",
      checkout_location,
    });
    return NextResponse.json({ success: true, checkout, equipment }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
