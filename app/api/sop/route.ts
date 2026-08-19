import { auth } from "@/lib/auth";
import { getAllSOPDocuments, createSOPDocument, getUserByEmail } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export const runtime = "nodejs";

const CreateSOPManualSchema = z.object({
  title: z.string().min(1, "Title is required"),
  category: z.string().optional(),
  content: z.string().min(1, "Content is required"),
});

export async function GET() {
  try {
    const documents = await getAllSOPDocuments();
    return NextResponse.json(documents);
  } catch (err: unknown) {
    console.error("Failed to fetch SOP documents:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load SOP documents" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized. Please log in." }, { status: 401 });
    }

    const currentUser = await getUserByEmail(session.user.email!);
    const isAdmin = session.user.role === "admin" || currentUser?.role === "admin";

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Forbidden: Only Admin accounts can upload SOP documents." },
        { status: 403 }
      );
    }

    const uploadedBy = currentUser?.id ?? null;
    const contentType = req.headers.get("content-type") || "";

    // 1. Multipart Form Data (File Upload)
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const customTitle = formData.get("title") as string | null;
      const category = (formData.get("category") as string | null) || "General";

      if (!file) {
        return NextResponse.json({ error: "No file provided in upload request." }, { status: 400 });
      }

      const fileName = file.name;
      const fileType = file.type || "application/octet-stream";
      const fileSize = file.size;
      const title = customTitle?.trim() || fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");

      let extractedContent = "";
      const buffer = Buffer.from(await file.arrayBuffer());

      if (fileType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
        try {
          const parser = new PDFParse({ data: buffer });
          const textResult = await parser.getText();
          extractedContent = (textResult.text || "").trim();
        } catch (pdfErr) {
          console.error("PDF parse error:", pdfErr);
          return NextResponse.json(
            { error: "Failed to extract text from PDF. Please ensure the PDF contains selectable text and is not encrypted." },
            { status: 400 }
          );
        }
      } else if (
        fileName.toLowerCase().endsWith(".docx") ||
        fileName.toLowerCase().endsWith(".doc") ||
        fileType.includes("wordprocessingml") ||
        fileType.includes("msword") ||
        fileType.includes("officedocument")
      ) {
        try {
          const result = await mammoth.extractRawText({ buffer });
          extractedContent = (result.value || "").trim();
        } catch (docxErr) {
          console.error("DOCX parse error:", docxErr);
          return NextResponse.json(
            { error: "Failed to parse Word document (.docx). Please ensure it is a valid Microsoft Word .docx file." },
            { status: 400 }
          );
        }
      } else {
        // Plain text, Markdown, CSV
        extractedContent = buffer.toString("utf-8").trim();
      }

      if (!extractedContent) {
        return NextResponse.json(
          { error: "The uploaded file contains no readable text content." },
          { status: 400 }
        );
      }

      const doc = await createSOPDocument({
        title,
        category,
        content: extractedContent,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
        uploaded_by: uploadedBy,
      });

      return NextResponse.json(doc, { status: 201 });
    }

    // 2. Direct JSON Body
    const body = await req.json();
    const parsed = CreateSOPManualSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const doc = await createSOPDocument({
      title: parsed.data.title,
      category: parsed.data.category || "General",
      content: parsed.data.content,
      uploaded_by: uploadedBy,
    });

    return NextResponse.json(doc, { status: 201 });
  } catch (err: unknown) {
    console.error("SOP POST Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "An unexpected server error occurred during SOP upload." },
      { status: 500 }
    );
  }
}
