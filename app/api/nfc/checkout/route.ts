import { auth } from "@/lib/auth";
import { nfcCheckout, getAllEquipment, getEquipmentById, getUserByNfcId } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const NfcCheckoutSchema = z.object({
  nfc_id: z.string().min(1),
  equipment_id: z.number().int().positive().optional(),
  barcode: z.string().trim().optional(),
  notes: z.string().optional(),
  checkout_location: z.string().optional(),
});

function findEquipmentByBarcode(equipmentList: Awaited<ReturnType<typeof getAllEquipment>>, rawCode: string) {
  const code = rawCode.trim().toLowerCase();
  if (!code) return undefined;

  // 1. By serial number
  const bySerial = equipmentList.find(
    (e) => e.serial_number && e.serial_number.toLowerCase() === code
  );
  if (bySerial) return bySerial;

  // 2. By name
  const byName = equipmentList.find((e) => e.name.toLowerCase() === code);
  if (byName) return byName;

  // 3. By DB ID
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

  const { nfc_id, barcode, notes, checkout_location } = parsed.data;
  let equipmentId = parsed.data.equipment_id;

  if (!equipmentId && !barcode) {
    return NextResponse.json({ error: "Either equipment_id or barcode is required" }, { status: 400 });
  }

  const member = await getUserByNfcId(nfc_id);
  if (!member) {
    return NextResponse.json({ error: "Member not found for this NFC card" }, { status: 404 });
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

  // Check if this equipment is already checked out by THIS member
  const activeCheckout = equipment.active_checkout;
  if (activeCheckout) {
    const isSameMember = activeCheckout.checked_out_by === member.id;
    if (isSameMember) {
      return NextResponse.json(
        {
          error: "Equipment is already checked out to this member.",
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
      nfcId: nfc_id,
      notes: notes || "Checked out via NFC Station",
      checkout_location,
    });
    return NextResponse.json({ success: true, checkout, equipment }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
