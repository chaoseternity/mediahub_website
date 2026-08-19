import { auth } from "@/lib/auth";
import { getAllSOPDocuments, createSOPDocument, getUserByEmail } from "@/lib/db";
import { extractTextFromDocument } from "@/lib/doc-parser";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const CreateSOPManualSchema = z.object({
  title: z.string().min(1, "Title is required"),
  category: z.string().optional(),
  content: z.string().min(1, "Content is required"),
  file_name: z.string().nullable().optional(),
  file_type: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
});

export async function GET() {
  try {
    const documents = await getAllSOPDocuments();
    return NextResponse.json(documents);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : "Failed to load SOP documents";
    console.error("Failed to fetch SOP documents:", err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
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

      const doc = await createSOPDocument({
        title: parsed.data.title.trim(),
        category: parsed.data.category || "General",
        content: parsed.data.content.trim(),
        file_name: parsed.data.file_name ?? null,
        file_type: parsed.data.file_type ?? null,
        file_size: parsed.data.file_size ?? null,
        uploaded_by: uploadedBy,
      });

      return NextResponse.json(doc, { status: 201 });
    }

    // 2. Multipart Form Data (Raw File Upload)
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const customTitle = formData.get("title") as string | null;
      const category = (formData.get("category") as string | null) || "General";
      const clientExtractedContent = formData.get("content") as string | null;

      if (!file && !clientExtractedContent) {
        return NextResponse.json({ error: "No file or text content provided in upload." }, { status: 400 });
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
    const errorDetail = err instanceof Error ? `${err.name}: ${err.message}` : "Internal server error occurred.";
    console.error("SOP Upload API Error Detail:", err);
    return NextResponse.json({ error: errorDetail }, { status: 500 });
  }
}
