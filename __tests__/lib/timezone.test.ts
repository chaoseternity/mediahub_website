import { parseDbDate, endOfAppDay, formatDateTime, parseDueDate, formatDate } from "@/lib/timezone";
test("tz", () => {
  expect(parseDbDate("2026-09-29 06:05:00")!.toISOString()).toBe("2026-09-29T06:05:00.000Z");
  expect(endOfAppDay("2026-10-01").toISOString()).toBe("2026-10-01T15:59:59.999Z");
  expect(formatDateTime("2026-09-29 06:05:00")).toBe("29 Sept 2026, 14:05");
  expect(parseDueDate("2026-10-01T10:00:00.000Z")!.toISOString()).toBe("2026-10-01T10:00:00.000Z");
  expect(formatDate("2026-10-01")).toBe("1 Oct 2026");
  expect(formatDateTime(null)).toBe("—");
});
