import JSZip from "jszip";
import {
  assertSafeDocxArchive,
  decodeXmlEntities,
  DOCX_LIMITS,
  extractTextFromDocument,
  UNSUPPORTED_OFFICE_FORMAT_ERROR,
  wordXmlToText,
} from "@/lib/doc-parser";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function makeDocx(documentXml: string, extra: Record<string, string> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file("word/document.xml", documentXml);
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

/** Rewrites the central-directory "uncompressed size" of every entry (simulates lying headers). */
function forgeDeclaredSizes(zipBuf: Buffer, declared: number): Buffer {
  const buf = Buffer.from(zipBuf);
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf.readUInt32LE(i) === 0x02014b50) buf.writeUInt32LE(declared, i + 24);
    if (buf.readUInt32LE(i) === 0x04034b50) buf.writeUInt32LE(declared, i + 22);
  }
  return buf;
}

describe("lib/doc-parser", () => {
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe("zip bomb protection", () => {
    test("rejects a document.xml whose declared uncompressed size exceeds the limit", async () => {
      const body = `<w:document ${W_NS}><w:body><w:p><w:r><w:t>${"A".repeat(21 * 1024 * 1024)}</w:t></w:r></w:p></w:body></w:document>`;
      const bomb = await makeDocx(body);
      expect(bomb.length).toBeLessThan(1024 * 1024); // tiny on disk

      await expect(extractTextFromDocument(bomb, "bomb.docx", DOCX_MIME)).rejects.toThrow(/zip bomb/i);
    }, 30_000);

    test("rejects entries with an absurd compression ratio", async () => {
      const bomb = await makeDocx(`<w:document ${W_NS}><w:body/></w:document>`, {
        "word/media/blob.bin": "\0".repeat(5 * 1024 * 1024),
      });
      await expect(assertSafeDocxArchive(bomb)).rejects.toThrow(/zip bomb/i);
    });

    test("rejects when the actual inflated size exceeds the limit even if headers under-declare it", async () => {
      const zip = new JSZip();
      zip.file("word/document.xml", `<w:document ${W_NS}><w:body><w:p><w:r><w:t>${"B".repeat(200_000)}</w:t></w:r></w:p></w:body></w:document>`);
      const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const forged = forgeDeclaredSizes(zipBuf, 10);
      await expect(
        assertSafeDocxArchive(forged, { ...DOCX_LIMITS, maxTotalBytes: 50_000, maxDocumentXmlBytes: 50_000 })
      ).rejects.toThrow(/zip bomb/i);
    });

    test("accepts and extracts a normal .docx", async () => {
      const docx = await makeDocx(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body><w:p><w:r><w:t>Hello SOP</w:t></w:r></w:p></w:body></w:document>`
      );
      await expect(extractTextFromDocument(docx, "guide.docx", DOCX_MIME)).resolves.toContain("Hello SOP");
    });
  });

  describe("format routing", () => {
    const junk = Buffer.from("D0CF11E0A1B11AE1", "hex"); // OLE header (legacy .doc/.xls)

    test.each([
      ["legacy.doc", "application/msword"],
      ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["upload", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["old.xls", "application/vnd.ms-excel"],
    ])("rejects %s (%s) with a clear message", async (name, mime) => {
      await expect(extractTextFromDocument(junk, name, mime)).rejects.toThrow(UNSUPPORTED_OFFICE_FORMAT_ERROR);
    });

    test("still rejects unknown binaries", async () => {
      await expect(extractTextFromDocument(junk, "payload.exe", "application/x-msdownload")).rejects.toThrow(
        /Unsupported document format/
      );
    });

    test("plain text files are still accepted", async () => {
      await expect(extractTextFromDocument(Buffer.from(" hi \n"), "notes.md", "")).resolves.toBe("hi");
    });
  });

  describe("XML text extraction", () => {
    test("only real <w:p> elements start paragraphs (not <w:pPr>, <w:proofErr>, ...)", () => {
      const xml =
        `<w:body><w:p w:rsidR="00A1"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Hello</w:t></w:r>` +
        `<w:proofErr w:type="spellStart"/><w:r><w:t xml:space="preserve"> world</w:t></w:r><w:proofErr w:type="spellEnd"/></w:p>` +
        `<w:p><w:r><w:t>Line</w:t><w:tab/><w:t>two</w:t><w:br/><w:t>three</w:t></w:r></w:p></w:body>`;
      expect(wordXmlToText(xml)).toBe("Hello world\nLine\ttwo\nthree");
    });

    test("decodes entities exactly once, including numeric entities", () => {
      expect(decodeXmlEntities("&amp;lt;tag&amp;gt;")).toBe("&lt;tag&gt;");
      expect(decodeXmlEntities("&lt;b&gt; &quot;q&quot; &apos;a&apos; &amp;")).toBe(`<b> "q" 'a' &`);
      expect(decodeXmlEntities("&#169; &#x263A; &#X41; &#0065;")).toBe("© ☺ A A");
      expect(decodeXmlEntities("&unknown; &#xZZ; &#99999999;")).toBe("&unknown; &#xZZ; &#99999999;");
      expect(wordXmlToText("<w:p><w:r><w:t>R&amp;D &amp;amp; &#8364;5</w:t></w:r></w:p>")).toBe("R&D &amp; €5");
    });
  });
});
