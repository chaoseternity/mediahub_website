import * as XLSX from "xlsx";
import type { Condition, Equipment } from "@/lib/types";
import { sortEquipmentById } from "@/lib/utils";

export interface ParsedEquipmentItem {
  name: string;
  serial_number: string | null;
  tags: string[];
  description: string | null;
  condition: Condition;
  location: string;
}

export function normalizeCondition(val: unknown): Condition {
  if (!val) return "Working";
  const s = String(val).trim().toLowerCase();
  if (s === "missing" || s === "lost") return "Missing";
  if (s === "retired" || s === "decommissioned") return "Retired";
  if (s === "new" || s === "good" || s === "working") return "Working";
  if (s === "fair" || s === "impaired") return "Impaired";
  if (s === "in repairs" || s === "in repair" || s === "repair" || s === "repairs" || s === "poor" || s === "broken" || s === "damaged") {
    return "Broken";
  }
  return "Working";
}

/**
 * Sorts equipment by:
 * 1. Tag (alphabetical)
 * 2. Equipment ID hierarchical parts (partA, partB, partC...)
 * 3. Name (fallback)
 */
export function sortEquipmentForExcel(equipment: Equipment[]): Equipment[] {
  return [...equipment].sort((a, b) => {
    const tagA = (a.tags && a.tags.length > 0 ? a.tags.join(", ") : "").toLowerCase();
    const tagB = (b.tags && b.tags.length > 0 ? b.tags.join(", ") : "").toLowerCase();

    // 1. Tag grouping
    if (tagA !== tagB) {
      if (!tagA) return 1;
      if (!tagB) return -1;
      return tagA.localeCompare(tagB, undefined, { numeric: true, sensitivity: "base" });
    }

    // 2. ID sorting (hierarchical: partA -> partB -> partC)
    const cmpId = sortEquipmentById(a, b);
    if (cmpId !== 0) return cmpId;

    // 3. Name fallback
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

/** Max data rows parsed from one uploaded spreadsheet. */
export const MAX_IMPORT_ROWS = 5000;
/** Max items the batch equipment API accepts per request; clients must chunk uploads to this size. */
export const BATCH_CHUNK_SIZE = 500;

const FORMULA_TRIGGER_RE = /^[=+\-@\t\r\n]/;

/**
 * Neutralizes CSV formula injection (CWE-1236) for **CSV/text** exports only.
 * Values starting with =, +, -, @, tab, or newline are prefixed with an apostrophe (') so
 * spreadsheet applications treat them as text when they parse a CSV.
 *
 * Do not use this for .xlsx export: cells written as explicit string cells (t: "s") are never
 * evaluated as formulas, and the apostrophe would show up literally.
 */
export function sanitizeExcelCell(val: string | null | undefined): string {
  if (!val) return "";
  const str = String(val);
  if (FORMULA_TRIGGER_RE.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Reverses {@link sanitizeExcelCell} for values that came from a CSV export.
 * Not used for .xlsx import, where a leading apostrophe is genuine cell text.
 */
export function desanitizeExcelCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val).trim();
  if (str.startsWith("'") && FORMULA_TRIGGER_RE.test(str.slice(1))) {
    return str.slice(1);
  }
  return str;
}

/** Reads a cell value from an .xlsx import as plain text (a leading apostrophe is kept). */
function cellText(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

/** Builds a worksheet in which every cell is an explicit string cell (never a formula). */
function stringSheet(rows: string[][]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxCol = 0;
  rows.forEach((row, r) => {
    maxCol = Math.max(maxCol, row.length);
    row.forEach((value, c) => {
      ws[XLSX.utils.encode_cell({ r, c })] = { t: "s", v: value ?? "" };
    });
  });
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(rows.length - 1, 0), c: Math.max(maxCol - 1, 0) },
  });
  return ws;
}

/**
 * Generates an Excel workbook buffer from equipment data.
 * Columns: Tag - ID - Name - Description - Condition - Location
 * Subsequent items with the same tag leave the Tag cell empty.
 */
export function generateEquipmentExcel(equipment: Equipment[]): Uint8Array {
  const sorted = sortEquipmentForExcel(equipment);

  const header = ["Tag", "ID", "Name", "Description", "Condition", "Location"];
  const rows: string[][] = [header];

  let lastTag: string | null = null;

  for (const item of sorted) {
    const currentTag = item.tags && item.tags.length > 0 ? item.tags.join(", ") : "";
    // Only show tag on first row of tag group; subsequent rows in group have empty cell
    const displayTag = currentTag !== lastTag ? currentTag : "";
    lastTag = currentTag;

    // Written as explicit string cells, so values like "=SUM(...)" or "- charger" are stored
    // verbatim as text and never evaluated as formulas (no apostrophe prefix needed).
    rows.push([
      displayTag,
      item.serial_number ?? "",
      item.name ?? "",
      item.description ?? "",
      item.condition ?? "",
      item.location ?? "",
    ]);
  }

  const wb = XLSX.utils.book_new();
  const ws = stringSheet(rows);

  // Set friendly column widths
  ws["!cols"] = [
    { wch: 18 }, // Tag
    { wch: 16 }, // ID
    { wch: 28 }, // Name
    { wch: 45 }, // Description
    { wch: 14 }, // Condition
    { wch: 18 }, // Location
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Equipment");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
}

/**
 * Parses an Excel file (.xlsx / .xls) buffer into equipment items (at most MAX_IMPORT_ROWS).
 * If a tag cell is empty, it inherits the nearest non-empty tag above.
 */
export function parseEquipmentExcel(data: ArrayBuffer | Uint8Array): ParsedEquipmentItem[] {
  const wb = XLSX.read(data, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];

  const ws = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (rows.length < 2) return [];

  // Identify column indices from header
  const headerRow = (rows[0] || []).map((h) => String(h).trim().toLowerCase());

  let colTag = headerRow.findIndex((h) => h === "tag" || h.startsWith("tag"));
  let colId = headerRow.findIndex((h) => h === "id" || h === "equipment id" || h === "serial number" || h === "serial");
  let colName = headerRow.findIndex((h) => h === "name" || h === "equipment name");
  let colDesc = headerRow.findIndex((h) => h.includes("desc"));
  let colCond = headerRow.findIndex((h) => h.includes("cond"));
  let colLoc = headerRow.findIndex((h) => h.includes("loc"));

  // Fallbacks if headers not detected
  if (colTag === -1) colTag = 0;
  if (colId === -1) colId = 1;
  if (colName === -1) colName = 2;
  if (colDesc === -1) colDesc = 3;
  if (colCond === -1) colCond = 4;
  if (colLoc === -1) colLoc = 5;

  const parsedItems: ParsedEquipmentItem[] = [];
  let currentTag = "";
  const maxRows = Math.min(rows.length, MAX_IMPORT_ROWS + 1); // header + MAX_IMPORT_ROWS data rows

  for (let r = 1; r < maxRows; r++) {
    const rawRow = rows[r];
    if (!rawRow || rawRow.length === 0) continue;

    // Strictly ignore any columns past column F (indices 0..5)
    const row = rawRow.slice(0, 6);

    // Check if row (columns A through F) is empty
    const isEmpty = row.every((c) => c === null || c === undefined || String(c).trim() === "");
    if (isEmpty) continue;

    const rawTag = cellText(row[colTag]);
    if (rawTag) {
      currentTag = rawTag.slice(0, 100);
    }

    const rawId = cellText(row[colId]);
    const rawName = cellText(row[colName]);
    const rawDesc = cellText(row[colDesc]);
    const rawCond = cellText(row[colCond]);
    const rawLoc = cellText(row[colLoc]);

    const serialNumber = rawId ? rawId.slice(0, 100) : "";
    const name = rawName ? rawName.slice(0, 200) : "";

    // If both name and serialNumber are empty, skip row
    if (!name && !serialNumber) continue;

    const tags = currentTag
      ? currentTag.split(",").map((t) => t.trim().slice(0, 50)).filter(Boolean).slice(0, 20)
      : [];

    const condition = normalizeCondition(rawCond);
    const location = rawLoc ? rawLoc.slice(0, 200) : "Media Room";

    parsedItems.push({
      name: name || serialNumber,
      serial_number: serialNumber || null,
      tags,
      description: rawDesc ? rawDesc.slice(0, 2000) : null,
      condition,
      location,
    });
  }

  return parsedItems;
}
