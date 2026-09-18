import { auth } from "@/lib/auth";
import { nfcReturn, getAllEquipment, getEquipmentById, getNfcCardByValue } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const NfcReturnSchema = z.object({
  equipment_id: z.number().int().positive().optional(),
  equipment_ids: z.array(z.number().int().positive()).max(50, "Batch return is limited to 50 items").optional(),
  barcode: z.string().trim().max(100).optional(),
  nfc_value: z.string().trim().max(100).optional(),
  nfc_id: z.string().trim().max(100).optional(),
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
  const isAdmin = session.user.role === "admin";
  const callerName = (session.user.name || "").trim().toLowerCase();
  const callerId = Number(session.user.id);

  let card: Awaited<ReturnType<typeof getNfcCardByValue>> = undefined;
  if (cardValue) {
    card = await getNfcCardByValue(cardValue);
    if (!card) {
      return NextResponse.json({ error: `NFC card "${cardValue}" not found in database` }, { status: 404 });
    }
  }

  // Handle batch return
  if (equipment_ids && equipment_ids.length > 0) {
    for (const eqId of equipment_ids) {
      const eq = await getEquipmentById(eqId);
      if (eq && eq.active_checkout) {
        if (card) {
          const isSameCard =
            (eq.active_checkout.nfc_value && eq.active_checkout.nfc_value.toLowerCase() === cardValue.toLowerCase()) ||
            (eq.active_checkout.nfc_id && eq.active_checkout.nfc_id.toLowerCase() === cardValue.toLowerCase());

          if (!isSameCard && eq.active_checkout.checked_out_by_name !== card.member_name) {
            return NextResponse.json(
              { error: `"${eq.name}" is checked out to ${eq.active_checkout.checked_out_by_name}, not this NFC card.` },
              { status: 409 }
            );
          }
        } else if (!isAdmin) {
          const checkedOutName = (eq.active_checkout.checked_out_by_name || "").trim().toLowerCase();
          const checkedOutById = eq.active_checkout.checked_out_by;
          const isBorrower =
            (checkedOutById !== null && callerId === checkedOutById) ||
            (callerName.length > 0 && callerName === checkedOutName);

          if (!isBorrower) {
            return NextResponse.json(
              { error: `Forbidden: "${eq.name}" is checked out to ${eq.active_checkout.checked_out_by_name}. Only the borrower or an Admin can return it.` },
              { status: 403 }
            );
          }
        }
      }
    }

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

  // Verify authorization for single item return
  if (card) {
    const isSameCard =
      (equipment.active_checkout.nfc_value && equipment.active_checkout.nfc_value.toLowerCase() === cardValue.toLowerCase()) ||
      (equipment.active_checkout.nfc_id && equipment.active_checkout.nfc_id.toLowerCase() === cardValue.toLowerCase());

    if (!isSameCard && equipment.active_checkout.checked_out_by_name !== card.member_name) {
      return NextResponse.json({
        error: `This equipment is checked out to ${equipment.active_checkout.checked_out_by_name}, not this NFC card.`,
      }, { status: 409 });
    }
  } else if (!isAdmin) {
    const checkedOutName = (equipment.active_checkout.checked_out_by_name || "").trim().toLowerCase();
    const checkedOutById = equipment.active_checkout.checked_out_by;
    const isBorrower =
      (checkedOutById !== null && callerId === checkedOutById) ||
      (callerName.length > 0 && callerName === checkedOutName);

    if (!isBorrower) {
      return NextResponse.json({
        error: `Forbidden: This equipment is checked out to ${equipment.active_checkout.checked_out_by_name}. Only the borrower or an Admin can return it.`,
      }, { status: 403 });
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
