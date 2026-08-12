import { auth } from "@/lib/auth";
import { deleteTag, getAllTags } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tags = await getAllTags();
  const tag = tags.find((t) => t.id === Number(id));
  if (!tag) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(tag);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const result = await deleteTag(Number(id));
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}
