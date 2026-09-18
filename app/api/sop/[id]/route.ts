import { auth } from "@/lib/auth";
import { getSOPDocumentById, updateSOPDocument, deleteSOPDocument } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateSOPSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(100).optional(),
  content: z.string().trim().min(1).max(500000).optional(),
  file_name: z.string().trim().max(255).nullable().optional(),
  file_type: z.string().trim().max(100).nullable().optional(),
  file_size: z.number().max(10 * 1024 * 1024).nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
  }
  const doc = await getSOPDocumentById(docId);
  if (!doc) return NextResponse.json({ error: "SOP Document not found" }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admins only" }, { status: 403 });
  }

  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateSOPSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await updateSOPDocument(docId, parsed.data);
    if (!updated) return NextResponse.json({ error: "SOP Document not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update SOP document";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admins only" }, { status: 403 });
  }

  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
  }

  const result = await deleteSOPDocument(docId);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "SOP Document not found." ? 404 : 409 }
    );
  }
  return NextResponse.json({ success: true });
}
