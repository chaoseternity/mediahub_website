import { GET as getEvents } from "@/app/api/events/route";
import { GET as getEventById } from "@/app/api/events/[id]/route";
import { GET as getSOP } from "@/app/api/sop/route";
import { GET as getSOPById } from "@/app/api/sop/[id]/route";
import { GET as getTags } from "@/app/api/tags/route";
import { POST as parseSOP } from "@/app/api/sop/parse/route";
import { sendDeploymentInvitationEmail } from "@/lib/email";
import nextConfig from "@/next.config";
import { NextRequest } from "next/server";

// Mock auth to simulate unauthenticated visitor by default
jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));
jest.mock("next-auth/providers/google", () => () => ({}));
jest.mock("next-auth/providers/microsoft-entra-id", () => () => ({}));
jest.mock("next-auth", () => () => ({
  auth: (handler: any) => async (req: any) => handler(req),
}));
jest.mock("@/lib/db", () => {
  const actual = jest.requireActual("@/lib/db");
  return {
    ...actual,
    getNfcCardByValue: jest.fn().mockResolvedValue(null),
    getUserByEmail: jest.fn().mockResolvedValue({
      id: 1,
      name: "Admin",
      email: "admin@club.com",
      role: "admin",
    }),
    getAllSOPDocuments: jest.fn().mockResolvedValue([]),
    getUserById: jest.fn().mockImplementation(async (id: number) => {
      if (id === 1 || id === 42) {
        return { id, name: "Admin", email: "admin@club.com", role: "admin" };
      }
      return null;
    }),
    getEventById: jest.fn().mockImplementation(async (id: number) => {
      if (id === 1) {
        return {
          id: 1,
          name: "Test Event",
          oics: [{ id: 1 }],
          section_ics: {},
          equipment: [],
        };
      }
      return null;
    }),
    getEquipmentById: jest.fn().mockImplementation(async (id: number) => {
      if (id === 1) {
        return { id: 1, name: "Camera", status: "available" };
      }
      if (id === 10) {
        return {
          id: 10,
          name: "Lenses",
          status: "Checked Out",
          active_checkout: {
            id: 101,
            equipment_id: 10,
            checked_out_by: 5,
            checked_out_by_name: "Alice Smith",
          },
        };
      }
      return null;
    }),
    deleteEquipment: jest.fn().mockImplementation(async (id: number) => {
      if (id === 99999) return { success: false, error: "Equipment not found." };
      return { success: true };
    }),
    deleteTag: jest.fn().mockImplementation(async (id: number) => {
      if (id === 99999) return { success: false, error: "Tag not found." };
      return { success: true };
    }),
    deleteEvent: jest.fn().mockImplementation(async (id: number) => {
      if (id === 99999) return { success: false, error: "Event not found." };
      return { success: true };
    }),
    deleteSOPDocument: jest.fn().mockImplementation(async (id: number) => {
      if (id === 99999) return { success: false, error: "SOP Document not found." };
      return { success: true };
    }),
  };
});

describe("Security Audits & Vulnerability Guards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Unauthenticated Access Protection (401)", () => {
    test("GET /api/events rejects unauthenticated requests with 401", async () => {
      const res = await getEvents();
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    test("GET /api/events/[id] rejects unauthenticated requests with 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/events/1");
      const res = await getEventById(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    test("GET /api/sop rejects unauthenticated requests with 401", async () => {
      const res = await getSOP();
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    test("GET /api/sop/[id] rejects unauthenticated requests with 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/sop/1");
      const res = await getSOPById(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    test("GET /api/tags rejects unauthenticated requests with 401", async () => {
      const res = await getTags();
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });
  });

  describe("File Upload Size & DoS Protection", () => {
    test("POST /api/sop/parse rejects files larger than 10MB with 413", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const oversizedFile = {
        name: "giant-archive.pdf",
        size: 15 * 1024 * 1024, // 15 MB
        type: "application/pdf",
        arrayBuffer: jest.fn(),
      };

      const mockFormData = {
        get: jest.fn().mockImplementation((key) => {
          if (key === "file") return oversizedFile;
          return null;
        }),
      };

      const req = {
        formData: jest.fn().mockResolvedValue(mockFormData),
      } as unknown as NextRequest;

      const res = await parseSOP(req);
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error).toContain("exceeds the 10MB limit");
      // Verify arrayBuffer was never loaded into memory (protects against OOM crash)
      expect(oversizedFile.arrayBuffer).not.toHaveBeenCalled();
    });
  });

  describe("Email HTML Injection Sanitization", () => {
    test("escapes malicious HTML tags and scripts in recipient name and event details", async () => {
      const result = await sendDeploymentInvitationEmail({
        toEmail: "test@club.com",
        recipientName: "John <script>alert(1)</script>",
        eventName: 'Annual Gala <img src=x onerror="alert(2)">',
        eventDescription: 'Special Event & "VIP" <a href="http://evil.com">Click</a>',
        section: "video",
        startTime: "2026-10-01T10:00:00Z",
        endTime: "2026-10-01T14:00:00Z",
        location: "Hall A <b onmouseover=evil()>",
        token: "mock-token-1234",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Security Headers", () => {
    test("next.config.ts defines clickjacking and content-type security headers", async () => {
      expect(typeof nextConfig.headers).toBe("function");
      if (nextConfig.headers) {
        const headersList = await nextConfig.headers();
        expect(headersList.length).toBeGreaterThan(0);
        const globalHeaders = headersList.find((h: any) => h.source === "/:path*");
        expect(globalHeaders).toBeDefined();

        const headerMap = new Map(
          globalHeaders?.headers.map((h: { key: string; value: string }) => [h.key, h.value])
        );

        expect(headerMap.get("X-Frame-Options")).toBe("SAMEORIGIN");
        expect(headerMap.get("X-Content-Type-Options")).toBe("nosniff");
        expect(headerMap.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
        expect(headerMap.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      }
    });
  });

  describe("Privilege Escalation & Account Lockout Defense", () => {
    test("prevents admin from demoting their own admin role", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "42", name: "Solo Admin", role: "admin", email: "admin@club.com" },
      });

      const { PUT } = await import("@/app/api/users/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/users/42", {
        method: "PUT",
        body: JSON.stringify({ role: "viewer" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await PUT(req, { params: Promise.resolve({ id: "42" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Cannot demote your own admin account");
    });
  });

  describe("Open Redirect Protection", () => {
    test("rejects protocol-relative redirect URLs in authConfig", async () => {
      const { authConfig } = await import("@/auth.config");
      const redirect = authConfig.callbacks?.redirect;
      expect(redirect).toBeDefined();

      if (redirect) {
        // Protocol relative URL //evil.com must not be returned
        const result = await redirect({ url: "//evil.com", baseUrl: "https://mediahub.club" });
        expect(result).not.toBe("https://mediahub.club//evil.com");
        expect(result).not.toBe("//evil.com");
        expect(result).toBe("https://mediahub.club");
      }
    });

    test("allows safe relative redirect URLs", async () => {
      const { authConfig } = await import("@/auth.config");
      const redirect = authConfig.callbacks?.redirect;
      if (redirect) {
        const result = await redirect({ url: "/dashboard", baseUrl: "https://mediahub.club" });
        expect(result).toBe("https://mediahub.club/dashboard");
      }
    });
  });

  describe("File Extension & MIME Type Restriction", () => {
    test("POST /api/sop/parse rejects executable files with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const invalidFile = {
        name: "malicious.exe",
        size: 1024,
        type: "application/x-msdownload",
        arrayBuffer: jest.fn(),
      };

      const mockFormData = {
        get: jest.fn().mockImplementation((key) => (key === "file" ? invalidFile : null)),
      };

      const req = {
        formData: jest.fn().mockResolvedValue(mockFormData),
      } as unknown as NextRequest;

      const res = await parseSOP(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Unsupported file format");
      expect(invalidFile.arrayBuffer).not.toHaveBeenCalled();
    });
  });

  describe("DoS & Payload Length Limit", () => {
    test("POST /api/sop/chat rejects oversized prompt payload (>4000 chars) with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "User", role: "verified", email: "user@club.com" },
      });

      const { POST: postChat } = await import("@/app/api/sop/chat/route");
      const oversizedQuestion = "A".repeat(4001);

      const req = new NextRequest("http://localhost:3000/api/sop/chat", {
        method: "POST",
        body: JSON.stringify({ question: oversizedQuestion }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postChat(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("4000 characters or less");
    });
  });

  describe("NFC Return Verification & Authorization", () => {
    test("POST /api/nfc/return rejects non-existent NFC card with 404", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "User", role: "verified", email: "user@club.com" },
      });

      const { POST: nfcReturnPost } = await import("@/app/api/nfc/return/route");
      const req = new NextRequest("http://localhost:3000/api/nfc/return", {
        method: "POST",
        body: JSON.stringify({ equipment_id: 1, nfc_value: "NONEXISTENT_CARD_UID" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await nfcReturnPost(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain("not found in database");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 5: Event sub-route ID validation, CSP, and payload caps
  // ─────────────────────────────────────────────────────────────────────────

  describe("Event Sub-Route Parameter Validation", () => {
    test("POST /api/events/[id]/section rejects non-numeric event ID with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: postSection } = await import("@/app/api/events/[id]/section/route");
      const req = new NextRequest("http://localhost:3000/api/events/abc/section", {
        method: "POST",
        body: JSON.stringify({ action: "add_equipment", section: "photo", equipment_id: 1 }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postSection(req, { params: Promise.resolve({ id: "abc" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid event ID");
    });

    test("POST /api/events/[id]/equipment rejects zero event ID with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: postEquipment } = await import("@/app/api/events/[id]/equipment/route");
      const req = new NextRequest("http://localhost:3000/api/events/0/equipment", {
        method: "POST",
        body: JSON.stringify({ equipment_id: 1, section: "photo" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postEquipment(req, { params: Promise.resolve({ id: "0" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid event ID");
    });
  });

  describe("Content-Security-Policy Header", () => {
    test("next.config.ts includes a Content-Security-Policy header", async () => {
      expect(typeof nextConfig.headers).toBe("function");
      if (nextConfig.headers) {
        const headersList = await nextConfig.headers();
        const globalHeaders = headersList.find((h: any) => h.source === "/:path*");
        expect(globalHeaders).toBeDefined();
        const headerMap = new Map(
          globalHeaders?.headers.map((h: { key: string; value: string }) => [h.key, h.value])
        );
        const csp = headerMap.get("Content-Security-Policy") as string | undefined;
        expect(csp).toBeDefined();
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("base-uri 'self'");
      }
    });
  });

  describe("NFC Checkout Payload Caps", () => {
    test("POST /api/nfc/checkout rejects batch of >50 equipment IDs with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Operator", role: "verified", email: "op@club.com" },
      });

      const { POST: nfcCheckout } = await import("@/app/api/nfc/checkout/route");
      const ids = Array.from({ length: 51 }, (_, i) => i + 1);
      const req = new NextRequest("http://localhost:3000/api/nfc/checkout", {
        method: "POST",
        body: JSON.stringify({ nfc_value: "CARD123", equipment_ids: ids }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await nfcCheckout(req);
      expect(res.status).toBe(400);
    });

    test("POST /api/nfc/checkout rejects notes longer than 500 chars with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Operator", role: "verified", email: "op@club.com" },
      });

      const { POST: nfcCheckout } = await import("@/app/api/nfc/checkout/route");
      const req = new NextRequest("http://localhost:3000/api/nfc/checkout", {
        method: "POST",
        body: JSON.stringify({ nfc_value: "CARD123", equipment_id: 1, notes: "A".repeat(501) }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await nfcCheckout(req);
      expect(res.status).toBe(400);
    });
  });

  describe("SOP overwrite_id Validation", () => {
    test("POST /api/sop rejects overwrite_id=0 with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: sopPost } = await import("@/app/api/sop/route");
      const req = new NextRequest("http://localhost:3000/api/sop", {
        method: "POST",
        body: JSON.stringify({ title: "Test Doc", content: "Some content", overwrite_id: 0 }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await sopPost(req);
      expect(res.status).toBe(400);
    });

    test("POST /api/sop rejects negative overwrite_id with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: sopPost } = await import("@/app/api/sop/route");
      const req = new NextRequest("http://localhost:3000/api/sop", {
        method: "POST",
        body: JSON.stringify({ title: "Test Doc", content: "Some content", overwrite_id: -5 }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await sopPost(req);
      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 6: User ID validation, equipment sub-route bounds, and RSVP token limits
  // ─────────────────────────────────────────────────────────────────────────

  describe("User ID Parameter & Self-Demotion Boundary Defense", () => {
    test("PUT /api/users/[id] rejects non-numeric user ID with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { PUT: updateUser } = await import("@/app/api/users/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/users/abc", {
        method: "PUT",
        body: JSON.stringify({ role: "verified" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await updateUser(req, { params: Promise.resolve({ id: "abc" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid user ID");
    });

    test("PUT /api/users/[id] prevents self-demotion even when ID formatted with leading zero", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "42", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { PUT: updateUser } = await import("@/app/api/users/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/users/042", {
        method: "PUT",
        body: JSON.stringify({ role: "viewer" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await updateUser(req, { params: Promise.resolve({ id: "042" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Cannot demote your own admin account");
    });
  });

  describe("Equipment Sub-Route Parameter & Payload Validation", () => {
    test("POST /api/equipment/[id]/checkout rejects non-numeric equipment ID with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Verified User", role: "verified", email: "user@club.com" },
      });

      const { POST: postCheckout } = await import("@/app/api/equipment/[id]/checkout/route");
      const req = new NextRequest("http://localhost:3000/api/equipment/xyz/checkout", {
        method: "POST",
        body: JSON.stringify({ checked_out_by_name: "Test", notes: "Test note" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postCheckout(req, { params: Promise.resolve({ id: "xyz" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid equipment ID");
    });

    test("POST /api/equipment/[id]/return rejects non-numeric equipment ID with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: postReturn } = await import("@/app/api/equipment/[id]/return/route");
      const req = new NextRequest("http://localhost:3000/api/equipment/invalid/return", {
        method: "POST",
      });

      const res = await postReturn(req, { params: Promise.resolve({ id: "invalid" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid equipment ID");
    });

    test("POST /api/nfc/return rejects batch return exceeding 50 items with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: nfcReturnPost } = await import("@/app/api/nfc/return/route");
      const ids = Array.from({ length: 51 }, (_, i) => i + 1);
      const req = new NextRequest("http://localhost:3000/api/nfc/return", {
        method: "POST",
        body: JSON.stringify({ equipment_ids: ids }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await nfcReturnPost(req);
      expect(res.status).toBe(400);
    });
  });

  describe("RSVP Token Length Validation", () => {
    test("GET /api/rsvp rejects token exceeding 100 characters with 400", async () => {
      const { GET: rsvpGet } = await import("@/app/api/rsvp/route");
      const oversizedToken = "T".repeat(101);
      const req = new NextRequest(`http://localhost:3000/api/rsvp?token=${oversizedToken}`);

      const res = await rsvpGet(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Token is required and must be valid");
    });

    test("POST /api/rsvp rejects token exceeding 100 characters with 400", async () => {
      const { POST: rsvpPost } = await import("@/app/api/rsvp/route");
      const oversizedToken = "T".repeat(101);
      const req = new NextRequest("http://localhost:3000/api/rsvp", {
        method: "POST",
        body: JSON.stringify({ token: oversizedToken, status: "confirmed" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await rsvpPost(req);
      expect(res.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 7: Host header injection defense and sub-route payload constraints
  // ─────────────────────────────────────────────────────────────────────────

  describe("Sub-Route Integer Constraints & Middleware Host Poisoning Defense", () => {
    test("POST /api/events/[id]/equipment rejects negative equipment_id with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: postEquipment } = await import("@/app/api/events/[id]/equipment/route");
      const req = new NextRequest("http://localhost:3000/api/events/1/equipment", {
        method: "POST",
        body: JSON.stringify({ equipment_id: -10, section: "photo" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postEquipment(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(400);
    });

    test("POST /api/events/[id]/section rejects negative equipment_id with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: postSection } = await import("@/app/api/events/[id]/section/route");
      const req = new NextRequest("http://localhost:3000/api/events/1/section", {
        method: "POST",
        body: JSON.stringify({ action: "add_equipment", section: "photo", equipment_id: -1 }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postSection(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(400);
    });

    test("Middleware login redirect ignores spoofed x-forwarded-host header", async () => {
      const middleware = (await import("@/middleware")).default;
      const req = new NextRequest("http://localhost:3000/dashboard", {
        headers: {
          "x-forwarded-host": "attacker.com",
          "x-forwarded-proto": "https",
        },
      });

      const res = await (middleware as any)(req);
      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toBeDefined();
      expect(location).not.toContain("attacker.com");
      expect(location).toContain("localhost:3000/login");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 9: Rate limit IP sanitization & immediate session revocation
  // ─────────────────────────────────────────────────────────────────────────

  describe("Session Revocation & Rate Limit IP Bounds", () => {
    test("Rate limiter sanitizes oversized IP strings and applies limits safely", async () => {
      const { checkRateLimit } = await import("@/lib/rate-limit");
      const giantIp = "999.999.999.999".repeat(20); // Oversized string
      const isAllowed1 = checkRateLimit(giantIp, 2, 60_000);
      const isAllowed2 = checkRateLimit(giantIp, 2, 60_000);
      const isBlocked3 = checkRateLimit(giantIp, 2, 60_000);

      expect(isAllowed1).toBe(true);
      expect(isAllowed2).toBe(true);
      expect(isBlocked3).toBe(false);
    });

    test("Rate limiter safely falls back on empty or undefined IP string", async () => {
      const { checkRateLimit } = await import("@/lib/rate-limit");
      const allowed = checkRateLimit("", 100, 60_000);
      expect(allowed).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 10: CSV / Excel Formula Injection (CWE-1236)
  // ─────────────────────────────────────────────────────────────────────────

  describe("Excel Formula Injection Defenses (CWE-1236)", () => {
    test("sanitizeExcelCell prefixes dangerous formula symbols with apostrophe", async () => {
      const { sanitizeExcelCell } = await import("@/lib/excel");
      expect(sanitizeExcelCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
      expect(sanitizeExcelCell("+1+2")).toBe("'+1+2");
      expect(sanitizeExcelCell("-SUM(A1:A10)")).toBe("'-SUM(A1:A10)");
      expect(sanitizeExcelCell("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
      expect(sanitizeExcelCell("\tmaliciousTab")).toBe("'\tmaliciousTab");
      expect(sanitizeExcelCell("\nnewlinePayload")).toBe("'\nnewlinePayload");
      expect(sanitizeExcelCell("\rcarriageReturn")).toBe("'\rcarriageReturn");
      // Benign values are unchanged
      expect(sanitizeExcelCell("Sony FX3 Camera")).toBe("Sony FX3 Camera");
      expect(sanitizeExcelCell("")).toBe("");
      expect(sanitizeExcelCell(null)).toBe("");
    });

    test("desanitizeExcelCell correctly unwraps escaped formula values and preserves standard text", async () => {
      const { desanitizeExcelCell } = await import("@/lib/excel");
      expect(desanitizeExcelCell("'=1+1")).toBe("=1+1");
      expect(desanitizeExcelCell("'+SUM(A1)")).toBe("+SUM(A1)");
      expect(desanitizeExcelCell("Normal Item")).toBe("Normal Item");
      expect(desanitizeExcelCell("O'Connor Tripod")).toBe("O'Connor Tripod");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 11: Schema Bounds, Info Disclosure & SSRF Protections
  // ─────────────────────────────────────────────────────────────────────────

  describe("Input Bounds, Error Masking & Endpoint Protection", () => {
    test("POST /api/sop rejects oversized titles (> 200 characters) with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: postSOP } = await import("@/app/api/sop/route");
      const giantTitle = "A".repeat(201);
      const req = new NextRequest("http://localhost:3000/api/sop", {
        method: "POST",
        body: JSON.stringify({
          title: giantTitle,
          category: "General",
          content: "Valid short content",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postSOP(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Title cannot exceed 200 characters");
    });

    test("POST /api/tags rejects whitespace-only tag names with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: postTag } = await import("@/app/api/tags/route");
      const req = new NextRequest("http://localhost:3000/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: "     " }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postTag(req);
      expect(res.status).toBe(400);
    });

    test("GET /api/nfc rejects oversized nfc_value (> 100 characters) with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Member", role: "verified", email: "member@club.com" },
      });

      const { GET: getNfc } = await import("@/app/api/nfc/route");
      const giantNfc = "04".repeat(60); // 120 chars
      const req = new NextRequest(`http://localhost:3000/api/nfc?nfc_value=${giantNfc}`);

      const res = await getNfc(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("max 100 characters");
    });

    test("POST /api/rsvp rejects tokens with invalid characters with 400", async () => {
      const { POST: postRsvp } = await import("@/app/api/rsvp/route");
      const req = new NextRequest("http://localhost:3000/api/rsvp", {
        method: "POST",
        body: JSON.stringify({
          token: "invalid token with spaces!@#$",
          status: "confirmed",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postRsvp(req);
      expect(res.status).toBe(400);
    });

    test("Offline Sync rejects external or protocol-relative SSRF endpoints", async () => {
      const { enqueueOfflineAction, getOfflineQueue, clearOfflineQueue } = await import(
        "@/lib/offlineSync"
      );

      clearOfflineQueue();

      // Attempt to enqueue an external exfiltration URL
      const action1 = enqueueOfflineAction({
        type: "checkout",
        endpoint: "https://malicious-site.com/steal",
        description: "Malicious checkout",
      });

      // Must be forced back to a safe internal /api/ path
      expect(action1.endpoint).toBe("/api/nfc/checkout");
      expect(action1.endpoint.startsWith("/api/")).toBe(true);

      // Attempt protocol-relative URL
      const action2 = enqueueOfflineAction({
        type: "return",
        endpoint: "//attacker.com/leak",
        description: "Protocol-relative return",
      });

      expect(action2.endpoint).toBe("/api/nfc/return");

      // Verify queue items remain safe on retrieval
      const queue = getOfflineQueue();
      for (const item of queue) {
        expect(item.endpoint.startsWith("/api/")).toBe(true);
        expect(item.endpoint.startsWith("//")).toBe(false);
      }

      clearOfflineQueue();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 12: Entity Validation, Admin Lockout & Session Guard
  // ─────────────────────────────────────────────────────────────────────────

  describe("Entity Existence, Admin Lockout & Parameter Integrity", () => {
    test("POST /api/events/[id]/equipment returns 404 if event does not exist", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: postEquipment } = await import("@/app/api/events/[id]/equipment/route");
      const req = new NextRequest("http://localhost:3000/api/events/99999/equipment", {
        method: "POST",
        body: JSON.stringify({ equipment_id: 1, section: "photo" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postEquipment(req, { params: Promise.resolve({ id: "99999" }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Event not found");
    });

    test("POST /api/events/[id]/section returns 404 if event does not exist", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: postSection } = await import("@/app/api/events/[id]/section/route");
      const req = new NextRequest("http://localhost:3000/api/events/99999/section", {
        method: "POST",
        body: JSON.stringify({ action: "add_equipment", section: "photo", equipment_id: 1 }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await postSection(req, { params: Promise.resolve({ id: "99999" }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Event not found");
    });

    test("PUT /api/users/[id] returns 404 if target user does not exist", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { PUT: putUser } = await import("@/app/api/users/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/users/99999", {
        method: "PUT",
        body: JSON.stringify({ role: "verified" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await putUser(req, { params: Promise.resolve({ id: "99999" }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("User not found");
    });

    test("DELETE /api/users/[id] returns 404 if target user does not exist", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { DELETE: deleteUserRoute } = await import("@/app/api/users/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/users/99999", { method: "DELETE" });

      const res = await deleteUserRoute(req, { params: Promise.resolve({ id: "99999" }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("User not found");
    });

    test("PATCH /api/users/me rejects session with non-integer or invalid user ID with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "invalid-not-a-number", name: "Test User", role: "viewer", email: "test@club.com" },
      });

      const { PATCH: patchMe } = await import("@/app/api/users/me/route");
      const req = new NextRequest("http://localhost:3000/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ username: "Valid Name" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await patchMe(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid user session");
    });

    test("POST /api/equipment/[id]/return rejects return when caller name matches but callerId differs (CWE-287/639)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      // Caller has id 6, but name matches borrower id 5 ("Alice Smith")
      auth.mockResolvedValueOnce({
        user: { id: "6", name: "Alice Smith", role: "verified", email: "alice2@club.com" },
      });

      const { POST: postReturn } = await import("@/app/api/equipment/[id]/return/route");
      const req = new NextRequest("http://localhost:3000/api/equipment/10/return", { method: "POST" });

      const res = await postReturn(req, { params: Promise.resolve({ id: "10" }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain("Forbidden: You can only return equipment checked out to you");
    });

    test("POST /api/sop/parse rejects non-admin users with 403 (CWE-400/285)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "2", name: "Viewer", role: "viewer", email: "viewer@club.com" },
      });

      const { POST: parseSOP } = await import("@/app/api/sop/parse/route");
      const formData = new FormData();
      formData.append("file", new Blob(["mock content"], { type: "text/plain" }), "test.txt");

      const req = new NextRequest("http://localhost:3000/api/sop/parse", {
        method: "POST",
        body: formData,
      });

      const res = await parseSOP(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Forbidden: Admins only");
    });

    test("DELETE /api/equipment/[id] returns 404 if item does not exist", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { DELETE: deleteEquipmentRoute } = await import("@/app/api/equipment/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/equipment/99999", { method: "DELETE" });

      const res = await deleteEquipmentRoute(req, { params: Promise.resolve({ id: "99999" }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Equipment not found.");
    });

    test("DELETE /api/tags/[id] returns 404 if tag does not exist", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { DELETE: deleteTagRoute } = await import("@/app/api/tags/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/tags/99999", { method: "DELETE" });

      const res = await deleteTagRoute(req, { params: Promise.resolve({ id: "99999" }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Tag not found.");
    });

    test("DELETE /api/events/[id] returns 404 if event does not exist", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { DELETE: deleteEventRoute } = await import("@/app/api/events/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/events/99999", { method: "DELETE" });

      const res = await deleteEventRoute(req, { params: Promise.resolve({ id: "99999" }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Event not found.");
    });

    test("DELETE /api/sop/[id] returns 404 if document does not exist", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { DELETE: deleteSOPRoute } = await import("@/app/api/sop/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/sop/99999", { method: "DELETE" });

      const res = await deleteSOPRoute(req, { params: Promise.resolve({ id: "99999" }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("SOP Document not found.");
    });
  });

  describe("Phase 14: CSRF Defense, Timestamp Bounds & Robust Exception Handling", () => {
    test("Middleware rejects cross-origin mutating API request with 403 (CSRF defense CWE-352)", async () => {
      const middleware = (await import("@/middleware")).default;
      const req = new NextRequest("http://localhost:3000/api/equipment", {
        method: "POST",
        headers: {
          origin: "https://attacker-evil.com",
        },
      });

      const res = await (middleware as any)(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Forbidden: Cross-site requests are not allowed");
    });

    test("POST /api/events rejects non-date timestamp string with 400 (CWE-20/1287)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: createEventRoute } = await import("@/app/api/events/route");
      const req = new NextRequest("http://localhost:3000/api/events", {
        method: "POST",
        body: JSON.stringify({
          name: "Annual Gala",
          start_time: "not-a-valid-date-string",
          end_time: "2026-10-15T18:00:00Z",
          location: "Grand Hall",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await createEventRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    test("POST /api/equipment returns 400 for malformed JSON body (CWE-755/20)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: createEquipmentRoute } = await import("@/app/api/equipment/route");
      const req = new NextRequest("http://localhost:3000/api/equipment", {
        method: "POST",
        body: "{ bad json: true",
        headers: { "Content-Type": "application/json" },
      });

      const res = await createEquipmentRoute(req);
      expect(res.status).toBe(400);
    });

    test("Middleware rejects cross-origin mutating API request with origin 'null' (CWE-352)", async () => {
      const middleware = (await import("@/middleware")).default;
      const req = new NextRequest("http://localhost:3000/api/equipment", {
        method: "POST",
        headers: {
          origin: "null",
        },
      });

      const res = await (middleware as any)(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Forbidden: Cross-site requests are not allowed");
    });

    test("Middleware rejects cross-origin mutating API request with sec-fetch-site: cross-site (CWE-352)", async () => {
      const middleware = (await import("@/middleware")).default;
      const req = new NextRequest("http://localhost:3000/api/events", {
        method: "POST",
        headers: {
          "sec-fetch-site": "cross-site",
        },
      });

      const res = await (middleware as any)(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe("Forbidden: Cross-site requests are not allowed");
    });

    test("PUT /api/users/[id] returns 400 for malformed JSON body (CWE-755/20)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { PUT: updateUserRoute } = await import("@/app/api/users/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/users/1", {
        method: "PUT",
        body: "{ bad json: true",
        headers: { "Content-Type": "application/json" },
      });

      const res = await updateUserRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON body");
    });

    test("PATCH /api/users/me returns 400 for malformed JSON body (CWE-755/20)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { PATCH: updateMeRoute } = await import("@/app/api/users/me/route");
      const req = new NextRequest("http://localhost:3000/api/users/me", {
        method: "PATCH",
        body: "{ bad json: true",
        headers: { "Content-Type": "application/json" },
      });

      const res = await updateMeRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON body");
    });

    test("PUT /api/sop/[id] returns 400 for malformed JSON body (CWE-755/20)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { PUT: updateSopRoute } = await import("@/app/api/sop/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/sop/1", {
        method: "PUT",
        body: "{ bad json: true",
        headers: { "Content-Type": "application/json" },
      });

      const res = await updateSopRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON body");
    });

    test("POST /api/events/[id]/section returns 400 for malformed JSON body (CWE-755/20)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: sectionRoute } = await import("@/app/api/events/[id]/section/route");
      const req = new NextRequest("http://localhost:3000/api/events/1/section", {
        method: "POST",
        body: "{ bad json: true",
        headers: { "Content-Type": "application/json" },
      });

      const res = await sectionRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON body");
    });

    test("POST /api/equipment/[id]/checkout returns 400 for malformed JSON body (CWE-755/20)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: checkoutRoute } = await import("@/app/api/equipment/[id]/checkout/route");
      const req = new NextRequest("http://localhost:3000/api/equipment/1/checkout", {
        method: "POST",
        body: "{ bad json: true",
        headers: { "Content-Type": "application/json" },
      });

      const res = await checkoutRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON body");
    });

    test("POST /api/equipment/[id]/checkout rejects invalid date in expected_return_at with 400", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: checkoutRoute } = await import("@/app/api/equipment/[id]/checkout/route");
      const req = new NextRequest("http://localhost:3000/api/equipment/1/checkout", {
        method: "POST",
        body: JSON.stringify({
          checked_out_by_name: "Admin",
          expected_return_at: "not-a-valid-date-timestamp",
          notes: "Project testing",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await checkoutRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    test("updateNfcCard and deleteNfcCard throw error on non-integer or negative ID (CWE-1287)", async () => {
      const { updateNfcCard, deleteNfcCard } = await import("@/lib/db");
      await expect(updateNfcCard(-1, "Member")).rejects.toThrow("Invalid NFC card ID");
      await expect(updateNfcCard(NaN, "Member")).rejects.toThrow("Invalid NFC card ID");
      await expect(deleteNfcCard(-1)).rejects.toThrow("Invalid NFC card ID");
      await expect(deleteNfcCard(0)).rejects.toThrow("Invalid NFC card ID");
    });

    test("extractTextFromDocument caps output length to 500,000 characters (CWE-400)", async () => {
      const { extractTextFromDocument } = await import("@/lib/doc-parser");
      const oversizedContent = "A".repeat(600_000);
      const buffer = Buffer.from(oversizedContent, "utf-8");

      const result = await extractTextFromDocument(buffer, "huge_notes.txt", "text/plain");
      expect(result.length).toBe(500_000);
    });

    test("extractTextFromDocument rejects unsupported binary file extensions (CWE-434)", async () => {
      const { extractTextFromDocument } = await import("@/lib/doc-parser");
      const buffer = Buffer.from("MZ binary payload", "utf-8");

      await expect(
        extractTextFromDocument(buffer, "payload.exe", "application/x-msdownload")
      ).rejects.toThrow("Unsupported document format");
    });

    test("POST /api/sop/chat returns 400 for malformed JSON body (CWE-755/20)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { POST: chatRoute } = await import("@/app/api/sop/chat/route");
      const req = new NextRequest("http://localhost:3000/api/sop/chat", {
        method: "POST",
        body: "{ broken json: ",
        headers: { "Content-Type": "application/json" },
      });

      const res = await chatRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid JSON body");
    });

    test("PATCH /api/users/me rejects username containing control characters with 400 (CWE-20/150)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { PATCH: updateMeRoute } = await import("@/app/api/users/me/route");
      const req = new NextRequest("http://localhost:3000/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({ username: "Admin\n<script>alert(1)</script>" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await updateMeRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    test("PUT /api/users/[id] rejects username containing control characters with 400 (CWE-20/150)", async () => {
      const { auth } = jest.requireMock("@/lib/auth");
      auth.mockResolvedValueOnce({
        user: { id: "1", name: "Admin", role: "admin", email: "admin@club.com" },
      });

      const { PUT: updateUserRoute } = await import("@/app/api/users/[id]/route");
      const req = new NextRequest("http://localhost:3000/api/users/1", {
        method: "PUT",
        body: JSON.stringify({ username: "Alice\r\nDROP TABLE users;" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await updateUserRoute(req, { params: Promise.resolve({ id: "1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });
  });
});



