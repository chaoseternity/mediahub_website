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
import { DELETE as cancelReservationRoute, PATCH as fulfillReservationRoute } from "@/app/api/reservations/[id]/route";
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
});
