import { auth } from "@/lib/auth";
import { returnCheckout, getEquipmentById } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _req: NextRequest,
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

  try {
    const checkout = await returnCheckout(Number(id));
    return NextResponse.json(checkout);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Return failed";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
