import { NextRequest } from "next/server";
import { makeTestDb } from "@/lib/test-db";
import { setTestDb } from "@/lib/d1";
import { getUserProfileData, getUserByUsername } from "@/lib/db";
import { GET as getProfile } from "@/app/api/profile/route";
import { auth } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

describe("Profile API & Database Queries", () => {
  let db: any;

  beforeEach(() => {
    db = makeTestDb();
    setTestDb(db);

    // Seed test users
    db.prepare(`
      INSERT INTO users (id, name, email, username, role)
      VALUES 
        (1, 'Alice Admin', 'admin@club.com', 'alice_admin', 'admin'),
        (2, 'Bob Viewer', 'bob@club.com', 'bob_viewer', 'viewer'),
        (3, 'Charlie Verified', 'charlie@club.com', 'charlie_v', 'verified')
    `).run();

    // Seed equipment
    db.prepare(`
      INSERT INTO equipment (id, name, condition, location, status, serial_number)
      VALUES 
        (1, 'Sony FX3', 'Working', 'Media Room', 'Checked Out', 'CAM-01'),
        (2, 'Tripod', 'Working', 'Media Room', 'Available', 'TRI-01'),
        (3, 'Wireless Mic', 'Working', 'Audio Rack', 'Available', 'MIC-01')
    `).run();

    // Seed checkouts (Active and past for Bob)
    db.prepare(`
      INSERT INTO checkouts (id, equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, returned_at)
      VALUES 
        (1, 1, 2, 'Bob Viewer', '2026-09-20 10:00:00', '2026-09-22 18:00:00', NULL),
        (2, 2, 2, 'Bob Viewer', '2026-09-10 10:00:00', '2026-09-12 18:00:00', '2026-09-12 17:00:00')
    `).run();

    // Seed events
    db.prepare(`
      INSERT INTO events (id, name, description, start_time, end_time, location, has_rehearsal)
      VALUES 
        (1, 'Annual Awards Ceremony', 'Big award show', '2026-10-01 18:00:00', '2026-10-01 22:00:00', 'Auditorium', 1),
        (2, 'Sports Day Shoot', 'Track and field', '2026-09-01 08:00:00', '2026-09-01 14:00:00', 'Stadium', 0)
    `).run();

    // Assign Bob as Video IC for Event 1, and crew for Event 2
    db.prepare(`
      INSERT INTO event_ics (event_id, user_id, section)
      VALUES (1, 2, 'video')
    `).run();

    db.prepare(`
      INSERT INTO event_deployments (event_id, user_id, section, response_status, attending_rehearsal)
      VALUES (2, 2, 'photo', 'confirmed', 0)
    `).run();

    // Seed NFC card for Bob
    db.prepare(`
      INSERT INTO nfc_cards (nfc_value, member_name, created_at)
      VALUES ('NFC_BOB_123', 'Bob Viewer', '2026-09-01 00:00:00')
    `).run();
  });

  afterEach(() => {
    setTestDb(null);
    jest.clearAllMocks();
  });

  test("getUserByUsername retrieves user by username or name", async () => {
    const byUsername = await getUserByUsername("bob_viewer");
    expect(byUsername).toBeDefined();
    expect(byUsername?.id).toBe(2);

    const byName = await getUserByUsername("Bob Viewer");
    expect(byName).toBeDefined();
    expect(byName?.id).toBe(2);

    const nonExistent = await getUserByUsername("non_existent_user");
    expect(nonExistent).toBeUndefined();
  });

  test("getUserProfileData aggregates active equipment, past checkouts, events, and NFC card", async () => {
    const profile = await getUserProfileData(2);
    expect(profile).toBeDefined();
    if (!profile) return;

    expect(profile.user.id).toBe(2);
    expect(profile.user.name).toBe("Bob Viewer");

    // Equipment checks
    expect(profile.activeEquipment).toHaveLength(1);
    expect(profile.activeEquipment[0].equipment_name).toBe("Sony FX3");
    expect(profile.activeEquipment[0].equipment_serial_number).toBe("CAM-01");
    expect(profile.activeEquipment[0].returned_at).toBeNull();

    expect(profile.pastEquipment).toHaveLength(1);
    expect(profile.pastEquipment[0].equipment_name).toBe("Tripod");
    expect(profile.pastEquipment[0].returned_at).toBe("2026-09-12 17:00:00");

    // Stats
    expect(profile.stats.activePossessionsCount).toBe(1);
    expect(profile.stats.totalCheckoutsCount).toBe(2);

    // Events checks
    expect(profile.events).toHaveLength(2);
    const event1 = profile.events.find((e) => e.event_id === 1);
    expect(event1).toBeDefined();
    expect(event1?.roles).toContainEqual(
      expect.objectContaining({
        type: "section_ic",
        section: "video",
        label: "VIDEO In-Charge (IC)",
      })
    );

    const event2 = profile.events.find((e) => e.event_id === 2);
    expect(event2).toBeDefined();
    expect(event2?.roles).toContainEqual(
      expect.objectContaining({
        type: "deployment",
        section: "photo",
        response_status: "confirmed",
      })
    );

    // NFC Card check
    expect(profile.nfcCard).toBeDefined();
    expect(profile.nfcCard?.nfc_value).toBe("NFC_BOB_123");
  });

  test("GET /api/profile returns 401 when not logged in", async () => {
    (auth as jest.Mock).mockResolvedValue(null);
    const req = new NextRequest("http://localhost:3000/api/profile");
    const res = await getProfile(req);
    expect(res.status).toBe(401);
  });

  test("GET /api/profile allows viewer to access their own profile", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "2", name: "Bob Viewer", username: "bob_viewer", role: "viewer" },
    });
    const req = new NextRequest("http://localhost:3000/api/profile");
    const res = await getProfile(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.user.id).toBe(2);
    expect(json.user.name).toBe("Bob Viewer");
    expect(json.activeEquipment).toHaveLength(1);
  });

  test("GET /api/profile rejects viewer attempting to view another user's profile with 403 Forbidden", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "2", name: "Bob Viewer", username: "bob_viewer", role: "viewer" },
    });

    // Attempting via ?id=1 (Admin)
    const reqWithId = new NextRequest("http://localhost:3000/api/profile?id=1");
    const resWithId = await getProfile(reqWithId);
    expect(resWithId.status).toBe(403);
    const jsonId = await resWithId.json();
    expect(jsonId.error).toContain("Forbidden");

    // Attempting via ?username=alice_admin
    const reqWithUsername = new NextRequest("http://localhost:3000/api/profile?username=alice_admin");
    const resWithUsername = await getProfile(reqWithUsername);
    expect(resWithUsername.status).toBe(403);
    const jsonUsername = await resWithUsername.json();
    expect(jsonUsername.error).toContain("Forbidden");
  });

  test("GET /api/profile rejects verified user attempting to view another user's profile with 403 Forbidden", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "3", name: "Charlie Verified", username: "charlie_v", role: "verified" },
    });

    const req = new NextRequest("http://localhost:3000/api/profile?id=2");
    const res = await getProfile(req);
    expect(res.status).toBe(403);
  });

  test("GET /api/profile allows admin to view any user's profile", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "1", name: "Alice Admin", username: "alice_admin", role: "admin" },
    });

    // Admin views Bob Viewer's profile
    const req = new NextRequest("http://localhost:3000/api/profile?id=2");
    const res = await getProfile(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.user.id).toBe(2);
    expect(json.user.name).toBe("Bob Viewer");
    expect(json.activeEquipment).toHaveLength(1);
  });
});
