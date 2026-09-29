import { auth } from "@/lib/auth";
import { getAllSOPDocuments, createSOPDocument, updateSOPDocument, getUserByEmail } from "@/lib/db";
import { extractTextFromDocument } from "@/lib/doc-parser";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { declaredContentLength, isUploadedFile, zodErrorMessage } from "@/lib/api-errors";
import { checkUploadFormat, extractionErrorMessage } from "./upload-format";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
/** The file plus the other form fields (a pre-extracted `content` field may be up to ~2MB). */
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 2 * 1024 * 1024;

const MultipartFieldsSchema = z.object({
  title: z
    .string({ error: "title must be a text field" })
    .max(1000, "Title cannot exceed 200 characters")
    .optional()
    .refine((v) => v === undefined || v.trim().length <= 200, "Title cannot exceed 200 characters"),
  category: z.string({ error: "category must be a text field" }).max(100, "Category cannot exceed 100 characters").optional(),
  content: z
    .string({ error: "content must be a text field" })
    .max(500000, "Content cannot exceed 500,000 characters")
    .optional(),
  overwrite_id: z.string({ error: "overwrite_id must be a text field" }).max(20).optional(),
});

const CreateSOPManualSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title cannot exceed 200 characters"),
  category: z.string().trim().max(100, "Category cannot exceed 100 characters").optional(),
  content: z.string().trim().min(1, "Content is required").max(500000, "Content cannot exceed 500,000 characters"),
  // Client-supplied metadata for pre-extracted uploads: type- and length-checked, never trusted
  // for anything beyond display.
  file_name: z
    .string()
    .trim()
    .max(255, "File name cannot exceed 255 characters")
    .refine((v) => !/[\\/]/.test(v) && !hasControlChars(v), "File name contains invalid characters")
    .nullable()
    .optional(),
  file_type: z
    .string()
    .trim()
    .max(100, "File type cannot exceed 100 characters")
    .regex(/^[\w.+-]*\/?[\w.+-]*$/, "File type must be a MIME type")
    .nullable()
    .optional(),
  file_size: z
    .number()
    .int("File size must be a whole number of bytes")
    .nonnegative("File size cannot be negative")
    .max(MAX_FILE_BYTES, "File size cannot exceed 10MB")
    .nullable()
    .optional(),
  overwrite_id: z.number().int().positive().nullable().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const documents = await getAllSOPDocuments();
    return NextResponse.json(documents);
  } catch (err: unknown) {
    console.error("Failed to fetch SOP documents:", err);
    return NextResponse.json({ error: "Failed to load SOP documents" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized. Please log in to MediaHub." }, { status: 401 });
    }

    const email = session.user?.email;
    const currentUser = email ? await getUserByEmail(email) : undefined;
    const isAdmin = session.user?.role === "admin" || currentUser?.role === "admin";

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Only Admin accounts can upload and manage SOP documents." },
        { status: 403 }
      );
    }

    const uploadedBy = currentUser?.id ?? (session.user?.id ? Number(session.user.id) : null);
    const contentType = req.headers.get("content-type") || "";

    // 1. JSON Request (Client pre-extracted text or manual input)
    if (contentType.includes("application/json")) {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      const parsed = CreateSOPManualSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues.map((i) => i.message).join(", ") },
          { status: 400 }
        );
      }

      const { title, category, content, file_name, file_type, file_size, overwrite_id } = parsed.data;
      const cleanTitle = title.trim();

      if (overwrite_id) {
        const updated = await updateSOPDocument(overwrite_id, {
          title: cleanTitle,
          category: category || "General",
          content: content.trim(),
          file_name: file_name ?? null,
          file_type: file_type ?? null,
          file_size: file_size ?? null,
        });
        if (!updated) {
          return NextResponse.json({ error: "Document to overwrite was not found" }, { status: 404 });
        }
        return NextResponse.json(updated, { status: 200 });
      }

      // Check for duplicate title or filename in DB
      const existingDocs = await getAllSOPDocuments();
      const duplicate = existingDocs.find(
        (d) =>
          d.title.trim().toLowerCase() === cleanTitle.toLowerCase() ||
          (file_name && d.file_name && d.file_name.toLowerCase() === file_name.toLowerCase())
      );

      if (duplicate) {
        return NextResponse.json(
          {
            error: `A document named "${duplicate.title}" already exists in the SOP database.`,
            existing_id: duplicate.id,
            existing_title: duplicate.title,
          },
          { status: 409 }
        );
      }

      const doc = await createSOPDocument({
        title: cleanTitle,
        category: category || "General",
        content: content.trim(),
        file_name: file_name ?? null,
        file_type: file_type ?? null,
        file_size: file_size ?? null,
        uploaded_by: uploadedBy,
      });

      return NextResponse.json(doc, { status: 201 });
    }

    // 2. Multipart Form Data (Raw File Upload)
    if (contentType.includes("multipart/form-data")) {
      // Reject oversized bodies before buffering them into memory.
      const contentLength = declaredContentLength(req);
      if (contentLength !== null && contentLength > MAX_MULTIPART_BYTES) {
        return NextResponse.json({ error: "File size exceeds the 10MB upload limit." }, { status: 413 });
      }

      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
      }

      const rawFile = formData.get("file");
      if (rawFile !== null && !isUploadedFile(rawFile)) {
        return NextResponse.json({ error: "The \"file\" field must be an uploaded file." }, { status: 400 });
      }
      const file = rawFile;

      const fields = MultipartFieldsSchema.safeParse({
        title: formData.get("title") ?? undefined,
        category: formData.get("category") ?? undefined,
        content: formData.get("content") ?? undefined,
        overwrite_id: formData.get("overwrite_id") ?? undefined,
      });
      if (!fields.success) {
        return NextResponse.json({ error: zodErrorMessage(fields.error) }, { status: 400 });
      }
      const customTitle = fields.data.title ?? null;
      const category = (fields.data.category || "General").slice(0, 100);
      const clientExtractedContent = fields.data.content ?? null;
      const overwriteIdStr = fields.data.overwrite_id ?? null;
      const overwriteId = overwriteIdStr && /^[1-9]\d{0,15}$/.test(overwriteIdStr) ? Number(overwriteIdStr) : null;

      if (!file && !clientExtractedContent) {
        return NextResponse.json({ error: "No file or text content provided in upload." }, { status: 400 });
      }

      if (file && file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "File size exceeds the 10MB upload limit." },
          { status: 413 }
        );
      }

      // Reject unsupported formats (e.g. legacy .doc) up front with a clear message, unless the
      // client already extracted the text.
      if (file && !clientExtractedContent) {
        const format = checkUploadFormat(file.name || "", file.type || "");
        if (!format.ok) {
          return NextResponse.json({ error: format.error }, { status: format.status });
        }
      }

      const fileName = (file?.name || "document.txt").slice(0, 255);
      const fileType = (file?.type || "application/octet-stream").slice(0, 100);
      const fileSize = file?.size || null;
      const title = (customTitle?.trim() || fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ")).slice(0, 200);

      let content = clientExtractedContent?.trim() || "";

      // If content was not extracted client-side, extract on the server
      if (!content && file) {
        try {
          const buffer = Buffer.from(await file.arrayBuffer());
          content = await extractTextFromDocument(buffer, fileName, fileType);
        } catch (err: unknown) {
          return NextResponse.json({ error: extractionErrorMessage(err) }, { status: 422 });
        }
      }

      if (!content) {
        return NextResponse.json(
          { error: "The uploaded file contains no readable text content." },
          { status: 400 }
        );
      }

      if (overwriteId) {
        const updated = await updateSOPDocument(overwriteId, {
          title,
          category,
          content,
          file_name: fileName,
          file_type: fileType,
          file_size: fileSize,
        });
        if (!updated) {
          return NextResponse.json({ error: "Document to overwrite was not found" }, { status: 404 });
        }
        return NextResponse.json(updated, { status: 200 });
      }

      // Check for duplicate in DB
      const existingDocs = await getAllSOPDocuments();
      const duplicate = existingDocs.find(
        (d) =>
          d.title.trim().toLowerCase() === title.toLowerCase() ||
          (d.file_name && d.file_name.toLowerCase() === fileName.toLowerCase())
      );

      if (duplicate) {
        return NextResponse.json(
          {
            error: `A document named "${duplicate.title}" already exists in the SOP database.`,
            existing_id: duplicate.id,
            existing_title: duplicate.title,
          },
          { status: 409 }
        );
      }

      const doc = await createSOPDocument({
        title,
        category,
        content,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        uploaded_by: uploadedBy,
      });

      return NextResponse.json(doc, { status: 201 });
    }

    return NextResponse.json({ error: "Unsupported Content-Type header." }, { status: 400 });
  } catch (err: unknown) {
    console.error("SOP Upload API Error Detail:", err);
    return NextResponse.json({ error: "Internal server error occurred." }, { status: 500 });
  }
}
