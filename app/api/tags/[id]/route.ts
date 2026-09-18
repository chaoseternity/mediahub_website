import { auth } from "@/lib/auth";
import { deleteTag, getAllTags } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const tagId = Number(id);
  if (!Number.isInteger(tagId) || tagId <= 0) {
    return NextResponse.json({ error: "Invalid tag ID" }, { status: 400 });
  }

  const tags = await getAllTags();
  const tag = tags.find((t) => t.id === tagId);
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
  const tagId = Number(id);
  if (!Number.isInteger(tagId) || tagId <= 0) {
    return NextResponse.json({ error: "Invalid tag ID" }, { status: 400 });
  }

  const result = await deleteTag(tagId);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "Tag not found." ? 404 : 409 }
    );
  }
  return NextResponse.json({ success: true });
}
