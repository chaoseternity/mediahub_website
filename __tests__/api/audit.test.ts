import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import {
  createEquipment,
  upsertUser,
  startAuditSession,
  recordAuditScan,
  completeAuditSession,
  getAuditSessionDetails,
  getActiveAuditSession,
  getEquipmentById,
} from "@/lib/db";

describe("Storage Room Inventory Roll Call Audit", () => {
  let db: any;

  beforeEach(() => {
    db = makeTestDb();
    setTestDb(db);
  });

  afterEach(() => {
    setTestDb(null);
  });

  test("runs roll call audit: all items default to missing until scanned into exists", async () => {
    const admin = await upsertUser({
      name: "Admin User",
      email: "admin@school.edu",
      role: "admin",
      google_id: "google_admin",
      image: null,
      provider: "google",
    });

    const eq1 = await createEquipment({
      name: "Tripod 1",
      serial_number: "TR-01",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Grip Bay",
    });

    const eq2 = await createEquipment({
      name: "Tripod 2",
      serial_number: "TR-02",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Grip Bay",
    });

    // 1. Start audit session
    const session = await startAuditSession({
      started_by: admin.id,
      name: "Midterm Roll Call",
    });

    expect(session).toBeDefined();
    expect(session.total_items).toBe(2);
    expect(session.missing_count).toBe(2);
    expect(session.found_count).toBe(0);

    // 2. Scan TR-01
    const scanRes = await recordAuditScan({
      session_id: session.id,
      equipment_identifier: "TR-01",
      scanned_by: admin.id,
      method: "manual",
    });

    expect(scanRes.success).toBe(true);
    expect(scanRes.record?.status).toBe("exists");

    // 3. Complete audit session and update catalog condition for uncounted items
    const completeRes = await completeAuditSession(session.id, {
      markMissingAsCatalogMissing: true,
    });

    expect(completeRes.success).toBe(true);
    expect(completeRes.session?.status).toBe("completed");
    expect(completeRes.session?.found_count).toBe(1);
    expect(completeRes.session?.missing_count).toBe(1);

    // 4. Verify eq2 is now marked Missing in equipment table
    const refreshedEq2 = await getEquipmentById(eq2.id);
    expect(refreshedEq2?.condition).toBe("Missing");
    expect(refreshedEq2?.status).toBe("Unavailable (Missing)");

    // 5. Verify eq1 is still Working and Available
    const refreshedEq1 = await getEquipmentById(eq1.id);
    expect(refreshedEq1?.condition).toBe("Working");
    expect(refreshedEq1?.status).toBe("Available");
  });
});
