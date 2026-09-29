import { auth } from "@/lib/auth";
import {
  nfcReturn,
  getAllEquipment,
  getEquipmentById,
  getNfcCardByValue,
  getUserByEmail,
  normalizeOccurredAt,
  assertCardMember,
  findReplayedNfcReturn,
} from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { validationErrorResponse } from "@/lib/api-errors";
import { z } from "zod";
import { nfcErrorResponse } from "../errors";

const NfcReturnSchema = z.object({
  equipment_id: z.number().int().positive().optional(),
  equipment_ids: z.array(z.number().int().positive()).max(50, "Batch return is limited to 50 items").optional(),
  barcode: z.string().trim().max(100).optional(),
  nfc_value: z.string().trim().max(100).optional(),
  nfc_id: z.string().trim().max(100).optional(),
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

  const parsed = NfcReturnSchema.safeParse(body);
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
    return nfcErrorResponse(err, "Return failed");
  }

  try {
    const { barcode, equipment_ids } = parsed.data;
    const cardValue = (parsed.data.nfc_value || parsed.data.nfc_id || "").trim();
    const dbUser = session.user?.email ? await getUserByEmail(session.user.email) : null;
    const isAdmin = session.user.role === "admin" || dbUser?.role === "admin";
    const callerId = dbUser?.id ?? Number(session.user.id);

    let card: Awaited<ReturnType<typeof getNfcCardByValue>> = undefined;
    if (cardValue) {
      card = await getNfcCardByValue(cardValue);
      if (!card) {
        return NextResponse.json({ error: `NFC card "${cardValue}" not found in database` }, { status: 404 });
      }
      // Offline replay: refuse if the card has been reassigned since the action was queued.
      assertCardMember(card, parsed.data.expected_member_name);
    }

    // Replay idempotency: this card already returned the item at the original time.
    const findPriorReturn = (eqId: number) =>
      occurredAt && card ? findReplayedNfcReturn(eqId, cardValue, occurredAt) : Promise.resolve(undefined);

    // Handle batch return: validate every item first so a rejection changes nothing.
    if (equipment_ids && equipment_ids.length > 0) {
      const uniqueEqIds = Array.from(new Set(equipment_ids));
      const toReturn: number[] = [];
      const alreadyApplied = [];
      for (const eqId of uniqueEqIds) {
        const eq = await getEquipmentById(eqId);
        if (!eq) {
          return NextResponse.json({ error: `Equipment ID ${eqId} not found` }, { status: 404 });
        }
        const prior = await findPriorReturn(eqId);
        if (prior) {
          alreadyApplied.push(prior);
          continue;
        }
        if (!eq.active_checkout) {
          return NextResponse.json(
            { error: `"${eq.name}" is not currently checked out.` },
            { status: 409 }
          );
        }
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
          const checkedOutById = eq.active_checkout.checked_out_by;
          const isBorrower =
            checkedOutById !== null && Number.isInteger(callerId) && callerId === checkedOutById;

          if (!isBorrower) {
            return NextResponse.json(
              { error: `Forbidden: "${eq.name}" is checked out to ${eq.active_checkout.checked_out_by_name}. Only the borrower or an Admin can return it.` },
              { status: 403 }
            );
          }
        }
        toReturn.push(eqId);
      }

      const checkouts = [...alreadyApplied];
      for (const eqId of toReturn) {
        const c = await nfcReturn(eqId, { occurredAt, nfcValue: cardValue || null });
        checkouts.push(c);
      }
      return NextResponse.json(
        withActionId({
          success: true,
          count: checkouts.length,
          checkouts,
          ...(alreadyApplied.length > 0 ? { already_applied: alreadyApplied.length } : {}),
        })
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

    const prior = await findPriorReturn(equipment.id);
    if (prior) {
      return NextResponse.json(
        withActionId({ success: true, checkout: prior, equipment, already_applied: 1 })
      );
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
      const checkedOutById = equipment.active_checkout.checked_out_by;
      const isBorrower =
        checkedOutById !== null && Number.isInteger(callerId) && callerId === checkedOutById;

      if (!isBorrower) {
        return NextResponse.json({
          error: `Forbidden: This equipment is checked out to ${equipment.active_checkout.checked_out_by_name}. Only the borrower or an Admin can return it.`,
        }, { status: 403 });
      }
    }

    const checkout = await nfcReturn(equipment.id, { occurredAt, nfcValue: cardValue || null });
    return NextResponse.json(withActionId({ success: true, checkout, equipment }));
  } catch (err: unknown) {
    return nfcErrorResponse(err, "Return failed");
  }
}
