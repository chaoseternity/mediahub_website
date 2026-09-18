import { auth } from "@/lib/auth";
import { createCheckout, getEquipmentById, getUserByEmail } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CheckoutSchema = z.object({
  checked_out_by_name: z.string().trim().min(1).max(100),
  expected_return_at: z
    .string()
    .max(100)
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), { message: "Invalid date format" }),
  notes: z.string().trim().min(1).max(500),
  checkout_location: z.string().trim().max(200).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const eqId = Number(id);
  if (!Number.isInteger(eqId) || eqId <= 0) {
    return NextResponse.json({ error: "Invalid equipment ID" }, { status: 400 });
  }

  const equipment = await getEquipmentById(eqId);
  if (!equipment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (equipment.status?.toLowerCase() !== "available") {
    return NextResponse.json(
      { error: `Equipment is not available (current status: ${equipment.status})` },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const dbUser = session.user.email ? await getUserByEmail(session.user.email) : null;
    const isAdmin = session.user.role === "admin" || dbUser?.role === "admin";
    const finalCheckedOutByName =
      isAdmin && parsed.data.checked_out_by_name?.trim()
        ? parsed.data.checked_out_by_name.trim()
        : session.user.name || dbUser?.name || "Member";

    const checkout = await createCheckout({
      equipment_id: Number(id),
      checked_out_by: dbUser?.id ?? null,
      checked_out_by_name: finalCheckedOutByName,
      expected_return_at: parsed.data.expected_return_at,
      notes: parsed.data.notes,
      checkout_location: parsed.data.checkout_location,
    });
    return NextResponse.json(checkout, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
