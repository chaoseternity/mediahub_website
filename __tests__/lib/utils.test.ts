import { parseEquipmentId, sortEquipmentById } from "@/lib/utils";

describe("parseEquipmentId", () => {
  test("handles empty or null ID", () => {
    expect(parseEquipmentId(null)).toEqual({
      partA: "UNASSIGNED",
      partB: "",
      partC: "",
      partD: "",
      prefix: "UNASSIGNED",
      subPrefix: "UNASSIGNED",
      formatted: "N/A",
    });
  });

  test("parses 1-part ID", () => {
    const res = parseEquipmentId("CAM");
    expect(res.partA).toBe("CAM");
    expect(res.partB).toBe("");
    expect(res.partC).toBe("");
    expect(res.partD).toBe("");
    expect(res.formatted).toBe("CAM");
  });

  test("parses 2-part ID", () => {
    const res = parseEquipmentId("SD-01");
    expect(res.partA).toBe("SD");
    expect(res.partB).toBe("01");
    expect(res.partC).toBe("");
    expect(res.partD).toBe("");
    expect(res.formatted).toBe("SD-01");
  });

  test("parses 3-part ID", () => {
    const res = parseEquipmentId("LP-DJ-001");
    expect(res.partA).toBe("LP");
    expect(res.partB).toBe("DJ");
    expect(res.partC).toBe("001");
    expect(res.partD).toBe("");
    expect(res.formatted).toBe("LP-DJ-001");
  });

  test("parses 4-part ID (e.g. A-B-C-1)", () => {
    const res = parseEquipmentId("A-B-C-1");
    expect(res.partA).toBe("A");
    expect(res.partB).toBe("B");
    expect(res.partC).toBe("C");
    expect(res.partD).toBe("1");
    expect(res.formatted).toBe("A-B-C-1");
  });

  test("parses 4-part ID with full model numbers", () => {
    const res = parseEquipmentId("CAM-SONY-A7-01");
    expect(res.partA).toBe("CAM");
    expect(res.partB).toBe("SONY");
    expect(res.partC).toBe("A7");
    expect(res.partD).toBe("01");
    expect(res.formatted).toBe("CAM-SONY-A7-01");
  });
});

describe("sortEquipmentById", () => {
  test("sorts hierarchically by partA, partB, partC, and partD with natural number ordering", () => {
    const items = [
      { serial_number: "CAM-SONY-A7-10" },
      { serial_number: "CAM-SONY-A7-2" },
      { serial_number: "CAM-SONY-A7-1" },
      { serial_number: "CAM-SONY-FX3-1" },
      { serial_number: "CAM-CANON-R5-1" },
      { serial_number: "AUDIO-MIC-WIRELESS-1" },
    ];

    items.sort(sortEquipmentById);

    expect(items.map((i) => i.serial_number)).toEqual([
      "AUDIO-MIC-WIRELESS-1",
      "CAM-CANON-R5-1",
      "CAM-SONY-A7-1",
      "CAM-SONY-A7-2",
      "CAM-SONY-A7-10",
      "CAM-SONY-FX3-1",
    ]);
  });
});
