import { auth } from "@/lib/auth";
import { getStorageMapData } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cabinets = await getStorageMapData();
  return NextResponse.json(cabinets);
}
