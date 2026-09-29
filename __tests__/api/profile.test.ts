import { NextRequest } from "next/server";
import { GET as getProfile } from "@/app/api/profile/route";
import { auth } from "@/lib/auth";
import { getUserByEmail, getUserProfileData } from "@/lib/db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  getUserByEmail: jest.fn(),
  getUserProfileData: jest.fn(),
}));

describe("Profile API (GET /api/profile)", () => {
  const mockAdmin = { id: 1, name: "Alice Admin", email: "admin@club.com", role: "admin" };
  const mockViewer = { id: 2, name: "Bob Viewer", email: "bob@club.com", role: "viewer" };
  const mockVerified = { id: 3, name: "Charlie Verified", email: "charlie@club.com", role: "verified" };

  const mockBobProfile = {
    user: mockViewer,
    activeEquipment: [
      {
        checkout_id: 1,
        equipment_id: 1,
        equipment_name: "Sony FX3",
        equipment_serial_number: "CAM-01",
        checked_out_at: "2026-09-20 10:00:00",
        expected_return_at: "2026-09-22 18:00:00",
        returned_at: null,
      },
    ],
    pastEquipment: [],
    events: [],
    nfcCard: { nfc_value: "NFC_BOB_123" },
    stats: {
      activePossessionsCount: 1,
      totalCheckoutsCount: 1,
      upcomingEventsCount: 0,
      totalEventsCount: 0,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (getUserByEmail as jest.Mock).mockImplementation(async (email: string) => {
      if (email === "admin@club.com") return mockAdmin;
      if (email === "bob@club.com") return mockViewer;
      if (email === "charlie@club.com") return mockVerified;
      return undefined;
    });

    (getUserProfileData as jest.Mock).mockImplementation(async (id: number) => {
      if (id === 2) return mockBobProfile;
      return undefined;
    });
  });

  test("GET /api/profile returns 401 when not logged in", async () => {
    (auth as jest.Mock).mockResolvedValue(null);
    const req = new NextRequest("http://localhost:3000/api/profile");
    const res = await getProfile(req);
    expect(res.status).toBe(401);
  });

  test("GET /api/profile allows viewer to access their own profile", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "2", email: "bob@club.com", name: "Bob Viewer", role: "viewer" },
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
      user: { id: "2", email: "bob@club.com", name: "Bob Viewer", role: "viewer" },
    });

    // Attempting via ?id=1 (Admin)
    const reqWithId = new NextRequest("http://localhost:3000/api/profile?id=1");
    const resWithId = await getProfile(reqWithId);
    expect(resWithId.status).toBe(403);
    const jsonId = await resWithId.json();
    expect(jsonId.error).toContain("Forbidden");

  });

  test("GET /api/profile ignores the retired ?username= lookup and serves the caller's own profile", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "2", email: "bob@club.com", name: "Bob Viewer", role: "viewer" },
    });

    const req = new NextRequest("http://localhost:3000/api/profile?username=alice_admin");
    const res = await getProfile(req);
    expect(res.status).toBe(200);
    expect((await res.json()).user.id).toBe(2);
    expect(getUserProfileData).toHaveBeenCalledWith(2);
  });

  test("GET /api/profile rejects verified user attempting to view another user's profile with 403 Forbidden", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "3", email: "charlie@club.com", name: "Charlie Verified", role: "verified" },
    });

    const req = new NextRequest("http://localhost:3000/api/profile?id=2");
    const res = await getProfile(req);
    expect(res.status).toBe(403);
  });

  test("GET /api/profile allows admin to view any user's profile", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "1", email: "admin@club.com", name: "Alice Admin", role: "admin" },
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

  test("GET /api/profile returns 404 when requested user is not found", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "1", email: "admin@club.com", name: "Alice Admin", role: "admin" },
    });

    const req = new NextRequest("http://localhost:3000/api/profile?id=999");
    const res = await getProfile(req);
    expect(res.status).toBe(404);
  });
});
