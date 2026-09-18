import { auth } from "@/lib/auth";
import { getAllSOPDocuments, createSOPDocument, updateSOPDocument, getUserByEmail } from "@/lib/db";
import { extractTextFromDocument } from "@/lib/doc-parser";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const CreateSOPManualSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title cannot exceed 200 characters"),
  category: z.string().trim().max(100, "Category cannot exceed 100 characters").optional(),
  content: z.string().trim().min(1, "Content is required").max(500000, "Content cannot exceed 500,000 characters"),
  file_name: z.string().trim().max(255, "File name cannot exceed 255 characters").nullable().optional(),
  file_type: z.string().trim().max(100, "File type cannot exceed 100 characters").nullable().optional(),
  file_size: z.number().max(10 * 1024 * 1024, "File size cannot exceed 10MB").nullable().optional(),
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
      const body = await req.json();
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
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const customTitle = formData.get("title") as string | null;
      if (customTitle && customTitle.trim().length > 200) {
        return NextResponse.json({ error: "Title cannot exceed 200 characters" }, { status: 400 });
      }
      const rawCategory = (formData.get("category") as string | null) || "General";
      const category = rawCategory.trim().slice(0, 100);
      const clientExtractedContent = formData.get("content") as string | null;
      if (clientExtractedContent && clientExtractedContent.trim().length > 500000) {
        return NextResponse.json({ error: "Content cannot exceed 500,000 characters" }, { status: 400 });
      }
      const overwriteIdStr = formData.get("overwrite_id") as string | null;
      const overwriteId = overwriteIdStr && /^\d+$/.test(overwriteIdStr) ? Number(overwriteIdStr) : null;

      if (!file && !clientExtractedContent) {
        return NextResponse.json({ error: "No file or text content provided in upload." }, { status: 400 });
      }

      if (file && file.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: "File size exceeds the 10MB upload limit." },
          { status: 413 }
        );
      }

      const fileName = file?.name || "document.txt";
      const fileType = file?.type || "application/octet-stream";
      const fileSize = file?.size || null;
      const title = customTitle?.trim() || fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");

      let content = clientExtractedContent?.trim() || "";

      // If content was not extracted client-side, extract on the server
      if (!content && file) {
        const buffer = Buffer.from(await file.arrayBuffer());
        content = await extractTextFromDocument(buffer, fileName, fileType);
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
