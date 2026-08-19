import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

/**
 * Extracts plain text from a Word document (.docx) using pure JavaScript.
 * Attempts mammoth first for formatted markdown/text, then falls back to direct XML extraction from JSZip.
 */
export async function extractTextFromDocx(data: ArrayBuffer | Buffer): Promise<string> {
  // Method 1: Try mammoth
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const result = await mammoth.extractRawText({ buffer });
    if (result && result.value && result.value.trim().length > 0) {
      return result.value.trim();
    }
  } catch (mammothErr) {
    console.warn("Mammoth extraction notice, trying direct XML parser:", mammothErr);
  }

  // Method 2: Direct JSZip extraction of word/document.xml
  try {
    const zip = await JSZip.loadAsync(data);
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) {
      throw new Error("Invalid Word file: word/document.xml was not found in the archive.");
    }

    const xmlText = await docXmlFile.async("text");

    // Convert XML paragraphs and text nodes to readable text
    let cleanText = xmlText
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, "$1")
      .replace(/<[^>]+>/g, "");

    // Decode standard XML entities
    cleanText = cleanText
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n\s*\n/g, "\n\n")
      .trim();

    if (!cleanText) {
      throw new Error("No readable text found in Word document XML.");
    }

    return cleanText;
  } catch (err: unknown) {
    console.error("DOCX extraction error:", err);
    throw new Error(
      err instanceof Error ? err.message : "Failed to extract text from Microsoft Word document."
    );
  }
}

/**
 * Extracts text from a PDF document buffer.
 */
export async function extractTextFromPdf(data: ArrayBuffer | Buffer): Promise<string> {
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const cleanText = (textResult.text || "").trim();
    if (!cleanText) {
      throw new Error("The PDF document contains no selectable text (it may be a scanned image).");
    }
    return cleanText;
  } catch (err: unknown) {
    console.error("PDF extraction error:", err);
    throw new Error(
      err instanceof Error ? err.message : "Failed to extract text from PDF document."
    );
  }
}

/**
 * Universal document text extractor supporting .docx, .pdf, .txt, and .md.
 */
export async function extractTextFromDocument(
  data: ArrayBuffer | Buffer,
  fileName: string,
  fileType: string = ""
): Promise<string> {
  const nameLower = fileName.toLowerCase();
  const typeLower = fileType.toLowerCase();

  // 1. Word Document (.docx / .doc)
  if (
    nameLower.endsWith(".docx") ||
    nameLower.endsWith(".doc") ||
    typeLower.includes("wordprocessingml") ||
    typeLower.includes("msword") ||
    typeLower.includes("officedocument")
  ) {
    return extractTextFromDocx(data);
  }

  // 2. PDF Document (.pdf)
  if (nameLower.endsWith(".pdf") || typeLower.includes("pdf")) {
    return extractTextFromPdf(data);
  }

  // 3. Plain Text / Markdown (.txt, .md, .markdown, .csv)
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const text = buffer.toString("utf-8").trim();
  if (!text) {
    throw new Error("The text file is empty.");
  }
  return text;
}
