import { auth } from "@/lib/auth";
import { extractTextFromDocument } from "@/lib/doc-parser";
import { NextRequest, NextResponse } from "next/server";
import { declaredContentLength, errorResponse, isUploadedFile } from "@/lib/api-errors";
import { checkUploadFormat, extractionErrorMessage } from "../upload-format";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Multipart framing + field headers on top of the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admins only" }, { status: 403 });
  }

  // Reject oversized bodies before buffering them into memory.
  const contentLength = declaredContentLength(req);
  if (contentLength !== null && contentLength > MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return errorResponse(413, "File size exceeds the 10MB limit.");
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse(400, "Expected a multipart/form-data upload with a \"file\" field.");
  }

  const file = formData.get("file");
  if (!file) {
    return errorResponse(400, "No file provided");
  }
  if (!isUploadedFile(file)) {
    return errorResponse(400, "The \"file\" field must be an uploaded file.");
  }

  if (file.size > MAX_FILE_BYTES) {
    return errorResponse(413, "File size exceeds the 10MB limit.");
  }

  const fileName = (file.name || "document.txt").slice(0, 255);
  const fileType = (file.type || "").slice(0, 100);

  const format = checkUploadFormat(fileName, fileType);
  if (!format.ok) {
    return errorResponse(format.status, format.error);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const content = await extractTextFromDocument(buffer, fileName, fileType);
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    return NextResponse.json({
      content,
      wordCount,
      fileName,
      fileSize: file.size,
    });
  } catch (err: unknown) {
    // Parser errors can contain library internals — only known user-facing messages pass
    // through; anything else is logged and replaced by a generic message.
    return errorResponse(422, extractionErrorMessage(err));
  }
}
