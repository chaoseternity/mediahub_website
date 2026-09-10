import {
  generateEquipmentExcel,
  parseEquipmentExcel,
  sortEquipmentForExcel,
  normalizeCondition,
} from "@/lib/excel";
import type { Equipment } from "@/lib/types";

function createMockEquipment(overrides: Partial<Equipment>): Equipment {
  return {
    id: 1,
    name: "Item",
    tags: [],
    description: null,
    serial_number: null,
    condition: "Working",
    location: "Media Room",
    status: "Available",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    active_checkout_id: null,
    checked_out_by_name: null,
    checked_out_at: null,
    expected_return_at: null,
    checkout_location: null,
    ...overrides,
  };
}

describe("Excel utility - lib/excel.ts", () => {
  describe("normalizeCondition", () => {
    test("normalizes various condition values correctly", () => {
      expect(normalizeCondition("New")).toBe("Working");
      expect(normalizeCondition("Good")).toBe("Working");
      expect(normalizeCondition("Working")).toBe("Working");
      expect(normalizeCondition("working")).toBe("Working");
      expect(normalizeCondition("Fair")).toBe("Impaired");
      expect(normalizeCondition("Impaired")).toBe("Impaired");
      expect(normalizeCondition("In repairs")).toBe("Broken");
      expect(normalizeCondition("in repairs")).toBe("Broken");
      expect(normalizeCondition("repair")).toBe("Broken");
      expect(normalizeCondition("repairs")).toBe("Broken");
      expect(normalizeCondition("Poor")).toBe("Broken");
      expect(normalizeCondition("Broken")).toBe("Broken");
      expect(normalizeCondition("")).toBe("Working");
      expect(normalizeCondition(null)).toBe("Working");
    });
  });

  describe("sortEquipmentForExcel", () => {
    test("sorts by Tag, then ID hierarchy (partA -> partB -> partC)", () => {
      const items: Equipment[] = [
        createMockEquipment({ id: 1, name: "SD-2", tags: ["SD Card"], serial_number: "SD-V-10" }),
        createMockEquipment({ id: 2, name: "Laptop 1", tags: ["Laptop"], serial_number: "LP-KAM-001" }),
        createMockEquipment({ id: 3, name: "SD-1", tags: ["SD Card"], serial_number: "SD-V-02" }),
        createMockEquipment({ id: 4, name: "Laptop 2", tags: ["Laptop"], serial_number: "LP-DJ-001" }),
      ];

      const sorted = sortEquipmentForExcel(items);

      // Tag "Laptop" comes before "SD Card"
      expect(sorted[0].serial_number).toBe("LP-DJ-001");
      expect(sorted[1].serial_number).toBe("LP-KAM-001");
      // Within "SD Card", SD-V-02 comes before SD-V-10
      expect(sorted[2].serial_number).toBe("SD-V-02");
      expect(sorted[3].serial_number).toBe("SD-V-10");
    });
  });

  describe("generateEquipmentExcel & parseEquipmentExcel round-trip", () => {
    test("omits duplicate tags in export and propagates tags downward in import", () => {
      const original: Equipment[] = [
        createMockEquipment({ id: 1, name: "DJ Laptop", tags: ["Laptop"], serial_number: "LP-01", condition: "Working", location: "Media Room" }),
        createMockEquipment({ id: 2, name: "Kamera Laptop", tags: ["Laptop"], serial_number: "LP-02", condition: "Impaired", location: "Control Room" }),
        createMockEquipment({ id: 3, name: "SD Card 1", tags: ["Storage"], serial_number: "SD-01", condition: "Working", location: "Showroom" }),
        createMockEquipment({ id: 4, name: "SD Card 2", tags: ["Storage"], serial_number: "SD-02", condition: "Broken", location: "Showroom" }),
      ];

      const excelBuffer = generateEquipmentExcel(original);
      expect(excelBuffer.length).toBeGreaterThan(0);

      const parsed = parseEquipmentExcel(excelBuffer);

      expect(parsed).toHaveLength(4);

      // Verify tag propagation: both first and second item should have ["Laptop"]
      expect(parsed[0].tags).toEqual(["Laptop"]);
      expect(parsed[0].serial_number).toBe("LP-01");
      expect(parsed[0].condition).toBe("Working");

      expect(parsed[1].tags).toEqual(["Laptop"]); // inherited from above!
      expect(parsed[1].serial_number).toBe("LP-02");
      expect(parsed[1].condition).toBe("Impaired");
      expect(parsed[1].location).toBe("Control Room");

      // Verify storage tag
      expect(parsed[2].tags).toEqual(["Storage"]);
      expect(parsed[2].serial_number).toBe("SD-01");

      expect(parsed[3].tags).toEqual(["Storage"]); // inherited from above!
      expect(parsed[3].serial_number).toBe("SD-02");
      expect(parsed[3].condition).toBe("Broken");
    });

    test("ignores any content beyond column F (column G, H, etc.)", () => {
      // Build a worksheet with columns past F (e.g. column G = Notes, column H = Extra)
      const XLSX = require("xlsx");
      const data = [
        ["Tag", "Equipment ID", "Equipment Name", "Description", "Condition", "Location", "Notes", "Extra Column"],
        ["Laptop", "LP-NOTE-01", "Note Laptop", "Desc", "In repairs", "Media Room", "Do not import this note", "Ignore this too"],
        // A row with only notes in column G should be completely ignored
        ["", "", "", "", "", "", "Orphan note that should be ignored", "Also ignored"],
      ];

      const ws = XLSX.utils.aoa_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const parsed = parseEquipmentExcel(buffer);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].serial_number).toBe("LP-NOTE-01");
      expect(parsed[0].name).toBe("Note Laptop");
      expect(parsed[0].condition).toBe("Broken"); // "In repairs" mapped to "Broken"
      expect(parsed[0].location).toBe("Media Room");
      // Extra columns are not in parsed object
      expect((parsed[0] as any).Notes).toBeUndefined();
    });
  });
});
