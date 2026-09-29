/**
 * Data-integrity regression tests (real lib/db.ts helpers on an in-memory SQLite DB):
 *  - concurrent double checkout is rejected (atomic claim + one-open-checkout index)
 *  - display-only "In Event" status is never persisted by updateEquipment
 *  - deleting equipment with history retires it instead of wiping the history
 *  - ISO event timestamps are compared correctly against "now" within the same day
 *  - reservation conflict check + insert is race-safe and stores ISO timestamps
 *  - deleting a user keeps the audit sessions/records they started
 */
import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import {
  createEquipment,
  createCheckout,
  returnCheckout,
  getEquipmentById,
  getAllEquipment,
  updateEquipment,
  deleteEquipment,
  batchUpsertEquipment,
  createReservation,
  upsertUser,
  deleteUser,
} from "@/lib/db";

const HOUR = 60 * 60 * 1000;

describe("Data integrity", () => {
  let db: any;

  beforeEach(() => {
    db = makeTestDb();
    setTestDb(db);
  });

  afterEach(() => {
    setTestDb(null);
    db.close();
  });

  async function makeItem(name = "Sony FX3") {
    return createEquipment({
      name,
      tags: [],
      condition: "Working",
      location: "Cabinet 1",
      status: "Available",
    });
  }

  function rawEquipment(id: number) {
    return db.prepare("SELECT status, condition FROM equipment WHERE id = ?").get(id) as {
      status: string;
      condition: string;
    };
  }

  /** Inserts an event whose times are ISO strings (as the frontend sends via toISOString). */
  function insertEvent(startMs: number, endMs: number, name = "Assembly") {
    const id = db
      .prepare("INSERT INTO events (name, start_time, end_time, location) VALUES (?, ?, ?, 'Hall')")
      .run(name, new Date(startMs).toISOString(), new Date(endMs).toISOString()).lastInsertRowid as number;
    return id;
  }

  // ── Item 8: double checkout ─────────────────────────────────────────────────

  test("concurrent checkouts of the same item: exactly one succeeds", async () => {
    const eq = await makeItem();
    const results = await Promise.allSettled([
      createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Alice" }),
      createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Bob" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason?.message)).toMatch(
      /Equipment is already checked out\.|Equipment is not available for checkout/
    );

    const open = db
      .prepare("SELECT COUNT(*) AS n FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
      .get(eq.id) as { n: number };
    expect(open.n).toBe(1);
    expect(rawEquipment(eq.id).status).toBe("Checked Out");
  });

  test("sequential second checkout is rejected with the existing message", async () => {
    const eq = await makeItem();
    await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Alice" });
    await expect(
      createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Bob" })
    ).rejects.toThrow("Equipment is not available for checkout (current status: Checked Out).");
  });

  test("the database refuses a second open checkout for the same item", async () => {
    const eq = await makeItem();
    await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Alice" });
    expect(() =>
      db.prepare("INSERT INTO checkouts (equipment_id, checked_out_by_name) VALUES (?, 'Mallory')").run(eq.id)
    ).toThrow(/UNIQUE/);
  });

  test("returning an item whose condition became Broken leaves it Unavailable (Broken)", async () => {
    const eq = await makeItem();
    await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Alice" });
    db.prepare("UPDATE equipment SET condition = 'Broken' WHERE id = ?").run(eq.id);
    await returnCheckout(eq.id);
    expect(rawEquipment(eq.id).status).toBe("Unavailable (Broken)");
  });

  // ── Item 9: timestamp comparisons ───────────────────────────────────────────

  test("an ISO-timestamped event running right now marks its equipment In Event", async () => {
    const eq = await makeItem();
    const now = Date.now();
    const evId = insertEvent(now - 5 * 60 * 1000, now + 5 * 60 * 1000);
    db.prepare("INSERT INTO event_equipment (event_id, equipment_id) VALUES (?, ?)").run(evId, eq.id);

    const detail = await getEquipmentById(eq.id);
    expect(detail?.active_event_id).toBe(evId);
    expect(detail?.status).toBe("In Event");

    const listed = (await getAllEquipment()).find((e) => e.id === eq.id);
    expect(listed?.status).toBe("In Event");
  });

  test("an ISO-timestamped event that ended minutes ago is not active", async () => {
    const eq = await makeItem();
    const now = Date.now();
    const evId = insertEvent(now - 10 * 60 * 1000, now - 60 * 1000);
    db.prepare("INSERT INTO event_equipment (event_id, equipment_id) VALUES (?, ?)").run(evId, eq.id);

    const detail = await getEquipmentById(eq.id);
    expect(detail?.active_event_id ?? null).toBeNull();
    expect(detail?.status).toBe("Available");
  });

  // ── Item 10: display-only status not persisted ──────────────────────────────

  test("editing an item during an event does not persist the In Event display status", async () => {
    const eq = await makeItem();
    const now = Date.now();
    const evId = insertEvent(now - HOUR, now + HOUR);
    db.prepare("INSERT INTO event_equipment (event_id, equipment_id) VALUES (?, ?)").run(evId, eq.id);
    expect((await getEquipmentById(eq.id))?.status).toBe("In Event");

    const updated = await updateEquipment(eq.id, { name: "Sony FX3 (A)", location: "Cabinet 2" });
    expect(updated?.name).toBe("Sony FX3 (A)");
    expect(rawEquipment(eq.id).status).toBe("Available");

    // Once the event is over the item is plainly Available again.
    db.prepare("DELETE FROM event_equipment WHERE event_id = ?").run(evId);
    expect((await getEquipmentById(eq.id))?.status).toBe("Available");
  });

  // ── Item 11: deletes must not wipe history ──────────────────────────────────

  test("deleting equipment without history hard-deletes it", async () => {
    const eq = await makeItem();
    const result = await deleteEquipment(eq.id);
    expect(result).toEqual({ success: true, retired: false });
    expect(db.prepare("SELECT id FROM equipment WHERE id = ?").get(eq.id)).toBeUndefined();
  });

  test("deleting equipment with checkout history retires it and keeps the history", async () => {
    const eq = await makeItem();
    await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Alice" });
    await returnCheckout(eq.id);

    const result = await deleteEquipment(eq.id);
    expect(result.success).toBe(true);
    expect(result.retired).toBe(true);
    expect(rawEquipment(eq.id)).toEqual({ status: "Unavailable (Retired)", condition: "Retired" });
    const history = db.prepare("SELECT COUNT(*) AS n FROM checkouts WHERE equipment_id = ?").get(eq.id) as { n: number };
    expect(history.n).toBe(1);
  });

  test("deleting equipment with an open checkout is still blocked", async () => {
    const eq = await makeItem();
    await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Alice" });
    const result = await deleteEquipment(eq.id);
    expect(result).toEqual({ success: false, error: "Cannot delete equipment with an active checkout." });
  });

  test("deleting equipment used in a same-day ongoing ISO event is blocked", async () => {
    const eq = await makeItem();
    const now = Date.now();
    const evId = insertEvent(now - 60 * 1000, now + 60 * 1000, "Speech Day");
    db.prepare("INSERT INTO event_equipment (event_id, equipment_id) VALUES (?, ?)").run(evId, eq.id);
    const result = await deleteEquipment(eq.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Speech Day");
  });

  test("batch deleteMissingIds retires items with history and reports it", async () => {
    const keep = await makeItem("Keep");
    const used = await makeItem("Used");
    const unused = await makeItem("Unused");
    await createCheckout({ equipment_id: used.id, checked_out_by: null, checked_out_by_name: "Alice" });
    await returnCheckout(used.id);

    const result = await batchUpsertEquipment(
      [{ name: "Keep", tags: [], condition: "Working", location: "Cabinet 1" }],
      [used.id, unused.id]
    );
    expect(result.deletedCount).toBe(1);
    expect(result.retiredCount).toBe(1);
    expect(result.errors.some((e) => e.includes("retired instead of deleted"))).toBe(true);
    expect(rawEquipment(used.id).condition).toBe("Retired");
    expect(db.prepare("SELECT id FROM equipment WHERE id = ?").get(unused.id)).toBeUndefined();
    expect(rawEquipment(keep.id).status).toBe("Available");
  });

  test("deleting a user keeps the audit sessions and records they started", async () => {
    // First user becomes admin automatically; create them first so the auditor can be deleted.
    await upsertUser({
      name: "Head Admin",
      email: "admin@school.edu",
      google_id: "g_admin",
      image: null,
      provider: "google",
    });
    const auditor = await upsertUser({
      name: "Audrey Auditor",
      email: "audrey@school.edu",
      google_id: "g_audrey",
      image: null,
      provider: "google",
    });
    const eq = await makeItem();
    const sessionId = db
      .prepare("INSERT INTO audit_sessions (name, started_by, status) VALUES ('Term audit', ?, 'completed')")
      .run(auditor.id).lastInsertRowid as number;
    db.prepare(
      "INSERT INTO audit_records (session_id, equipment_id, status, scanned_by, method) VALUES (?, ?, 'exists', ?, 'nfc')"
    ).run(sessionId, eq.id, auditor.id);

    const result = await deleteUser(auditor.id);
    expect(result.success).toBe(true);

    const session = db.prepare("SELECT * FROM audit_sessions WHERE id = ?").get(sessionId);
    expect(session).toMatchObject({ started_by: null, started_by_name: "Audrey Auditor" });
    const record = db.prepare("SELECT * FROM audit_records WHERE session_id = ?").get(sessionId);
    expect(record).toMatchObject({ equipment_id: eq.id, scanned_by: null, status: "exists" });
  });

  // ── Reservations: race-safe insert + ISO storage ────────────────────────────

  test("concurrent overlapping reservations: exactly one is created", async () => {
    const user = await upsertUser({
      name: "Bob",
      email: "bob@school.edu",
      google_id: "g_bob",
      image: null,
      provider: "google",
    });
    const eq = await makeItem();
    const start = new Date(Date.now() + 24 * HOUR).toISOString();
    const end = new Date(Date.now() + 26 * HOUR).toISOString();
    const make = () =>
      createReservation({
        equipment_id: eq.id,
        reserved_by: user.id,
        reserved_by_name: user.name,
        start_time: start,
        end_time: end,
      });
    const results = await Promise.allSettled([make(), make(), make()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected") as PromiseRejectedResult[]) {
      expect(String(r.reason?.message)).toContain("already reserved");
    }
  });

  test("reservation times are stored as ISO and overlap is detected across formats", async () => {
    const user = await upsertUser({
      name: "Cara",
      email: "cara@school.edu",
      google_id: "g_cara",
      image: null,
      provider: "google",
    });
    const eq = await makeItem();
    const res = await createReservation({
      equipment_id: eq.id,
      reserved_by: user.id,
      reserved_by_name: user.name,
      start_time: "2030-01-01T10:00:00Z",
      end_time: "2030-01-01T12:00:00Z",
    });
    expect(res.start_time).toBe("2030-01-01T10:00:00.000Z");
    expect(res.end_time).toBe("2030-01-01T12:00:00.000Z");

    // A legacy row stored in SQLite's "YYYY-MM-DD HH:MM:SS" format must still conflict.
    db.prepare(
      "INSERT INTO reservations (equipment_id, reserved_by, reserved_by_name, start_time, end_time) VALUES (?, ?, ?, '2030-01-02 10:00:00', '2030-01-02 12:00:00')"
    ).run(eq.id, user.id, user.name);
    await expect(
      createReservation({
        equipment_id: eq.id,
        reserved_by: user.id,
        reserved_by_name: user.name,
        start_time: "2030-01-02T11:00:00.000Z",
        end_time: "2030-01-02T13:00:00.000Z",
      })
    ).rejects.toThrow("already reserved");
  });
});
