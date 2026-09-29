/**
 * Error handling, status codes and input validation across API routes:
 * - unexpected (internal) errors never leak their message
 * - business errors map to the right 4xx
 * - malformed / wrongly-typed bodies are rejected with 400
 */
import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import * as db from "@/lib/db";
import { createEquipment, upsertUser, createReservation, createEvent, startAuditSession, createCheckout } from "@/lib/db";
import * as emailModule from "@/lib/email";
import * as webhookModule from "@/lib/webhook";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";
import { POST as createReservationRoute, GET as listReservationsRoute } from "@/app/api/reservations/route";
import { DELETE as cancelReservationRoute, PATCH as patchReservationRoute } from "@/app/api/reservations/[id]/route";
import { GET as storageMapGet, POST as storageMapPost } from "@/app/api/storage-map/route";
import { PUT as updateEventRoute } from "@/app/api/events/[id]/route";
import { POST as createEquipmentRoute } from "@/app/api/equipment/route";
import { PUT as updateEquipmentRoute } from "@/app/api/equipment/[id]/route";
import { POST as batchRoute } from "@/app/api/equipment/batch/route";
import { GET as rsvpGet } from "@/app/api/rsvp/route";
import { POST as claimRoute } from "@/app/api/handover/claim/route";
import { POST as auditSessionPost } from "@/app/api/audit/session/route";
import { POST as auditScanPost } from "@/app/api/audit/scan/route";
import { POST as auditCompletePost } from "@/app/api/audit/complete/route";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/reminders/route";
import { POST as parseSop } from "@/app/api/sop/parse/route";
import { POST as uploadSop } from "@/app/api/sop/route";
import { POST as webhookTest } from "@/app/api/webhooks/test/route";
import { PUT as updateUserRoute } from "@/app/api/users/[id]/route";
import { POST as checkoutRoute } from "@/app/api/equipment/[id]/checkout/route";
import { POST as sectionRoute } from "@/app/api/events/[id]/section/route";
import { POST as createTagRoute } from "@/app/api/tags/route";
import { timingSafeEqualString } from "@/lib/request-security";
import { classifyError, classifyErrorMessage, toErrorResponse } from "@/lib/api-errors";
import type { Role } from "@/lib/types";

const HOUR = 3600 * 1000;
const INTERNAL = "D1_ERROR: UNIQUE constraint failed: reservations.id: SQLITE_CONSTRAINT";

async function makeUser(name: string, role: Role) {
  const slug = name.toLowerCase().replace(/\s+/g, ".");
  return upsertUser({ name, email: `${slug}@school.edu`, google_id: `g_${slug}`, image: null, provider: "google", role });
}

function asUser(user: { id: number; email: string; name: string }, role: Role) {
  (auth as jest.Mock).mockResolvedValue({
    user: { id: String(user.id), email: user.email, name: user.name, role },
  });
}

async function asAdmin() {
  const admin = await makeUser("Admin Ada", "admin");
  asUser(admin, "admin");
  return admin;
}

function jsonReq(url: string, method: string, body: unknown, raw = false) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function makeItem(name = "Camera", serial?: string) {
  return createEquipment({
    name,
    serial_number: serial,
    tags: [],
    status: "Available",
    condition: "Working",
    location: "Cabinet 1",
  });
}

describe("API error handling & validation", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    setTestDb(makeTestDb());
    (auth as jest.Mock).mockResolvedValue(null);
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setTestDb(null);
  });

  describe("lib/api-errors classification", () => {
    test("internal driver errors are never classified as business errors", () => {
      expect(classifyError(new Error(INTERNAL))).toBeNull();
      expect(classifyError(new Error("D1_TYPE_ERROR: Type 'undefined' not supported"))).toBeNull();
      expect(classifyError(new Error("no such table: reservations (not found)"))).toBeNull();
      expect(classifyError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBeNull();
      expect(classifyError("a string")).toBeNull();
    });

    test("business errors map to 4xx", () => {
      expect(classifyErrorMessage("Forbidden: You can only cancel your own reservations.")).toBe(403);
      expect(classifyErrorMessage("Reservation not found.")).toBe(404);
      expect(classifyErrorMessage("Equipment already reserved between a and b.")).toBe(409);
      expect(classifyErrorMessage("Invalid timeframe: start_time must be strictly before end_time.")).toBe(400);
      expect(classifyErrorMessage("Handover code has expired. Please ask the borrower.")).toBe(410);
      expect(classifyErrorMessage("Handover is not available for equipment checked out through the NFC station.")).toBe(400);
      expect(classifyErrorMessage("Equipment is not available for checkout (current status: Checked Out).")).toBe(409);
      expect(classifyErrorMessage("Something odd happened")).toBeNull();
    });

    test("toErrorResponse logs unknown errors and returns a generic 500", async () => {
      const res = toErrorResponse(new Error(INTERNAL), "Failed to do the thing");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Failed to do the thing" });
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe("no internal error leakage", () => {
    test("reservation POST masks an unexpected DB error", async () => {
      await asAdmin();
      const eq = await makeItem();
      jest.spyOn(db, "createReservation").mockRejectedValue(new Error(INTERNAL));
      const res = await createReservationRoute(
        jsonReq("/api/reservations", "POST", {
          equipment_id: eq.id,
          start_time: new Date(Date.now() + HOUR).toISOString(),
          end_time: new Date(Date.now() + 2 * HOUR).toISOString(),
        })
      );
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Failed to create reservation.");
      expect(JSON.stringify(body)).not.toMatch(/D1|SQLITE|UNIQUE/);
    });

    test("public RSVP GET masks an unexpected DB error", async () => {
      jest.spyOn(db, "getDeploymentByToken").mockRejectedValue(new Error(INTERNAL));
      const res = await rsvpGet(new NextRequest("http://localhost/api/rsvp?token=abc123"));
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toMatch(/D1|SQLITE|UNIQUE/);
    });

    test("storage map GET returns a generic 500 instead of crashing", async () => {
      await asAdmin();
      jest.spyOn(db, "getStorageMapData").mockRejectedValue(new Error(INTERNAL));
      const res = await storageMapGet();
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("Failed to load storage map");
    });

    test("equipment update masks a TypeError", async () => {
      await asAdmin();
      const eq = await makeItem();
      jest.spyOn(db, "updateEquipment").mockRejectedValue(new TypeError("Cannot read properties of undefined"));
      const res = await updateEquipmentRoute(jsonReq(`/api/equipment/${eq.id}`, "PUT", { name: "New" }), {
        params: Promise.resolve({ id: String(eq.id) }),
      });
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe("Failed to update equipment");
    });

    test("SOP parse never returns raw parser errors", async () => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "admin", email: "a@b.c", name: "A" } });
      const docParser = await import("@/lib/doc-parser");
      jest.spyOn(docParser, "extractTextFromDocument").mockRejectedValue(new Error("zlib: invalid stored block lengths at 0x1f"));
      const file = { name: "a.pdf", size: 10, type: "application/pdf", arrayBuffer: async () => new ArrayBuffer(10) };
      const req = { headers: new Headers(), formData: async () => ({ get: (k: string) => (k === "file" ? file : null) }) };
      const res = await parseSop(req as unknown as NextRequest);
      expect(res.status).toBe(422);
      expect((await res.json()).error).not.toMatch(/zlib/);
    });
  });

  describe("reservations", () => {
    test("malformed JSON, null body and bad fields → 400 (not 409)", async () => {
      await asAdmin();
      const eq = await makeItem();
      const start = new Date(Date.now() + HOUR).toISOString();
      const end = new Date(Date.now() + 2 * HOUR).toISOString();
      const cases: Array<[unknown, boolean?]> = [
        ["{ not json", true],
        ["null", true],
        [{ equipment_id: "abc", start_time: start, end_time: end }],
        [{ equipment_id: -1, start_time: start, end_time: end }],
        [{ equipment_id: eq.id, start_time: "not a date", end_time: end }],
        [{ equipment_id: eq.id, start_time: start }],
        [{ equipment_id: eq.id, start_time: end, end_time: start }],
        [{ equipment_id: eq.id, start_time: start, end_time: end, notes: 5 }],
        [{ equipment_id: eq.id, start_time: start, end_time: end, purpose: "x".repeat(1001) }],
      ];
      for (const [body, raw] of cases) {
        const res = await createReservationRoute(jsonReq("/api/reservations", "POST", body, raw));
        expect(res.status).toBe(400);
        expect(typeof (await res.json()).error).toBe("string");
      }
    });

    test("accepts the legacy start_date/end_date aliases", async () => {
      await asAdmin();
      const eq = await makeItem();
      const res = await createReservationRoute(
        jsonReq("/api/reservations", "POST", {
          equipment_id: eq.id,
          start_date: new Date(Date.now() + HOUR).toISOString(),
          end_date: new Date(Date.now() + 2 * HOUR).toISOString(),
          purpose: "Shoot",
        })
      );
      expect(res.status).toBe(201);
    });

    test("invalid status filter → 400", async () => {
      await asAdmin();
      const res = await listReservationsRoute(new NextRequest("http://localhost/api/reservations?status=bogus"));
      expect(res.status).toBe(400);
    });

    test("cancel: unknown → 404, forbidden → 403, already cancelled → 4xx", async () => {
      const admin = await asAdmin();
      const eq = await makeItem();
      const r = await createReservation({
        equipment_id: eq.id,
        reserved_by: admin.id,
        reserved_by_name: admin.name,
        start_time: new Date(Date.now() + HOUR).toISOString(),
        end_time: new Date(Date.now() + 2 * HOUR).toISOString(),
      });
      const del = (id: number) =>
        cancelReservationRoute(new NextRequest(`http://localhost/api/reservations/${id}`, { method: "DELETE" }), {
          params: Promise.resolve({ id: String(id) }),
        });

      expect((await del(99999)).status).toBe(404);
      expect((await del(r.id)).status).toBe(200);
      const again = await del(r.id);
      expect(again.status).toBeGreaterThanOrEqual(400);
      expect(again.status).toBeLessThan(500);

      jest
        .spyOn(db, "cancelReservation")
        .mockResolvedValue({ success: false, error: "Forbidden: You can only cancel your own reservations." });
      expect((await del(r.id)).status).toBe(403);
    });

    test("PATCH rejects malformed JSON and unknown actions", async () => {
      await asAdmin();
      const params = { params: Promise.resolve({ id: "1" }) };
      expect((await patchReservationRoute(jsonReq("/api/reservations/1", "PATCH", "{", true), params)).status).toBe(400);
      expect(
        (await patchReservationRoute(jsonReq("/api/reservations/1", "PATCH", { action: "explode" }), params)).status
      ).toBe(400);
    });
  });

  describe("storage map validation", () => {
    test.each([
      [{ action: "save_config", cabinets: "nope" }],
      [{ action: "save_config", cabinets: [{ id: "a", name: "A", shelves: [1, 2] }] }],
      [{ action: "save_config", cabinets: [{ id: "a", name: "x".repeat(101), shelves: [] }] }],
      [{ action: "save_config", cabinets: [{ name: "A", shelves: [] }] }],
      [{ action: "save_config", cabinets: Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, shelves: [] })) }],
      [{ action: "move_item", equipment_id: 1, cabinet: "", shelf: "A" }],
      [{ action: "move_item", equipment_id: "x", cabinet: "C", shelf: "A" }],
      [{ action: "move_item", equipment_id: 1, cabinet: { a: 1 }, shelf: "A" }],
      [{ action: "unknown" }],
    ])("rejects invalid payload %# with 400", async (payload) => {
      await asAdmin();
      const res = await storageMapPost(jsonReq("/api/storage-map", "POST", payload));
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    });

    test("rejects malformed JSON with 400", async () => {
      await asAdmin();
      const res = await storageMapPost(jsonReq("/api/storage-map", "POST", "{bad", true));
      expect(res.status).toBe(400);
    });
  });

  describe("events PUT validates merged times", () => {
    async function seedEvent(withRehearsal = false) {
      const admin = await asAdmin();
      const start = Date.now() + 10 * HOUR;
      const event = await createEvent({
        name: "Gala",
        start_time: new Date(start).toISOString(),
        end_time: new Date(start + 3 * HOUR).toISOString(),
        location: "Hall",
        created_by: admin.id,
        has_rehearsal: withRehearsal,
        rehearsal_start_time: withRehearsal ? new Date(start - 5 * HOUR).toISOString() : undefined,
        rehearsal_end_time: withRehearsal ? new Date(start - 4 * HOUR).toISOString() : undefined,
      });
      return { event, start };
    }
    const put = (id: number, body: unknown) =>
      updateEventRoute(jsonReq(`/api/events/${id}`, "PUT", body), { params: Promise.resolve({ id: String(id) }) });

    test("end_time alone earlier than the stored start → 400", async () => {
      const { event, start } = await seedEvent();
      const res = await put(event.id, { end_time: new Date(start - HOUR).toISOString() });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/end time/i);
    });

    test("start_time alone after the stored end → 400; valid partial update → 200", async () => {
      const { event, start } = await seedEvent();
      expect((await put(event.id, { start_time: new Date(start + 5 * HOUR).toISOString() })).status).toBe(400);
      expect((await put(event.id, { start_time: new Date(start + HOUR).toISOString() })).status).toBe(200);
    });

    test("rehearsal end alone before the stored rehearsal start → 400", async () => {
      const { event, start } = await seedEvent(true);
      const res = await put(event.id, { rehearsal_end_time: new Date(start - 6 * HOUR).toISOString() });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/rehearsal/i);
    });

    test("enabling a rehearsal without times → 400", async () => {
      const { event } = await seedEvent(false);
      expect((await put(event.id, { has_rehearsal: true })).status).toBe(400);
    });
  });

  describe("equipment manual statuses", () => {
    test.each(["Checked Out", "In Event", "In Event (Rehearsal)"])("POST rejects derived status %s", async (status) => {
      await asAdmin();
      const res = await createEquipmentRoute(
        jsonReq("/api/equipment", "POST", { name: "Cam", tags: ["camera"], location: "Room", status })
      );
      expect(res.status).toBe(400);
    });

    test.each(["Checked Out", "In Event", "In Event (Rehearsal)"])("PUT rejects derived status %s", async (status) => {
      await asAdmin();
      const eq = await makeItem();
      const res = await updateEquipmentRoute(jsonReq(`/api/equipment/${eq.id}`, "PUT", { status }), {
        params: Promise.resolve({ id: String(eq.id) }),
      });
      expect(res.status).toBe(400);
    });

    test("PUT accepts manual Unavailable statuses; verified users only change the description", async () => {
      const admin = await asAdmin();
      const eq = await makeItem();
      const params = { params: Promise.resolve({ id: String(eq.id) }) };
      expect((await updateEquipmentRoute(jsonReq(`/api/equipment/${eq.id}`, "PUT", { status: "Unavailable (In Repairs)" }), params)).status).toBe(200);

      const member = await makeUser("Vera Verified", "verified");
      asUser(member, "verified");
      const res = await updateEquipmentRoute(
        jsonReq(`/api/equipment/${eq.id}`, "PUT", { description: "Updated", name: "Hacked", status: "Available" }),
        { params: Promise.resolve({ id: String(eq.id) }) }
      );
      expect(res.status).toBe(200);
      const after = await db.getEquipmentById(eq.id);
      expect(after?.name).toBe("Camera");
      expect(after?.description).toBe("Updated");
      void admin;
    });
  });

  describe("equipment batch", () => {
    test("reports partial failures with 200 + partial: true and passes counts through", async () => {
      await asAdmin();
      jest.spyOn(db, "batchUpsertEquipment").mockResolvedValue({
        createdCount: 2,
        updatedCount: 1,
        deletedCount: 0,
        retiredCount: 1,
        errors: ["notice"],
        failedCount: 2,
        failed: [
          { index: 3, name: "Bad", error: "Invalid" },
          { index: 4, name: "Worse", error: "D1_ERROR: NOT NULL constraint failed: equipment.name" },
        ],
      } as unknown as Awaited<ReturnType<typeof db.batchUpsertEquipment>>);
      const res = await batchRoute(jsonReq("/api/equipment/batch", "POST", { items: [{ name: "A" }] }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        success: false,
        partial: true,
        createdCount: 2,
        updatedCount: 1,
        failedCount: 2,
        retiredCount: 1,
        deletedCount: 0,
        errors: ["notice"],
      });
      expect(body.failed).toHaveLength(2);
      expect(JSON.stringify(body)).not.toMatch(/D1_ERROR|constraint/);
    });

    test("still enforces the 500-item limit", async () => {
      await asAdmin();
      const items = Array.from({ length: 501 }, (_, i) => ({ name: `Item ${i}` }));
      const res = await batchRoute(jsonReq("/api/equipment/batch", "POST", { items }));
      expect(res.status).toBe(400);
    });
  });

  describe("handover claim & audit status codes", () => {
    test("unknown handover code → 404; bad notes → 400; malformed JSON → 400", async () => {
      const user = await makeUser("Vic Verified", "verified");
      asUser(user, "verified");
      expect((await claimRoute(jsonReq("/api/handover/claim", "POST", { code: "HD-000000" }))).status).toBe(404);
      expect((await claimRoute(jsonReq("/api/handover/claim", "POST", { code: "HD-1", notes: 42 }))).status).toBe(400);
      expect((await claimRoute(jsonReq("/api/handover/claim", "POST", { code: "HD-1", notes: "x".repeat(501) }))).status).toBe(400);
      expect((await claimRoute(jsonReq("/api/handover/claim", "POST", "{", true))).status).toBe(400);
      expect((await claimRoute(jsonReq("/api/handover/claim", "POST", "null", true))).status).toBe(400);
    });

    test("audit session POST validates types; body null → 400; empty body uses defaults", async () => {
      await asAdmin();
      await makeItem("Tripod", "TR-01");
      expect((await auditSessionPost(jsonReq("/api/audit/session", "POST", { name: 123 }))).status).toBe(400);
      expect((await auditSessionPost(jsonReq("/api/audit/session", "POST", "null", true))).status).toBe(400);
      expect((await auditSessionPost(jsonReq("/api/audit/session", "POST", "{oops", true))).status).toBe(400);
      expect(
        (await auditSessionPost(new NextRequest("http://localhost/api/audit/session", { method: "POST" }))).status
      ).toBe(201);
    });

    test("audit scan/complete: unknown session → 404, unknown equipment → 404, bad JSON → 400", async () => {
      const admin = await asAdmin();
      await makeItem("Tripod", "TR-01");
      expect((await auditScanPost(jsonReq("/api/audit/scan", "POST", { session_id: 9999, identifier: "TR-01" }))).status).toBe(404);
      expect((await auditCompletePost(jsonReq("/api/audit/complete", "POST", { session_id: 9999 }))).status).toBe(404);
      expect((await auditScanPost(jsonReq("/api/audit/scan", "POST", "{", true))).status).toBe(400);
      const s = await startAuditSession({ started_by: admin.id, name: "Run" });
      expect((await auditScanPost(jsonReq("/api/audit/scan", "POST", { session_id: s.id, identifier: "NOPE-99" }))).status).toBe(404);
      expect((await auditScanPost(jsonReq("/api/audit/scan", "POST", { session_id: s.id, identifier: 5 }))).status).toBe(400);
      expect((await auditCompletePost(jsonReq("/api/audit/complete", "POST", { session_id: s.id }))).status).toBe(200);
      // Completing again → conflict, not a generic 400.
      expect((await auditCompletePost(jsonReq("/api/audit/complete", "POST", { session_id: s.id }))).status).toBe(409);
    });

    test("checkout of an item checked out meanwhile → 409 with the business message", async () => {
      const admin = await asAdmin();
      const eq = await makeItem();
      jest.spyOn(db, "createCheckout").mockRejectedValue(new Error("Equipment is already checked out."));
      const res = await checkoutRoute(
        jsonReq(`/api/equipment/${eq.id}/checkout`, "POST", { checked_out_by_name: admin.name, notes: "Shoot" }),
        { params: Promise.resolve({ id: String(eq.id) }) }
      );
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("Equipment is already checked out.");
      void createCheckout;
    });
  });

  describe("users", () => {
    test("typed reservation / storage-map errors map to 400 (404 for unknown equipment)", () => {
      expect(classifyError(new db.ReservationValidationError("Reservations cannot be longer than 30 days."))?.status).toBe(400);
      expect(classifyError(new db.ReservationValidationError('"Cam" cannot be reserved: it is Checked Out.'))?.status).toBe(400);
      expect(classifyError(new db.ReservationValidationError("Equipment not found."))?.status).toBe(404);
      expect(classifyError(new db.StorageMapConfigError('Duplicate cabinet name "A".'))?.status).toBe(400);
      expect(classifyError(new Error("Equipment already reserved between x and y."))?.status).toBe(409);
    });

    test("ConfiguredAdminError from the data layer → 403 with its message", async () => {
      await asAdmin();
      const other = await makeUser("Other Admin", "admin");
      jest.spyOn(db, "updateUserRole").mockRejectedValue(new db.ConfiguredAdminError());
      const res = await updateUserRoute(jsonReq(`/api/users/${other.id}`, "PUT", { role: "viewer" }), {
        params: Promise.resolve({ id: String(other.id) }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/ADMIN_EMAILS/);
    });
  });

  test("tags: new → 201, existing (case-insensitive) → 200", async () => {
    await asAdmin();
    const first = await createTagRoute(jsonReq("/api/tags", "POST", { name: "Lenses" }));
    expect(first.status).toBe(201);
    const again = await createTagRoute(jsonReq("/api/tags", "POST", { name: "lenses" }));
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe((await first.json()).id);
  });

  describe("cron reminders", () => {
    const SECRET = "cron-secret-abcdef";
    let processSpy: jest.SpyInstance;
    let previewSpy: jest.SpyInstance;

    beforeEach(() => {
      process.env.CRON_SECRET = SECRET;
      processSpy = jest
        .spyOn(db, "processReturnReminders")
        .mockResolvedValue({ totalChecked: 0, sent: 0, skipped: 0, errors: 0, reminders: [] } as never);
      previewSpy = jest.spyOn(db, "getPendingReturnReminders").mockResolvedValue([]);
    });

    afterEach(() => {
      delete process.env.CRON_SECRET;
    });

    test("GET with an admin session only previews (no side effects), even with force=true", async () => {
      await asAdmin();
      const res = await cronGet(new NextRequest("http://localhost/api/cron/reminders?force=true"));
      expect(res.status).toBe(200);
      expect((await res.json()).preview).toBe(true);
      expect(processSpy).not.toHaveBeenCalled();
      expect(previewSpy).toHaveBeenCalled();
    });

    test("POST with an admin session runs reminders; force only honoured for admins", async () => {
      await asAdmin();
      const res = await cronPost(new NextRequest("http://localhost/api/cron/reminders?force=true", { method: "POST" }));
      expect(res.status).toBe(200);
      expect(processSpy).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    });

    test("cron response passes through noLinkedAccount", async () => {
      processSpy.mockResolvedValue({ totalChecked: 1, sent: 0, skipped: 1, errors: 0, reminders: [], noLinkedAccount: 1 } as never);
      const res = await cronPost(
        new NextRequest("http://localhost/api/cron/reminders", { method: "POST", headers: { "x-cron-secret": SECRET } })
      );
      expect(res.status).toBe(200);
      expect((await res.json()).noLinkedAccount).toBe(1);
    });

    test("GET with the cron secret runs (Vercel Cron) without force", async () => {
      const res = await cronGet(
        new NextRequest("http://localhost/api/cron/reminders?force=true", { headers: { authorization: `Bearer ${SECRET}` } })
      );
      expect(res.status).toBe(200);
      expect(processSpy).toHaveBeenCalledWith(expect.objectContaining({ force: false }));
    });

    test("wrong secret / no session → 401; missing CRON_SECRET fails closed", async () => {
      const wrong = await cronPost(
        new NextRequest("http://localhost/api/cron/reminders", { method: "POST", headers: { "x-cron-secret": "nope" } })
      );
      expect(wrong.status).toBe(401);
      delete process.env.CRON_SECRET;
      const empty = await cronGet(new NextRequest("http://localhost/api/cron/reminders", { headers: { authorization: "Bearer " } }));
      expect(empty.status).toBe(401);
      expect(processSpy).not.toHaveBeenCalled();
    });

    test("timingSafeEqualString compares correctly", () => {
      expect(timingSafeEqualString("abc", "abc")).toBe(true);
      expect(timingSafeEqualString("abc", "abd")).toBe(false);
      expect(timingSafeEqualString("abc", "abcd")).toBe(false);
      expect(timingSafeEqualString("", "")).toBe(true);
      expect(timingSafeEqualString("", "a")).toBe(false);
      expect(timingSafeEqualString("ünï", "ünï")).toBe(true);
      expect(timingSafeEqualString("ünï", "uni")).toBe(false);
    });
  });

  describe("SOP uploads", () => {
    function formReq(fields: Record<string, unknown>, headers: Record<string, string> = {}) {
      const formData = jest.fn().mockResolvedValue({ get: (k: string) => (k in fields ? fields[k] : null) });
      return {
        req: { headers: new Headers({ "content-type": "multipart/form-data; boundary=x", ...headers }), formData } as unknown as NextRequest,
        formData,
      };
    }

    beforeEach(() => {
      (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "admin", email: "a@b.c", name: "A" } });
    });

    test("parse: oversized Content-Length → 413 before reading the body", async () => {
      const { req, formData } = formReq({}, { "content-length": String(50 * 1024 * 1024) });
      const res = await parseSop(req);
      expect(res.status).toBe(413);
      expect(formData).not.toHaveBeenCalled();
    });

    test("parse: a string `file` field → 400 (not a TypeError/500)", async () => {
      const { req } = formReq({ file: "not a file" });
      const res = await parseSop(req);
      expect(res.status).toBe(400);
    });

    test("parse: legacy .doc is rejected up front", async () => {
      const file = { name: "old.doc", size: 10, type: "application/msword", arrayBuffer: jest.fn() };
      const { req } = formReq({ file });
      const res = await parseSop(req);
      expect(res.status).toBe(415);
      expect((await res.json()).error).toMatch(/\.docx or PDF/);
      expect(file.arrayBuffer).not.toHaveBeenCalled();
    });

    test("upload: oversized Content-Length → 413; string file → 400; non-string title → 400", async () => {
      jest.spyOn(db, "getUserByEmail").mockResolvedValue({ id: 1, role: "admin" } as never);
      const big = formReq({}, { "content-length": String(50 * 1024 * 1024) });
      expect((await uploadSop(big.req)).status).toBe(413);
      expect(big.formData).not.toHaveBeenCalled();

      expect((await uploadSop(formReq({ file: "oops" }).req)).status).toBe(400);

      const file = { name: "a.txt", size: 3, type: "text/plain", arrayBuffer: async () => new ArrayBuffer(3) };
      expect((await uploadSop(formReq({ file, title: file }).req)).status).toBe(400);
    });

    test("upload JSON: rejects wrongly-typed client metadata", async () => {
      jest.spyOn(db, "getUserByEmail").mockResolvedValue({ id: 1, role: "admin" } as never);
      const base = { title: "Doc", content: "Body" };
      for (const extra of [{ file_size: -1 }, { file_size: 1.5 }, { file_size: "10" }, { file_name: "../../etc/passwd" }, { file_type: 7 }]) {
        const res = await uploadSop(jsonReq("/api/sop", "POST", { ...base, ...extra }));
        expect(res.status).toBe(400);
      }
    });
  });

  describe("webhook test", () => {
    beforeEach(async () => {
      await asAdmin();
    });

    test("rejects non-string or oversized message", async () => {
      expect((await webhookTest(jsonReq("/api/webhooks/test", "POST", { message: 5 }))).status).toBe(400);
      expect((await webhookTest(jsonReq("/api/webhooks/test", "POST", { message: "x".repeat(1001) }))).status).toBe(400);
      expect((await webhookTest(jsonReq("/api/webhooks/test", "POST", "{", true))).status).toBe(400);
    });

    test("does not echo provider error bodies", async () => {
      jest.spyOn(webhookModule, "sendClubWebhook").mockResolvedValue({
        success: false,
        dispatched: [],
        error: 'discord: HTTP 401 - {"message":"Invalid Webhook Token","secret":"abc"}',
      });
      const res = await webhookTest(new NextRequest("http://localhost/api/webhooks/test", { method: "POST" }));
      const body = await res.json();
      expect(res.status).toBe(502);
      expect(body.error).toContain("discord: HTTP 401");
      expect(JSON.stringify(body)).not.toMatch(/Invalid Webhook Token|secret/);
    });

    test("success reports channels and a message", async () => {
      jest.spyOn(webhookModule, "sendClubWebhook").mockResolvedValue({ success: true, dispatched: ["console_dev"] });
      const res = await webhookTest(jsonReq("/api/webhooks/test", "POST", { message: "hello" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.channels).toEqual([]);
      expect(typeof body.message).toBe("string");
    });
  });

  describe("event section invitation emails", () => {
    async function seed() {
      const admin = await asAdmin();
      const member = await makeUser("Mia Member", "verified");
      const event = await createEvent({
        name: "Concert",
        start_time: new Date(Date.now() + 10 * HOUR).toISOString(),
        end_time: new Date(Date.now() + 12 * HOUR).toISOString(),
        location: "Hall",
        created_by: admin.id,
      });
      return { member, event };
    }
    const post = (eventId: number, body: unknown) =>
      sectionRoute(jsonReq(`/api/events/${eventId}/section`, "POST", body), {
        params: Promise.resolve({ id: String(eventId) }),
      });

    test("add_deployment reports the email outcome instead of dropping it", async () => {
      const { member, event } = await seed();
      jest
        .spyOn(emailModule, "sendDeploymentInvitationEmail")
        .mockResolvedValue({ success: false, skipped: true, reason: "SMTP not configured", error: "SMTP not configured" });
      const res = await post(event.id, { action: "add_deployment", section: "photo", user_id: member.id });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.emailSent).toBe(false);
      expect(body.emailError).toMatch(/not configured/i);
      expect(body.id).toBe(event.id);
    });

    test("resend with SMTP not configured → 503 (not 404)", async () => {
      const { member, event } = await seed();
      jest.spyOn(emailModule, "sendDeploymentInvitationEmail").mockResolvedValue({ success: true });
      expect((await post(event.id, { action: "add_deployment", section: "photo", user_id: member.id })).status).toBe(200);

      jest
        .spyOn(db, "resendDeploymentEmail")
        .mockResolvedValue({ success: false, skipped: true, error: "SMTP not configured" } as never);
      const res = await post(event.id, { action: "resend_deployment_email", section: "photo", user_id: member.id });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/not configured/i);
    });

    test("resend SMTP failure → 502 without the provider's error text", async () => {
      const { member, event } = await seed();
      jest
        .spyOn(db, "resendDeploymentEmail")
        .mockResolvedValue({ success: false, error: "Invalid login: 535-5.7.8 Username and Password not accepted" });
      const res = await post(event.id, { action: "resend_deployment_email", section: "photo", user_id: member.id });
      expect(res.status).toBe(502);
      expect((await res.json()).error).not.toMatch(/535|Password/);
    });
  });
});
