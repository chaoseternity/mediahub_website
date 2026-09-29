import { GET as getUsers } from "@/app/api/users/route";
import { auth } from "@/lib/auth";
import { getAllUsers } from "@/lib/db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/db", () => ({
  getAllUsers: jest.fn(),
}));

describe("Users API (GET /api/users)", () => {
  const fullUsers = [
    {
      id: 1,
      name: "Alice Admin",
      email: "admin@club.com",
      google_id: "g-1",
      image: "https://img/alice.png",
      role: "admin",
      provider: "google",
      created_at: "2026-01-01 00:00:00",
    },
    {
      id: 2,
      name: "Charlie Verified",
      email: "charlie@club.com",
      google_id: null,
      image: null,
      role: "verified",
      provider: "credentials",
      created_at: "2026-01-02 00:00:00",
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (getAllUsers as jest.Mock).mockResolvedValue(fullUsers);
  });

  test("returns 401 when not logged in", async () => {
    (auth as jest.Mock).mockResolvedValue(null);
    const res = await getUsers();
    expect(res.status).toBe(401);
  });

  test("returns full user records for admins", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "admin" } });
    const res = await getUsers();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fullUsers);
  });

  test.each([
    ["verified", "2"],
    ["viewer", "3"],
  ])("returns a minimal directory (id, name, image) for %s users", async (role, id) => {
    (auth as jest.Mock).mockResolvedValue({ user: { id, role } });
    const res = await getUsers();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      { id: 1, name: "Alice Admin", image: "https://img/alice.png" },
      { id: 2, name: "Charlie Verified", image: null },
    ]);
    for (const u of body) {
      expect(Object.keys(u).sort()).toEqual(["id", "image", "name"]);
      expect(u).not.toHaveProperty("username");
      expect(u).not.toHaveProperty("email");
      expect(u).not.toHaveProperty("google_id");
      expect(u).not.toHaveProperty("role");
      expect(u).not.toHaveProperty("provider");
    }
  });
});
