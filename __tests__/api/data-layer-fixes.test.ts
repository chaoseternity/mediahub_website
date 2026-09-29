/**
 * Regression tests for the data-layer fixes (lib/db.ts, lib/d1.ts) on an in-memory SQLite DB:
 *  - return reminders: recipient only via checked_out_by, no name matching, race-safe dedupe
 *  - profile data never matches by display name
 *  - reservation validation
 *  - storage map config validation + defensive read of stored data
 *  - SOP search treats % and _ literally
 *  - case-insensitive tag reuse
 *  - exactly one row per equipment with overlapping events / sections
 *  - roles: first user is not admin; ADMIN_EMAILS accounts can't be demoted
 *  - batch() atomicity
 *  - batch import doesn't wipe serials, protects checked-out items, reports failures
 *  - getAllEvents === getEventById per event
 *  - cancelReservation fails closed without a valid user id
 */
import { makeTestDb, setTestDb, getTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import {
  upsertUser,
  updateUserRole,
  getUserProfileData,
  createEquipment,
  updateEquipment,
  getAllEquipment,
  getEquipmentById,
  getEquipmentByTagId,
  createCheckout,
  createNfcCard,
  nfcCheckout,
  processReturnReminders,
  claimCheckoutReminder,
  getCheckoutReminders,
  createReservation,
  cancelReservation,
  saveStorageMapConfig,
  getStorageMapConfig,
  getStorageMapData,
  createSOPDocument,
  searchSOPDocuments,
  createTag,
  getAllTags,
  createEvent,
  attachEquipmentToEventSection,
  addDeploymentToEventSection,
  updateSectionRehearsalConfig,
  getAllEvents,
  getEventById,
  batchUpsertEquipment,
  ConfiguredAdminError,
  ReservationValidationError,
  StorageMapConfigError,
  InvalidTagNameError,
} from "@/lib/db";
import { batch, stmt, sql } from "@/lib/d1";
import * as emailModule from "@/lib/email";

const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

let userSeq = 0;
async function makeUser(name: string, role?: "admin" | "verified" | "viewer") {
  userSeq++;
  return upsertUser({
    name,
    email: `user${userSeq}@school.edu`,
    google_id: `g_${userSeq}`,
    image: null,
    provider: "google",
    role,
  });
}

async function makeEquipment(name: string, extra: Partial<Parameters<typeof createEquipment>[0]> = {}) {
  return createEquipment({
    name,
    tags: [],
    status: "Available",
    condition: "Working",
    location: "Media Room",
    ...extra,
  });
}

describe("data-layer fixes", () => {
  let sendEmailSpy: jest.SpyInstance;
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    setTestDb(makeTestDb());
    sendEmailSpy = jest.spyOn(emailModule, "sendOverdueReminderEmail").mockResolvedValue({ success: true });
  });

  afterEach(() => {
    sendEmailSpy.mockRestore();
    setTestDb(null);
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  // -------------------------------------------------------------------------
  describe("return reminders", () => {
    test("emails only the account in checked_out_by, even when two users share the name", async () => {
      const alex1 = await makeUser("Alex");
      await makeUser("Alex"); // same display name, different person
      const eq = await makeEquipment("Camera A");
      await createCheckout({
        equipment_id: eq.id,
        checked_out_by: alex1.id,
        checked_out_by_name: "Alex",
        expected_return_at: iso(-2 * HOUR),
      });

      const result = await processReturnReminders();
      expect(result.totalChecked).toBe(1);
      expect(result.sent).toBe(1);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy).toHaveBeenCalledWith(expect.objectContaining({ toEmail: alex1.email }));
    });

    test("NFC checkouts are never matched to an account by name", async () => {
      await makeUser("Jamie Lee"); // shares the card member's name
      const eq = await makeEquipment("Tripod");
      await createNfcCard({ nfc_value: "CARD-1", member_name: "Jamie Lee" });
      const co = await nfcCheckout({ equipmentId: eq.id, nfcValue: "CARD-1" });
      await sql`UPDATE checkouts SET expected_return_at = ${iso(-HOUR)} WHERE id = ${co.id}`;

      const result = await processReturnReminders();
      expect(sendEmailSpy).not.toHaveBeenCalled();
      expect(result.sent).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.noLinkedAccount).toBe(1);
      expect(result.reminders[0].reason).toMatch(/no linked account/i);
    });

    test("claiming a reminder window is race-safe", async () => {
      const u = await makeUser("Robin");
      const eq = await makeEquipment("Mic");
      const co = await createCheckout({
        equipment_id: eq.id,
        checked_out_by: u.id,
        checked_out_by_name: u.name,
        expected_return_at: iso(-HOUR),
      });

      const first = await claimCheckoutReminder(co.id, "overdue", u.email, "overdue:x:0");
      const second = await claimCheckoutReminder(co.id, "overdue", u.email, "overdue:x:0");
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(await getCheckoutReminders(co.id)).toHaveLength(1);
    });

    test("two concurrent runs send a given reminder only once", async () => {
      const u = await makeUser("Sam");
      const eq = await makeEquipment("Lens");
      await createCheckout({
        equipment_id: eq.id,
        checked_out_by: u.id,
        checked_out_by_name: u.name,
        expected_return_at: iso(-3 * HOUR),
      });

      const [a, b] = await Promise.all([processReturnReminders(), processReturnReminders()]);
      expect(a.sent + b.sent).toBe(1);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    });

    test("a failed send releases the claim so the next run can retry", async () => {
      const u = await makeUser("Kim");
      const eq = await makeEquipment("Drone");
      const co = await createCheckout({
        equipment_id: eq.id,
        checked_out_by: u.id,
        checked_out_by_name: u.name,
        expected_return_at: iso(-HOUR),
      });
      sendEmailSpy.mockResolvedValueOnce({ success: false, error: "SMTP down" });
      const failedRun = await processReturnReminders();
      expect(failedRun.errors).toBe(1);
      expect(await getCheckoutReminders(co.id)).toHaveLength(0);

      const retry = await processReturnReminders();
      expect(retry.sent).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("identity matching", () => {
    test("profile data never includes checkouts or NFC cards matched only by name", async () => {
      const victim = await makeUser("Taylor Swift");
      const other = await makeUser("Taylor Swift"); // same display name
      const eq1 = await makeEquipment("Cam 1");
      const eq2 = await makeEquipment("Cam 2");
      await createCheckout({ equipment_id: eq1.id, checked_out_by: victim.id, checked_out_by_name: "Taylor Swift" });
      await createNfcCard({ nfc_value: "NFC-T", member_name: "Taylor Swift" });
      await nfcCheckout({ equipmentId: eq2.id, nfcValue: "NFC-T" });

      const otherProfile = await getUserProfileData(other.id);
      expect(otherProfile!.activeEquipment).toHaveLength(0);
      expect(otherProfile!.pastEquipment).toHaveLength(0);
      expect(otherProfile!.nfcCard).toBeNull();

      const victimProfile = await getUserProfileData(victim.id);
      expect(victimProfile!.activeEquipment.map((c) => c.equipment_id)).toEqual([eq1.id]);
      expect(victimProfile!.nfcCard).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("createReservation validation", () => {
    async function reserve(equipmentId: number, userId: number, over: Record<string, unknown> = {}) {
      return createReservation({
        equipment_id: equipmentId,
        reserved_by: userId,
        reserved_by_name: "Res User",
        start_time: iso(HOUR),
        end_time: iso(3 * HOUR),
        ...over,
      } as Parameters<typeof createReservation>[0]);
    }

    test("rejects missing or unavailable equipment", async () => {
      const u = await makeUser("Res User");
      await expect(reserve(9999, u.id)).rejects.toBeInstanceOf(ReservationValidationError);
      for (const condition of ["Retired", "Missing", "Broken"] as const) {
        const eq = await makeEquipment(`Bad ${condition}`, { condition });
        await expect(reserve(eq.id, u.id)).rejects.toThrow(/cannot be reserved/);
      }
      const repairs = await makeEquipment("In repairs", { condition: "Impaired", status: "Unavailable (In Repairs)" });
      await expect(reserve(repairs.id, u.id)).rejects.toBeInstanceOf(ReservationValidationError);
    });

    test("rejects past starts (beyond 5 min skew), > 30 days, and bad notes", async () => {
      const u = await makeUser("Res User");
      const eq = await makeEquipment("Reservable");
      await expect(reserve(eq.id, u.id, { start_time: iso(-HOUR) })).rejects.toThrow(/past/);
      await expect(reserve(eq.id, u.id, { end_time: iso(31 * 24 * HOUR) })).rejects.toThrow(/30 days/);
      await expect(reserve(eq.id, u.id, { notes: "x".repeat(1001) })).rejects.toThrow(/1000/);
      await expect(reserve(eq.id, u.id, { notes: 42 })).rejects.toBeInstanceOf(ReservationValidationError);
      await expect(reserve(eq.id, u.id, { start_time: "not a date" })).rejects.toBeInstanceOf(ReservationValidationError);

      // Within the 5-minute skew is accepted.
      const ok = await reserve(eq.id, u.id, { start_time: iso(-2 * 60 * 1000), purpose: "Shoot" });
      expect(ok.status).toBe("confirmed");
      expect(ok.notes).toBe("Shoot");
    });

    test("cancelReservation fails closed for non-admins without a valid user id", async () => {
      const u = await makeUser("Owner");
      const eq = await makeEquipment("Cancel me");
      const r = await reserve(eq.id, u.id);
      for (const bad of [NaN, 0, undefined]) {
        const res = await cancelReservation(r.id, bad as unknown as number, false);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Forbidden/);
      }
      expect((await cancelReservation(r.id, u.id, false)).success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("storage map config", () => {
    test("validates and normalises on save", async () => {
      await expect(saveStorageMapConfig("nope" as never)).rejects.toBeInstanceOf(StorageMapConfigError);
      await expect(saveStorageMapConfig([{ id: "a", name: "  ", shelves: [] }])).rejects.toBeInstanceOf(StorageMapConfigError);
      await expect(saveStorageMapConfig([{ id: "a", name: "x".repeat(61), shelves: [] }])).rejects.toThrow(/60/);
      await expect(saveStorageMapConfig([{ id: "a", name: "Cab", shelves: ["ok", ""] }])).rejects.toThrow(/needs a name/);
      await expect(saveStorageMapConfig([{ id: "a", name: "Cab", shelves: [42 as never] }])).rejects.toThrow(/string/);
      await expect(
        saveStorageMapConfig(Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, shelves: [] })))
      ).rejects.toThrow(/50/);
      await expect(
        saveStorageMapConfig([{ id: "a", name: "Cab", shelves: Array.from({ length: 51 }, (_, i) => `S${i}`) }])
      ).rejects.toThrow(/50/);

      await saveStorageMapConfig([{ id: "", name: "  Main   Rack ", shelves: [" Top ", "Bottom"] }]);
      expect(await getStorageMapConfig()).toEqual([{ id: "main-rack", name: "Main Rack", shelves: ["Top", "Bottom"] }]);
    });

    test("reads stored malformed data defensively", async () => {
      const db = getTestDb();
      db.prepare("INSERT INTO storage_map_layout (key, value) VALUES ('cabinets', ?)").run(
        JSON.stringify([null, 5, { name: "" }, { name: "Good", shelves: ["A", 7, "", "B"] }, { name: "NoShelves" }])
      );
      expect(await getStorageMapConfig()).toEqual([
        { id: "good", name: "Good", shelves: ["A", "B"] },
        { id: "noshelves", name: "NoShelves", shelves: [] },
      ]);
      await makeEquipment("Stored item", { location: "Good - A" });
      const map = await getStorageMapData();
      expect(map.find((c) => c.name === "Good")?.shelves.find((s) => s.name === "A")?.items).toHaveLength(1);

      db.prepare("UPDATE storage_map_layout SET value = '{not json' WHERE key = 'cabinets'").run();
      expect(await getStorageMapConfig()).toBeNull();
      await expect(getStorageMapData()).resolves.toEqual(expect.any(Array));
    });
  });

  // -------------------------------------------------------------------------
  test("SOP search treats % and _ literally", async () => {
    await createSOPDocument({ title: "Battery at 100% charge", content: "x" });
    await createSOPDocument({ title: "Battery at 1000 charge", content: "x" });
    await createSOPDocument({ title: "file_name rules", content: "x" });
    await createSOPDocument({ title: "fileXname rules", content: "x" });

    expect((await searchSOPDocuments("100%")).map((d) => d.title)).toEqual(["Battery at 100% charge"]);
    expect((await searchSOPDocuments("file_name")).map((d) => d.title)).toEqual(["file_name rules"]);
  });

  // -------------------------------------------------------------------------
  describe("tags", () => {
    test("createTag trims, collapses whitespace and reuses a case-insensitive match", async () => {
      const a = await createTag("Laptop");
      const b = await createTag("  laptop  ");
      expect(b.id).toBe(a.id);
      const c = await createTag("Video   SD  Card");
      expect(c.name).toBe("Video SD Card");
      await expect(createTag("   ")).rejects.toBeInstanceOf(InvalidTagNameError);
      expect((await getAllTags()).map((t) => t.name).sort()).toEqual(["Laptop", "Video SD Card"]);
    });

    test("createEquipment / updateEquipment reuse existing tags case-insensitively", async () => {
      const tag = await createTag("Camera");
      const eq = await makeEquipment("FX3", { tags: ["CAMERA", "camera ", "Rental"] });
      expect(eq.tags.sort()).toEqual(["Camera", "Rental"]);
      await updateEquipment(eq.id, { tags: ["rental", "  camera"] });
      const updated = await getEquipmentById(eq.id);
      expect(updated!.tags.sort()).toEqual(["Camera", "Rental"]);
      expect((await getAllTags()).length).toBe(2);
      expect((await getEquipmentByTagId(tag.id)).map((e) => e.id)).toEqual([eq.id]);
    });
  });

  // -------------------------------------------------------------------------
  test("exactly one row per equipment with overlapping events and mixed rehearsal sections", async () => {
    const admin = await makeUser("Event Admin", "admin");
    const tag = await createTag("Kit");
    const eq = await makeEquipment("Shared Cam", { tags: ["Kit"] });
    const other = await makeEquipment("Other Cam", { tags: ["Kit"] });

    const ev1 = await createEvent({
      name: "Concert",
      start_time: iso(-HOUR),
      end_time: iso(3 * HOUR),
      location: "Hall",
      created_by: admin.id,
      has_rehearsal: true,
      rehearsal_start_time: iso(-30 * 60 * 1000),
      rehearsal_end_time: iso(30 * 60 * 1000),
    });
    const ev2 = await createEvent({
      name: "Assembly",
      start_time: iso(-2 * HOUR),
      end_time: iso(5 * HOUR),
      location: "Field",
      created_by: admin.id,
    });
    await attachEquipmentToEventSection(ev1.id, eq.id, "photo", true);
    await attachEquipmentToEventSection(ev1.id, eq.id, "video", false);
    await attachEquipmentToEventSection(ev2.id, eq.id, "av", false);
    await attachEquipmentToEventSection(ev2.id, other.id, "av", false);

    const all = await getAllEquipment();
    expect(all.filter((e) => e.id === eq.id)).toHaveLength(1);
    expect(all).toHaveLength(2);
    const row = all.find((e) => e.id === eq.id)!;
    expect(row.active_event_id).toBe(ev1.id); // ends first (rehearsal window)
    expect(row.is_rehearsal).toBe(true);
    expect(row.status).toBe("In Event (Rehearsal)");
    expect(row.tags).toEqual(["Kit"]);

    const otherRow = all.find((e) => e.id === other.id)!;
    expect(otherRow.active_event_id).toBe(ev2.id);
    expect(otherRow.is_rehearsal).toBe(false);
    expect(otherRow.status).toBe("In Event");

    expect((await getEquipmentByTagId(tag.id)).filter((e) => e.id === eq.id)).toHaveLength(1);
    const detail = await getEquipmentById(eq.id);
    expect(detail!.status).toBe("In Event (Rehearsal)");
    expect(detail!.event_logs!.every((l) => typeof l.is_rehearsal === "boolean")).toBe(true);
  });

  // -------------------------------------------------------------------------
  describe("roles", () => {
    test("the first user to sign in is not made admin", async () => {
      delete process.env.ADMIN_EMAILS;
      const first = await upsertUser({ name: "First", email: "first@school.edu", google_id: "g1", image: null, provider: "google" });
      expect(first.role).toBe("viewer");
    });

    test("ADMIN_EMAILS accounts cannot be demoted", async () => {
      process.env.ADMIN_EMAILS = "boss@school.edu";
      const boss = await upsertUser({ name: "Boss", email: "boss@school.edu", google_id: "gb", image: null, provider: "google" });
      await makeUser("Second Admin", "admin");
      expect(boss.role).toBe("admin");
      await expect(updateUserRole(boss.id, "viewer")).rejects.toBeInstanceOf(ConfiguredAdminError);
      await expect(updateUserRole(boss.id, "viewer")).rejects.toThrow(/ADMIN_EMAILS/);
    });
  });

  // -------------------------------------------------------------------------
  test("batch() is atomic: a failing statement rolls back earlier ones", async () => {
    await expect(
      batch([
        stmt`INSERT INTO tags (name) VALUES (${"Rolled Back"})`,
        stmt`INSERT INTO equipment (name, location, condition) VALUES (${"Bad"}, ${"X"}, ${"NotACondition"})`,
      ])
    ).rejects.toThrow();
    expect((await getAllTags()).find((t) => t.name === "Rolled Back")).toBeUndefined();

    const results = await batch<{ id: number }>([
      stmt`INSERT INTO tags (name) VALUES (${"Kept"}) RETURNING id`,
      stmt`UPDATE tags SET name = ${"Kept 2"} WHERE name = ${"Kept"}`,
    ]);
    expect(results[0].rows[0].id).toEqual(expect.any(Number));
    expect(results[1].rowCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  describe("batchUpsertEquipment", () => {
    test("a row without a serial number does not wipe the stored serial", async () => {
      const eq = await makeEquipment("Sony A7", { serial_number: "SN-123" });
      const res = await batchUpsertEquipment([
        { name: "Sony A7", serial_number: null, tags: [], description: "Updated", condition: "Working", location: "Shelf" },
      ]);
      expect(res.updatedCount).toBe(1);
      const after = await getEquipmentById(eq.id);
      expect(after!.serial_number).toBe("SN-123");
      expect(after!.description).toBe("Updated");
    });

    test("keeps the status of a checked-out item set to Missing, with a notice", async () => {
      const u = await makeUser("Borrower");
      const eq = await makeEquipment("Out Cam", { serial_number: "OUT-1" });
      await createCheckout({ equipment_id: eq.id, checked_out_by: u.id, checked_out_by_name: u.name });

      const res = await batchUpsertEquipment([
        { name: "Out Cam", serial_number: "OUT-1", tags: [], condition: "Missing", location: "Media Room" },
      ]);
      const after = await getEquipmentById(eq.id);
      expect(after!.condition).toBe("Missing");
      expect(after!.status).toBe("Checked Out");
      expect(after!.active_checkout).not.toBeNull();
      expect(res.notices.some((n) => /checked out/.test(n))).toBe(true);
      expect(res.partial).toBe(false);
    });

    test("reports failed rows accurately and keeps going", async () => {
      const res = await batchUpsertEquipment([
        { name: "Good 1", serial_number: "G1", tags: ["Kit"], condition: "Working", location: "A" },
        { name: "Bad", serial_number: "B1", tags: ["x".repeat(60)], condition: "Working", location: "A" },
        { name: "Good 2", serial_number: "G2", tags: ["kit"], condition: "Broken", location: "A" },
      ]);
      expect(res.createdCount).toBe(2);
      expect(res.failedCount).toBe(1);
      expect(res.partial).toBe(true);
      expect(res.failed[0]).toEqual(expect.objectContaining({ kind: "item", index: 1, name: "Bad" }));
      expect(res.errors[0]).toMatch(/Bad/);

      const all = await getAllEquipment();
      expect(all.map((e) => e.name).sort()).toEqual(["Good 1", "Good 2"]);
      expect(all.find((e) => e.name === "Good 2")!.status).toBe("Unavailable (Broken)");
      expect(all.every((e) => e.tags.length === 1 && e.tags[0] === "Kit")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  test("getAllEvents returns exactly what getEventById returns for each event", async () => {
    const admin = await makeUser("Zed Admin", "admin");
    const crew = await makeUser("Amy Crew");
    const eq = await makeEquipment("Event Cam", { tags: ["Kit"] });
    const eq2 = await makeEquipment("Event Mic");

    const ev1 = await createEvent({
      name: "Gala",
      start_time: iso(24 * HOUR),
      end_time: iso(26 * HOUR),
      location: "Hall",
      created_by: admin.id,
      has_rehearsal: true,
      rehearsal_start_time: iso(20 * HOUR),
      rehearsal_end_time: iso(21 * HOUR),
      oic_user_ids: [admin.id, crew.id],
      photo_ic_ids: [crew.id],
      av_ic_ids: [admin.id],
    });
    const ev2 = await createEvent({
      name: "Sports Day",
      start_time: iso(-48 * HOUR),
      end_time: iso(-40 * HOUR),
      location: "Field",
      created_by: admin.id,
    });
    await createEvent({ name: "Empty", start_time: iso(HOUR), end_time: iso(2 * HOUR), location: "Room", created_by: null });

    await attachEquipmentToEventSection(ev1.id, eq.id, "photo", true);
    await attachEquipmentToEventSection(ev1.id, eq2.id, "av", false);
    await attachEquipmentToEventSection(ev2.id, eq.id, "video", false);
    await addDeploymentToEventSection(ev1.id, crew.id, "photo", true);
    await addDeploymentToEventSection(ev2.id, admin.id, "video", false);
    await updateSectionRehearsalConfig(ev1.id, "photo", true);

    const all = await getAllEvents();
    expect(all).toHaveLength(3);
    for (const ev of all) {
      expect(ev).toEqual(await getEventById(ev.id));
    }

    const gala = all.find((e) => e.id === ev1.id)!;
    expect(gala.has_rehearsal).toBe(true);
    expect(gala.section_rehearsals.photo.participating).toBe(true);
    expect(gala.section_equipment.photo[0].used_for_rehearsal).toBe(true);
    expect(gala.section_deployments.photo[0].attending_rehearsal).toBe(true);
    expect(gala.oics.map((o) => o.name)).toEqual(["Amy Crew", "Zed Admin"]);
    // Privacy: no email / google_id / response_token in event data.
    const json = JSON.stringify(all);
    expect(json).not.toMatch(/email|google_id|response_token/);
  });
});

// ---------------------------------------------------------------------------
describe("ensureSchema on D1", () => {
  const g = globalThis as { env?: unknown };

  afterEach(() => {
    delete g.env;
    jest.restoreAllMocks();
  });

  test("runs a single memoised probe and logs missing tables without issuing DDL", async () => {
    const prepared: string[] = [];
    const fakeD1 = {
      prepare(q: string) {
        prepared.push(q);
        return {
          all: async () => ({ results: [{ type: "table", name: "users" }] }),
          bind() {
            return this;
          },
          run: async () => ({ meta: { changes: 0 } }),
        };
      },
    };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await jest.isolateModulesAsync(async () => {
      const d1 = await import("@/lib/d1");
      d1.setTestDb(null);
      g.env = { DB: fakeD1 };
      await d1.ensureSchema();
      await d1.ensureSchema();
      await d1.ensureSchema();
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatch(/sqlite_master/);
    expect(prepared.some((q) => /CREATE/i.test(q))).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/Missing tables: .*equipment/);
  });
});
