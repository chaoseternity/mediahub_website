import { UNSUPPORTED_OFFICE_FORMAT_ERROR } from "@/lib/doc-parser";

/**
 * Up-front format check for SOP uploads, mirroring lib/doc-parser's extractTextFromDocument:
 * .docx, .pdf and plain text (.txt/.md/.markdown/.csv) are supported; legacy/other Office
 * formats (.doc, .xlsx, .pptx, ...) are rejected with the parser's clear message.
 */
const SUPPORTED_EXTENSIONS = [".docx", ".pdf", ".txt", ".md", ".markdown", ".csv"];
const OFFICE_EXTENSIONS = [
  ".doc",
  ".dot",
  ".docm",
  ".dotx",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".ppt",
  ".pptx",
  ".pptm",
  ".rtf",
  ".odt",
];
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const UNSUPPORTED_UPLOAD_FORMAT_ERROR =
  "Unsupported file format. Please upload a PDF, Word document (.docx), or text document.";

export type UploadFormatCheck = { ok: true } | { ok: false; status: 400 | 415; error: string };

export function checkUploadFormat(fileName: string, fileType: string): UploadFormatCheck {
  const nameLower = fileName.toLowerCase();
  const ext = nameLower.includes(".") ? nameLower.slice(nameLower.lastIndexOf(".")) : "";
  const type = fileType.toLowerCase().split(";")[0].trim();

  if (SUPPORTED_EXTENSIONS.includes(ext)) return { ok: true };
  if (OFFICE_EXTENSIONS.includes(ext)) {
    return { ok: false, status: 415, error: UNSUPPORTED_OFFICE_FORMAT_ERROR };
  }
  if (type === DOCX_MIME || type === "application/pdf" || type.endsWith("/pdf") || type.startsWith("text/")) {
    return { ok: true };
  }
  if (
    type.includes("officedocument") ||
    type.includes("msword") ||
    type.includes("ms-excel") ||
    type.includes("ms-powerpoint") ||
    type.includes("opendocument")
  ) {
    return { ok: false, status: 415, error: UNSUPPORTED_OFFICE_FORMAT_ERROR };
  }
  return { ok: false, status: 400, error: UNSUPPORTED_UPLOAD_FORMAT_ERROR };
}

/**
 * Text-extraction failures whose messages are written for users (no library internals).
 * Anything else is logged and replaced by a generic message.
 */
const USER_FACING_EXTRACTION_ERRORS =
  /^(Unsupported format \(|Unsupported document format\.|This Word document is too large|The PDF document contains no selectable text|The text file is empty\.|No readable text found in Word document|Invalid Word file: the document is not a valid \.docx archive\.)/;

export const GENERIC_EXTRACTION_ERROR =
  "Could not extract text from this document. Make sure it is a valid, non-password-protected PDF, Word (.docx) or text file.";

export function extractionErrorMessage(err: unknown): string {
  if (err instanceof Error && USER_FACING_EXTRACTION_ERRORS.test(err.message)) {
    return err.message;
  }
  console.error("[api] SOP document text extraction failed:", err);
  return GENERIC_EXTRACTION_ERROR;
}
