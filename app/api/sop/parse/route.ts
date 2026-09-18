import { auth } from "@/lib/auth";
import { extractTextFromDocument } from "@/lib/doc-parser";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File size exceeds the 10MB limit." },
        { status: 413 }
      );
    }

    const fileName = file.name || "document.txt";
    const fileType = file.type || "";

    const allowedExtensions = [".pdf", ".docx", ".doc", ".txt", ".md", ".markdown"];
    const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
    const isTextMime = fileType.startsWith("text/");
    const isDocMime =
      fileType.includes("pdf") ||
      fileType.includes("wordprocessingml") ||
      fileType.includes("msword") ||
      fileType.includes("officedocument");

    if (!allowedExtensions.includes(ext) && !isTextMime && !isDocMime) {
      return NextResponse.json(
        { error: "Unsupported file format. Please upload a PDF, Word document (.docx), or text document." },
        { status: 400 }
      );
    }

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
    const errMsg = err instanceof Error ? err.message : "Failed to extract text from document";
    return NextResponse.json({ error: errMsg }, { status: 422 });
  }
}
