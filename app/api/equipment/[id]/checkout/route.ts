import { auth } from "@/lib/auth";
import { createCheckout, getEquipmentById, getUserByEmail } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const CheckoutSchema = z.object({
  checked_out_by_name: z.string().min(1),
  expected_return_at: z.string().optional(),
  notes: z.string().min(1),
  checkout_location: z.string().optional(),
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
  const equipment = await getEquipmentById(Number(id));
  if (!equipment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (equipment.status !== "Available") {
    return NextResponse.json(
      { error: `Equipment is not available (current status: ${equipment.status})` },
      { status: 409 }
    );
  }

  const body = await req.json();
  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const dbUser = session.user.email ? await getUserByEmail(session.user.email) : null;
    const checkout = await createCheckout({
      equipment_id: Number(id),
      checked_out_by: dbUser?.id ?? null,
      checked_out_by_name: parsed.data.checked_out_by_name,
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
