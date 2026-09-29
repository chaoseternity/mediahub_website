import { auth } from "@/lib/auth";
import {
  nfcCheckout,
  getAllEquipment,
  getEquipmentById,
  getNfcCardByValue,
  normalizeOccurredAt,
  assertCardMember,
  findReplayedNfcCheckout,
} from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { validationErrorResponse } from "@/lib/api-errors";
import { z } from "zod";
import { nfcErrorResponse } from "../errors";

const NfcCheckoutSchema = z.object({
  nfc_value: z.string().trim().min(1).max(100).optional(),
  nfc_id: z.string().trim().min(1).max(100).optional(),
  equipment_id: z.number().int().positive().optional(),
  equipment_ids: z.array(z.number().int().positive()).max(50, "Batch checkout is limited to 50 items").optional(),
  barcode: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
  checkout_location: z.string().trim().max(200).optional(),
  /** Original time of an offline action being replayed (ISO 8601). Absent = now. */
  occurred_at: z.string().trim().max(64).optional(),
  /** Member the card belonged to when the offline action was queued. */
  expected_member_name: z.string().trim().max(100).optional(),
  /** Station-generated id of the queued offline action (echoed back). */
  client_action_id: z.string().trim().max(100).optional(),
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = NfcCheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  const clientActionId = parsed.data.client_action_id;
  const withActionId = <T extends Record<string, unknown>>(payload: T) =>
    clientActionId ? { ...payload, client_action_id: clientActionId } : payload;

  // Validate the replayed action time before touching anything (invalid / too old -> 400,
  // slight future skew is clamped to now).
  let occurredAt: string | null;
  try {
    occurredAt = normalizeOccurredAt(parsed.data.occurred_at);
  } catch (err) {
    return nfcErrorResponse(err, "Checkout failed");
  }

  try {
    const cardValue = (parsed.data.nfc_value || parsed.data.nfc_id || "").trim();
    if (!cardValue) {
      return NextResponse.json({ error: "nfc_value is required" }, { status: 400 });
    }

    const card = await getNfcCardByValue(cardValue);
    if (!card) {
      return NextResponse.json({ error: `NFC card "${cardValue}" not found in database` }, { status: 404 });
    }
    // Offline replay: refuse if the card has been reassigned since the action was queued.
    assertCardMember(card, parsed.data.expected_member_name);

    const { barcode, notes, checkout_location, equipment_ids } = parsed.data;
    const expectedMemberName = parsed.data.expected_member_name;

    // Handle batch checkout
    if (equipment_ids && equipment_ids.length > 0) {
      const uniqueEqIds = Array.from(new Set(equipment_ids));
      const itemsToCheckout = [];
      const alreadyApplied = [];
      for (const eqId of uniqueEqIds) {
        const equipment = await getEquipmentById(eqId);
        if (!equipment) {
          return NextResponse.json({ error: `Equipment ID ${eqId} not found` }, { status: 404 });
        }
        if (occurredAt) {
          const prior = await findReplayedNfcCheckout(eqId, cardValue, occurredAt);
          if (prior) {
            alreadyApplied.push(prior);
            continue;
          }
        }
        if (equipment.status !== "Available") {
          return NextResponse.json(
            { error: `"${equipment.name}" is not available (Status: ${equipment.status})` },
            { status: 409 }
          );
        }
        itemsToCheckout.push(equipment);
      }

      const checkouts = [...alreadyApplied];
      for (const item of itemsToCheckout) {
        const c = await nfcCheckout({
          equipmentId: item.id,
          nfcValue: cardValue,
          notes: notes || "Checked out via NFC Station",
          checkout_location,
          occurredAt,
          expectedMemberName,
        });
        checkouts.push(c);
      }
      return NextResponse.json(
        withActionId({
          success: true,
          count: checkouts.length,
          checkouts,
          ...(alreadyApplied.length > 0 ? { already_applied: alreadyApplied.length } : {}),
        }),
        { status: alreadyApplied.length === checkouts.length ? 200 : 201 }
      );
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

    if (occurredAt) {
      const prior = await findReplayedNfcCheckout(equipment.id, cardValue, occurredAt);
      if (prior) {
        return NextResponse.json(
          withActionId({ success: true, checkout: prior, equipment, already_applied: 1 }),
          { status: 200 }
        );
      }
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

    const checkout = await nfcCheckout({
      equipmentId: equipment.id,
      nfcValue: cardValue,
      notes: notes || "Checked out via NFC Station",
      checkout_location,
      occurredAt,
      expectedMemberName,
    });
    return NextResponse.json(withActionId({ success: true, checkout, equipment }), { status: 201 });
  } catch (err: unknown) {
    return nfcErrorResponse(err, "Checkout failed");
  }
}
