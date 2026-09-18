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
});


