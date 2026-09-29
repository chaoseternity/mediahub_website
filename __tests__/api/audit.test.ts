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
  createCheckout,
} from "@/lib/db";
import { GET as getAuditSessionRoute, POST as startAuditSessionRoute } from "@/app/api/audit/session/route";
import { POST as auditScanRoute } from "@/app/api/audit/scan/route";
import { POST as auditCompleteRoute } from "@/app/api/audit/complete/route";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";
import type { Role } from "@/lib/types";

async function makeUser(name: string, role: Role) {
  const slug = name.toLowerCase().replace(/\s+/g, ".");
  return upsertUser({ name, email: `${slug}@school.edu`, google_id: `g_${slug}`, image: null, provider: "google", role });
}

async function makeItem(name: string, serial: string) {
  return createEquipment({
    name,
    serial_number: serial,
    tags: [],
    status: "Available",
    condition: "Working",
    location: "Grip Bay",
  });
}

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

  describe("admin-only access", () => {
    test.each(["verified", "viewer"] as const)("every audit route returns 403 for %s users", async (role) => {
      const admin = await makeUser("Admin User", "admin");
      await makeItem("Tripod 1", "TR-01");
      const session = await startAuditSession({ started_by: admin.id, name: "Roll Call" });
      const member = await makeUser(`Member ${role}`, role);
      (auth as jest.Mock).mockResolvedValue({
        user: { id: String(member.id), email: member.email, name: member.name, role },
      });

      expect((await getAuditSessionRoute(new NextRequest("http://localhost/api/audit/session"))).status).toBe(403);
      expect(
        (await getAuditSessionRoute(new NextRequest(`http://localhost/api/audit/session?id=${session.id}`))).status
      ).toBe(403);
      expect(
        (
          await startAuditSessionRoute(
            new NextRequest("http://localhost/api/audit/session", { method: "POST", body: JSON.stringify({ name: "x" }) })
          )
        ).status
      ).toBe(403);
      expect(
        (
          await auditScanRoute(
            new NextRequest("http://localhost/api/audit/scan", {
              method: "POST",
              body: JSON.stringify({ session_id: session.id, identifier: "TR-01" }),
            })
          )
        ).status
      ).toBe(403);
      expect(
        (
          await auditCompleteRoute(
            new NextRequest("http://localhost/api/audit/complete", {
              method: "POST",
              body: JSON.stringify({ session_id: session.id }),
            })
          )
        ).status
      ).toBe(403);

      // Session untouched.
      const active = await getActiveAuditSession();
      expect(active?.id).toBe(session.id);
      expect(active?.found_count).toBe(0);
    });

    test("admins can use the audit routes", async () => {
      const admin = await makeUser("Admin User", "admin");
      await makeItem("Tripod 1", "TR-01");
      (auth as jest.Mock).mockResolvedValue({
        user: { id: String(admin.id), email: admin.email, name: admin.name, role: "admin" },
      });
      const start = await startAuditSessionRoute(
        new NextRequest("http://localhost/api/audit/session", { method: "POST", body: JSON.stringify({ name: "Admin run" }) })
      );
      expect(start.status).toBe(201);
      const started = await start.json();
      expect(started.started_by_name).toBe("Admin User");
      const scan = await auditScanRoute(
        new NextRequest("http://localhost/api/audit/scan", {
          method: "POST",
          body: JSON.stringify({ session_id: started.id, identifier: "TR-01" }),
        })
      );
      expect(scan.status).toBe(200);
    });
  });

  describe("session state guards", () => {
    test("scans are rejected for unknown, cancelled and completed sessions", async () => {
      const admin = await makeUser("Admin User", "admin");
      await makeItem("Tripod 1", "TR-01");

      const missing = await recordAuditScan({ session_id: 9999, equipment_identifier: "TR-01", scanned_by: admin.id, method: "manual" });
      expect(missing.success).toBe(false);
      expect(missing.error).toMatch(/not found/);

      const first = await startAuditSession({ started_by: admin.id, name: "First" });
      await startAuditSession({ started_by: admin.id, name: "Second" }); // cancels "First"
      const cancelled = await recordAuditScan({ session_id: first.id, equipment_identifier: "TR-01", scanned_by: admin.id, method: "manual" });
      expect(cancelled.success).toBe(false);
      expect(cancelled.error).toMatch(/cancelled/);

      const active = await getActiveAuditSession();
      expect((await completeAuditSession(active!.id)).success).toBe(true);
      const afterComplete = await recordAuditScan({ session_id: active!.id, equipment_identifier: "TR-01", scanned_by: admin.id, method: "manual" });
      expect(afterComplete.success).toBe(false);
      expect(db.prepare("SELECT status FROM audit_records WHERE session_id = ?").get(active!.id).status).toBe("missing");
    });

    test("cancelled sessions cannot be completed", async () => {
      const admin = await makeUser("Admin User", "admin");
      await makeItem("Tripod 1", "TR-01");
      const first = await startAuditSession({ started_by: admin.id, name: "First" });
      await startAuditSession({ started_by: admin.id, name: "Second" });

      const res = await completeAuditSession(first.id, { markMissingAsCatalogMissing: true });
      expect(res.success).toBe(false);
      const row = db.prepare("SELECT status FROM audit_sessions WHERE id = ?").get(first.id);
      expect(row.status).toBe("cancelled");
      const eq = db.prepare("SELECT condition FROM equipment WHERE serial_number = 'TR-01'").get();
      expect(eq.condition).toBe("Working");
    });

    test("concurrent completes only apply once", async () => {
      const admin = await makeUser("Admin User", "admin");
      await makeItem("Tripod 1", "TR-01");
      const session = await startAuditSession({ started_by: admin.id, name: "Race" });
      const results = await Promise.all([
        completeAuditSession(session.id, { markMissingAsCatalogMissing: true }),
        completeAuditSession(session.id, { markMissingAsCatalogMissing: true }),
      ]);
      expect(results.filter((r) => r.success)).toHaveLength(1);
    });

    test("counters stay exact with repeated and concurrent scans", async () => {
      const admin = await makeUser("Admin User", "admin");
      await makeItem("Tripod 1", "TR-01");
      await makeItem("Tripod 2", "TR-02");
      await makeItem("Tripod 3", "TR-03");
      const session = await startAuditSession({ started_by: admin.id, name: "Counters" });

      const scan = (id: string) =>
        recordAuditScan({ session_id: session.id, equipment_identifier: id, scanned_by: admin.id, method: "qr" });
      const results = await Promise.all([scan("TR-01"), scan("TR-01"), scan("TR-02"), scan("TR-02")]);
      expect(results.every((r) => r.success)).toBe(true);
      expect(results.filter((r) => r.alreadyScanned)).toHaveLength(2);

      const details = await getAuditSessionDetails(session.id);
      expect(details?.session.total_items).toBe(3);
      expect(details?.session.found_count).toBe(2);
      expect(details?.session.missing_count).toBe(1);
      expect(details?.session.started_by_name).toBe("Admin User");
    });

    test("completion does not mark checked-out items as missing", async () => {
      const admin = await makeUser("Admin User", "admin");
      const out = await makeItem("Camera Out", "CAM-01");
      const gone = await makeItem("Camera Gone", "CAM-02");
      await createCheckout({ equipment_id: out.id, checked_out_by: admin.id, checked_out_by_name: admin.name });
      const session = await startAuditSession({ started_by: admin.id, name: "Checkout aware" });

      const res = await completeAuditSession(session.id, { markMissingAsCatalogMissing: true });
      expect(res.success).toBe(true);
      expect((await getEquipmentById(out.id))?.condition).toBe("Working");
      expect((await getEquipmentById(out.id))?.status).toBe("Checked Out");
      expect((await getEquipmentById(gone.id))?.condition).toBe("Missing");
    });
  });
});
