import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import {
  createEquipment,
  upsertUser,
  createReservation,
  checkReservationConflict,
  cancelReservation,
  fulfillReservation,
  getReservations,
} from "@/lib/db";
import { POST as createReservationRoute, GET as listReservationsRoute } from "@/app/api/reservations/route";
import {
  DELETE as cancelReservationRoute,
  PATCH as fulfillReservationRoute,
  GET as getReservationRoute,
} from "@/app/api/reservations/[id]/route";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

describe("Gear Reservations & Conflict Detection", () => {
  let db: any;

  beforeEach(() => {
    db = makeTestDb();
    setTestDb(db);
  });

  afterEach(() => {
    setTestDb(null);
  });

  test("creates a reservation and detects overlapping conflicts", async () => {
    const user = await upsertUser({
      name: "Bob Filmmaker",
      email: "bob@school.edu",
      google_id: "google_bob",
      image: null,
      provider: "google",
    });

    const eq = await createEquipment({
      name: "Blackmagic Cinema 6K",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Cabinet 1",
    });

    const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    // 1. Initial check - no conflict
    const conflict1 = await checkReservationConflict(eq.id, start, end);
    expect(conflict1.hasConflict).toBe(false);

    // 2. Create reservation
    const res = await createReservation({
      equipment_id: eq.id,
      reserved_by: user.id,
      reserved_by_name: user.name,
      start_time: start,
      end_time: end,
      notes: "Short film shoot",
    });

    expect(res).toBeDefined();
    expect(res.equipment_id).toBe(eq.id);
    expect(res.status).toBe("confirmed");

    // 3. Overlapping check - must detect conflict!
    const midStart = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();
    const midEnd = new Date(Date.now() + 60 * 60 * 60 * 1000).toISOString();
    const conflict2 = await checkReservationConflict(eq.id, midStart, midEnd);
    expect(conflict2.hasConflict).toBe(true);
    expect(conflict2.conflictingReservations.length).toBe(1);

    // 4. Cancel reservation releases conflict
    await cancelReservation(res.id, user.id);
    const conflictAfterCancel = await checkReservationConflict(eq.id, midStart, midEnd);
    expect(conflictAfterCancel.hasConflict).toBe(false);
  });

  test("API route rejects overlapping reservation with 409 Conflict", async () => {
    const user = await upsertUser({
      name: "Admin User",
      email: "admin@school.edu",
      role: "admin",
      google_id: "google_admin",
      image: null,
      provider: "google",
    });

    (auth as jest.Mock).mockResolvedValue({
      user: { id: String(user.id), email: user.email, name: user.name, role: "admin" },
    });

    const eq = await createEquipment({
      name: "Canon C70",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Cabinet 1",
    });

    const start = new Date(Date.now() + 10 * 3600 * 1000).toISOString();
    const end = new Date(Date.now() + 20 * 3600 * 1000).toISOString();

    // First reservation via route
    const req1 = new NextRequest("http://localhost/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        equipment_id: eq.id,
        start_date: start,
        end_date: end,
        purpose: "Interview shoot",
      }),
    });
    const res1 = await createReservationRoute(req1);
    expect(res1.status).toBe(201);

    // Conflicting reservation via route
    const req2 = new NextRequest("http://localhost/api/reservations", {
      method: "POST",
      body: JSON.stringify({
        equipment_id: eq.id,
        start_date: start,
        end_date: end,
        purpose: "Overlap attempt",
      }),
    });
    const res2 = await createReservationRoute(req2);
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2.error).toContain("already reserved");
  });

  describe("admin-only access", () => {
    async function seedReservation() {
      const admin = await upsertUser({
        name: "Admin User",
        email: "admin@school.edu",
        role: "admin",
        google_id: "google_admin",
        image: null,
        provider: "google",
      });
      const eq = await createEquipment({
        name: "Canon R5",
        tags: [],
        status: "Available",
        condition: "Working",
        location: "Cabinet 2",
      });
      const reservation = await createReservation({
        equipment_id: eq.id,
        reserved_by: admin.id,
        reserved_by_name: admin.name,
        start_time: new Date(Date.now() + 10 * 3600 * 1000).toISOString(),
        end_time: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
      });
      return { admin, eq, reservation };
    }

    test.each(["verified", "viewer"] as const)("every reservations route returns 403 for %s users", async (role) => {
      const { eq, reservation } = await seedReservation();
      const member = await upsertUser({
        name: `Member ${role}`,
        email: `${role}@school.edu`,
        role,
        google_id: `google_${role}`,
        image: null,
        provider: "google",
      });
      (auth as jest.Mock).mockResolvedValue({
        user: { id: String(member.id), email: member.email, name: member.name, role },
      });
      const idParams = { params: Promise.resolve({ id: String(reservation.id) }) };

      const list = await listReservationsRoute(new NextRequest("http://localhost/api/reservations"));
      expect(list.status).toBe(403);

      const create = await createReservationRoute(
        new NextRequest("http://localhost/api/reservations", {
          method: "POST",
          body: JSON.stringify({
            equipment_id: eq.id,
            start_time: new Date(Date.now() + 30 * 3600 * 1000).toISOString(),
            end_time: new Date(Date.now() + 40 * 3600 * 1000).toISOString(),
          }),
        })
      );
      expect(create.status).toBe(403);

      const get = await getReservationRoute(new NextRequest(`http://localhost/api/reservations/${reservation.id}`), idParams);
      expect(get.status).toBe(403);

      const cancel = await cancelReservationRoute(
        new NextRequest(`http://localhost/api/reservations/${reservation.id}`, { method: "DELETE" }),
        idParams
      );
      expect(cancel.status).toBe(403);

      const fulfill = await fulfillReservationRoute(
        new NextRequest(`http://localhost/api/reservations/${reservation.id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "fulfill" }),
        }),
        idParams
      );
      expect(fulfill.status).toBe(403);

      // Nothing changed.
      const [stored] = await getReservations({ equipment_id: eq.id });
      expect(stored.status).toBe("confirmed");
      expect(await getReservations()).toHaveLength(1);
    });

    test("admins can list and view reservations", async () => {
      const { admin, reservation } = await seedReservation();
      (auth as jest.Mock).mockResolvedValue({
        user: { id: String(admin.id), email: admin.email, name: admin.name, role: "admin" },
      });
      const list = await listReservationsRoute(new NextRequest("http://localhost/api/reservations"));
      expect(list.status).toBe(200);
      const get = await getReservationRoute(new NextRequest(`http://localhost/api/reservations/${reservation.id}`), {
        params: Promise.resolve({ id: String(reservation.id) }),
      });
      expect(get.status).toBe(200);
    });
  });

  describe("atomic state transitions", () => {
    async function seed() {
      const admin = await upsertUser({
        name: "Admin User",
        email: "admin@school.edu",
        role: "admin",
        google_id: "google_admin",
        image: null,
        provider: "google",
      });
      const eq = await createEquipment({
        name: "Zoom H6",
        tags: [],
        status: "Available",
        condition: "Working",
        location: "Audio Rack",
      });
      const reservation = await createReservation({
        equipment_id: eq.id,
        reserved_by: admin.id,
        reserved_by_name: admin.name,
        start_time: new Date(Date.now() + 1 * 3600 * 1000).toISOString(),
        end_time: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      });
      return { admin, eq, reservation };
    }

    test("concurrent fulfils create only one checkout", async () => {
      const { eq, reservation } = await seed();
      const results = await Promise.all([fulfillReservation(reservation.id), fulfillReservation(reservation.id)]);
      expect(results.filter((r) => r.success)).toHaveLength(1);
      const open = db
        .prepare("SELECT COUNT(*) AS n FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
        .get(eq.id);
      expect(open.n).toBe(1);
    });

    test("a cancelled reservation cannot be fulfilled, and vice versa", async () => {
      const { admin, reservation } = await seed();
      expect((await cancelReservation(reservation.id, admin.id, true)).success).toBe(true);
      expect((await cancelReservation(reservation.id, admin.id, true)).success).toBe(false);
      expect((await fulfillReservation(reservation.id)).success).toBe(false);
    });

    test("a failed fulfil leaves the reservation confirmed", async () => {
      const { eq, reservation } = await seed();
      db.prepare("UPDATE equipment SET status = 'Unavailable (In Repairs)' WHERE id = ?").run(eq.id);
      const res = await fulfillReservation(reservation.id);
      expect(res.success).toBe(false);
      const [stored] = await getReservations({ equipment_id: eq.id });
      expect(stored.status).toBe("confirmed");
    });
  });
});
