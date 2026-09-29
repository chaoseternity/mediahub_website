import JSZip from "jszip";
import mammoth from "mammoth";
import { extractText } from "unpdf";

function toBuffer(data: ArrayBuffer | Buffer | Uint8Array): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  return Buffer.from(data);
}

function toUint8Array(data: ArrayBuffer | Buffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  const buf = data as Buffer;
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Maximum characters of extracted text kept per document. */
export const MAX_EXTRACTED_CHARS = 500_000;

/** Zip-bomb limits for .docx archives. */
export const DOCX_LIMITS = {
  /** Max uncompressed size of word/document.xml. */
  maxDocumentXmlBytes: 20 * 1024 * 1024,
  /** Max total uncompressed size of all entries. */
  maxTotalBytes: 50 * 1024 * 1024,
  /** Max compression ratio for entries larger than `ratioCheckMinBytes`. */
  maxCompressionRatio: 100,
  ratioCheckMinBytes: 1024 * 1024,
  maxEntries: 5000,
};

const DOCX_TOO_LARGE_ERROR =
  "This Word document is too large or too highly compressed to process safely (possible zip bomb). Please save it as a smaller .docx or PDF.";

export const UNSUPPORTED_OFFICE_FORMAT_ERROR =
  "Unsupported format (.doc/.xlsx/.pptx) — please save as .docx or PDF.";

/** JSZip's StreamHelper (public API, missing from the bundled type definitions). */
interface JSZipStreamHelper {
  on(event: "data", cb: (chunk: Uint8Array) => void): JSZipStreamHelper;
  on(event: "error", cb: (err: Error) => void): JSZipStreamHelper;
  on(event: "end", cb: () => void): JSZipStreamHelper;
  pause(): JSZipStreamHelper;
  resume(): JSZipStreamHelper;
}

interface JSZipEntryInternals {
  _data?: { compressedSize?: number; uncompressedSize?: number };
}

/** Streams an entry through JSZip's inflater, counting bytes and aborting once `limit` is exceeded. */
function measureEntry(file: JSZip.JSZipObject, limit: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let total = 0;
    let settled = false;
    const helper = (file as unknown as { internalStream(type: "uint8array"): JSZipStreamHelper }).internalStream(
      "uint8array"
    );
    helper
      .on("data", (chunk: Uint8Array) => {
        if (settled) return;
        total += chunk.length;
        if (total > limit) {
          settled = true;
          helper.pause();
          reject(new Error(DOCX_TOO_LARGE_ERROR));
        }
      })
      .on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        // e.g. JSZip's "uncompressed data size mismatch" when headers lie about entry sizes.
        reject(new Error(`Invalid Word file: the .docx archive is corrupted (${err?.message ?? "unknown error"}).`));
      })
      .on("end", () => {
        if (settled) return;
        settled = true;
        resolve(total);
      })
      .resume();
  });
}

/**
 * Loads a .docx archive and rejects zip bombs before anything is fully decompressed:
 * checks the declared uncompressed sizes and compression ratios, then verifies the actual
 * inflated sizes with an aborting byte counter (declared sizes can lie).
 */
export async function assertSafeDocxArchive(
  data: ArrayBuffer | Buffer | Uint8Array,
  limits: typeof DOCX_LIMITS = DOCX_LIMITS
): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(toUint8Array(data));
  } catch {
    throw new Error("Invalid Word file: the document is not a valid .docx archive.");
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > limits.maxEntries) {
    throw new Error(DOCX_TOO_LARGE_ERROR);
  }

  // 1. Declared sizes (from the central directory; no decompression).
  let declaredTotal = 0;
  for (const entry of entries) {
    const meta = (entry as unknown as JSZipEntryInternals)._data;
    const uncompressed = Number(meta?.uncompressedSize ?? 0);
    const compressed = Number(meta?.compressedSize ?? 0);
    declaredTotal += uncompressed;
    if (entry.name === "word/document.xml" && uncompressed > limits.maxDocumentXmlBytes) {
      throw new Error(DOCX_TOO_LARGE_ERROR);
    }
    if (
      uncompressed > limits.ratioCheckMinBytes &&
      uncompressed / Math.max(compressed, 1) > limits.maxCompressionRatio
    ) {
      throw new Error(DOCX_TOO_LARGE_ERROR);
    }
  }
  if (declaredTotal > limits.maxTotalBytes) {
    throw new Error(DOCX_TOO_LARGE_ERROR);
  }

  // 2. Actual sizes, in case the headers under-declare them.
  let actualTotal = 0;
  for (const entry of entries) {
    const remaining = limits.maxTotalBytes - actualTotal;
    const limit =
      entry.name === "word/document.xml" ? Math.min(limits.maxDocumentXmlBytes, remaining) : remaining;
    actualTotal += await measureEntry(entry, limit);
  }

  return zip;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decodes XML entities in a single pass (so "&amp;lt;" becomes "&lt;", not "<"). */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return match;
      }
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/** Converts WordprocessingML (word/document.xml) to plain text. */
export function wordXmlToText(xmlText: string): string {
  const text = xmlText
    // Paragraph starts only: <w:p> or <w:p ...> — not <w:pPr>, <w:proofErr>, <w:pStyle>, ...
    .replace(/<w:p(?:\s[^>]*)?>/g, "\n")
    .replace(/<w:tab(?:\s[^>]*)?\/>/g, "\t")
    .replace(/<w:(?:br|cr)(?:\s[^>]*)?\/>/g, "\n")
    .replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g, "$1")
    .replace(/<[^>]+>/g, "");

  return decodeXmlEntities(text)
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

/**
 * Extracts plain text from a Word document (.docx) using pure JavaScript.
 * The archive is checked for zip bombs first; then mammoth is tried, with a fallback to direct
 * XML extraction from word/document.xml.
 */
export async function extractTextFromDocx(data: ArrayBuffer | Buffer | Uint8Array): Promise<string> {
  // Throws a clear error for zip bombs / invalid archives before any full decompression.
  const zip = await assertSafeDocxArchive(data);

  // Method 1: Try mammoth
  try {
    const buffer = toBuffer(data);
    const result = await mammoth.extractRawText({ buffer });
    if (result && result.value && result.value.trim().length > 0) {
      return result.value.trim();
    }
  } catch (mammothErr) {
    console.warn("Mammoth extraction notice, trying direct XML parser:", mammothErr);
  }

  // Method 2: Direct JSZip extraction of word/document.xml
  try {
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) {
      throw new Error("Invalid Word file: word/document.xml was not found in the archive.");
    }

    const cleanText = wordXmlToText(await docXmlFile.async("text"));
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
 * Extracts text from a PDF document buffer using unpdf (pure JS, zero DOM dependencies).
 */
export async function extractTextFromPdf(data: ArrayBuffer | Buffer | Uint8Array): Promise<string> {
  try {
    const uint8 = toUint8Array(data);
    const result = await extractText(uint8);
    const textRaw = result.text;
    const cleanText = (
      typeof textRaw === "string"
        ? textRaw
        : Array.isArray(textRaw)
        ? (textRaw as string[]).join("\n\n")
        : ""
    ).trim();

    if (!cleanText) {
      throw new Error("The PDF document contains no selectable text (it may be an image scan).");
    }
    return cleanText;
  } catch (err: unknown) {
    console.error("PDF extraction error:", err);
    throw new Error(
      err instanceof Error ? err.message : "Failed to extract text from PDF document."
    );
  }
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const UNSUPPORTED_OFFICE_EXTENSIONS = [
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
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv"];

/**
 * Universal document text extractor supporting .docx, .pdf, .txt, .md and .csv.
 * Legacy .doc (binary OLE) and other Office formats are rejected with a clear message.
 */
export async function extractTextFromDocument(
  data: ArrayBuffer | Buffer | Uint8Array,
  fileName: string,
  fileType: string = ""
): Promise<string> {
  const nameLower = fileName.toLowerCase();
  const typeLower = fileType.toLowerCase().split(";")[0].trim();
  const ext = nameLower.includes(".") ? nameLower.slice(nameLower.lastIndexOf(".")) : "";

  const isDocxMime = typeLower === DOCX_MIME;
  const isPdfMime = typeLower === "application/pdf" || typeLower.endsWith("/pdf");
  const isTextMime = typeLower.startsWith("text/");
  // Other Office types: application/msword, application/vnd.ms-excel, ...spreadsheetml/presentationml
  const isOtherOfficeMime =
    !isDocxMime &&
    (typeLower.includes("officedocument") ||
      typeLower.includes("msword") ||
      typeLower.includes("ms-excel") ||
      typeLower.includes("ms-powerpoint") ||
      typeLower.includes("opendocument"));

  // The extension decides when it is a known one; the MIME type is only used otherwise.
  let kind: "docx" | "pdf" | "text" | "unsupported-office" | "unsupported";
  if (ext === ".docx") kind = "docx";
  else if (UNSUPPORTED_OFFICE_EXTENSIONS.includes(ext)) kind = "unsupported-office";
  else if (ext === ".pdf") kind = "pdf";
  else if (TEXT_EXTENSIONS.includes(ext)) kind = "text";
  else if (isDocxMime) kind = "docx";
  else if (isOtherOfficeMime) kind = "unsupported-office";
  else if (isPdfMime) kind = "pdf";
  else if (isTextMime) kind = "text";
  else kind = "unsupported";

  let text: string;

  if (kind === "docx") {
    // 1. Word Document (.docx)
    text = await extractTextFromDocx(data);
  } else if (kind === "pdf") {
    // 2. PDF Document (.pdf)
    text = await extractTextFromPdf(data);
  } else if (kind === "text") {
    // 3. Plain Text / Markdown (.txt, .md, .markdown, .csv)
    const buffer = toBuffer(data);
    text = buffer.toString("utf-8").trim();
    if (!text) {
      throw new Error("The text file is empty.");
    }
  } else if (kind === "unsupported-office") {
    throw new Error(UNSUPPORTED_OFFICE_FORMAT_ERROR);
  } else {
    throw new Error("Unsupported document format. Allowed formats: .docx, .pdf, .txt, .md, .csv");
  }

  // Cap extracted text to prevent memory exhaustion
  if (text.length > MAX_EXTRACTED_CHARS) {
    text = text.slice(0, MAX_EXTRACTED_CHARS);
  }

  return text;
}
