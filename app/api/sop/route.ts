import { auth } from "@/lib/auth";
import { getAllSOPDocuments, createSOPDocument, getUserByEmail } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PDFParse } from "pdf-parse";

export const runtime = "nodejs";

const CreateSOPManualSchema = z.object({
  title: z.string().min(1, "Title is required"),
  category: z.string().optional(),
  content: z.string().min(1, "Content is required"),
});

export async function GET() {
  const documents = await getAllSOPDocuments();
  return NextResponse.json(documents);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can upload SOP documents" }, { status: 403 });
  }

  const currentUser = await getUserByEmail(session.user.email!);
  const uploadedBy = currentUser?.id ?? null;

  const contentType = req.headers.get("content-type") || "";

  // 1. Multipart Form Data (File Upload)
  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const customTitle = formData.get("title") as string | null;
      const category = (formData.get("category") as string | null) || "General";

      if (!file) {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
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
            { error: "Failed to extract text from PDF. Please make sure the PDF is not password protected or corrupted." },
            { status: 400 }
          );
        }
      } else {
        // Plain text, Markdown, CSV, etc.
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
    } catch (err: unknown) {
      console.error("File upload error:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to process file upload" },
        { status: 500 }
      );
    }
  }

  // 2. Direct JSON Body
  try {
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
  } catch {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }
}
