import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import {
  createEquipment,
  upsertUser,
  createCheckout,
  returnCheckout,
  generateHandoverCode,
  claimHandoverCode,
  getHandoverCodeDetails,
  getActiveCheckoutByEquipmentId,
  getEquipmentById,
} from "@/lib/db";
import { POST as claimHandoverRoute } from "@/app/api/handover/claim/route";
import { GET as getHandoverRoute } from "@/app/api/handover/[code]/route";
import { POST as createHandoverRoute } from "@/app/api/equipment/[id]/handover/route";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";
import type { Role, User } from "@/lib/types";

const HANDOVER_CODE_FORMAT = /^HD-\d{6}$/;

function mockSession(user: User, role: Role = user.role) {
  (auth as jest.Mock).mockResolvedValue({
    user: { id: String(user.id), email: user.email, name: user.name, role },
  });
}

async function makeUser(name: string, role: Role): Promise<User> {
  const slug = name.toLowerCase().replace(/\s+/g, ".");
  return upsertUser({
    name,
    email: `${slug}@school.edu`,
    google_id: `google_${slug}`,
    image: null,
    provider: "google",
    role,
  });
}

async function makeEquipment(name: string) {
  return createEquipment({
    name,
    tags: [],
    status: "Available",
    condition: "Working",
    location: "Cabinet 1",
  });
}

describe("Peer-to-Peer Handover Protocol", () => {
  let db: any;

  beforeEach(() => {
    db = makeTestDb();
    setTestDb(db);
    (auth as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    setTestDb(null);
  });

  test("admin borrower generates a 6-digit code and a peer claims ownership", async () => {
    const owner = await makeUser("Owner Alice", "admin");
    const peer = await makeUser("Peer Charlie", "verified");
    const eq = await makeEquipment("Sony FX6 Camera");

    await createCheckout({
      equipment_id: eq.id,
      checked_out_by: owner.id,
      checked_out_by_name: owner.name,
      notes: "Project A",
    });

    const handover = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });
    expect(handover.code).toMatch(HANDOVER_CODE_FORMAT);
    expect(handover.status).toBe("active");

    const details = await getHandoverCodeDetails(handover.code);
    expect(details?.equipment_name).toBe("Sony FX6 Camera");

    mockSession(peer);
    const res = await claimHandoverRoute(
      new NextRequest("http://localhost/api/handover/claim", {
        method: "POST",
        body: JSON.stringify({ code: handover.code }),
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const newActiveCheckout = await getActiveCheckoutByEquipmentId(eq.id);
    expect(newActiveCheckout?.checked_out_by).toBe(peer.id);
    expect((await getEquipmentById(eq.id))?.status).toBe("Checked Out");

    // Exactly one open checkout remains for the item.
    const open = db
      .prepare("SELECT COUNT(*) AS n FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
      .get(eq.id);
    expect(open.n).toBe(1);
  });

  test("codes are generated as HD- followed by 6 digits", async () => {
    const owner = await makeUser("Owner Alice", "admin");
    for (let i = 0; i < 5; i++) {
      const eq = await makeEquipment(`Item ${i}`);
      await createCheckout({ equipment_id: eq.id, checked_out_by: owner.id, checked_out_by_name: owner.name });
      const h = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });
      expect(h.code).toMatch(HANDOVER_CODE_FORMAT);
    }
  });

  test("prevents user from claiming their own handover", async () => {
    const owner = await makeUser("Owner Alice", "admin");
    const eq = await makeEquipment("Wireless Mic Set");
    await createCheckout({ equipment_id: eq.id, checked_out_by: owner.id, checked_out_by_name: owner.name });

    const handover = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });
    const claimRes = await claimHandoverCode({
      code: handover.code,
      claimed_by_id: owner.id,
      claimed_by_name: owner.name,
    });

    expect(claimRes.success).toBe(false);
    expect(claimRes.error).toContain("handover equipment to yourself");
  });

  test("rejects handover for NFC-station checkouts", async () => {
    const admin = await makeUser("Admin Alice", "admin");
    const eq = await makeEquipment("NFC Camera");
    await createCheckout({
      equipment_id: eq.id,
      checked_out_by: null,
      checked_out_by_name: "NFC Member",
      nfc_value: "04:AA:BB:CC",
    });

    await expect(generateHandoverCode({ equipment_id: eq.id, from_user_id: admin.id })).rejects.toThrow(/NFC/);

    mockSession(admin);
    const res = await createHandoverRoute(new NextRequest(`http://localhost/api/equipment/${eq.id}/handover`, { method: "POST" }), {
      params: Promise.resolve({ id: String(eq.id) }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/NFC/);
  });

  test("rejects handover when the borrower is not an admin", async () => {
    await makeUser("First Admin", "admin");
    const borrower = await makeUser("Verified Vic", "verified");
    const eq = await makeEquipment("Tripod");
    await createCheckout({ equipment_id: eq.id, checked_out_by: borrower.id, checked_out_by_name: borrower.name });

    await expect(generateHandoverCode({ equipment_id: eq.id, from_user_id: borrower.id })).rejects.toThrow(
      /admin account/
    );

    mockSession(borrower);
    const res = await createHandoverRoute(new NextRequest(`http://localhost/api/equipment/${eq.id}/handover`, { method: "POST" }), {
      params: Promise.resolve({ id: String(eq.id) }),
    });
    expect(res.status).toBe(403);
  });

  test("a claimed code cannot be reused", async () => {
    const owner = await makeUser("Owner Alice", "admin");
    const peer1 = await makeUser("Peer One", "verified");
    const peer2 = await makeUser("Peer Two", "verified");
    const eq = await makeEquipment("Gimbal");
    await createCheckout({ equipment_id: eq.id, checked_out_by: owner.id, checked_out_by_name: owner.name });

    const handover = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });
    const first = await claimHandoverCode({ code: handover.code, claimed_by_id: peer1.id, claimed_by_name: peer1.name });
    expect(first.success).toBe(true);

    const second = await claimHandoverCode({ code: handover.code, claimed_by_id: peer2.id, claimed_by_name: peer2.name });
    expect(second.success).toBe(false);
    expect((await getActiveCheckoutByEquipmentId(eq.id))?.checked_out_by).toBe(peer1.id);
    expect((await getHandoverCodeDetails(handover.code))?.status).toBe("claimed");
  });

  test("concurrent claims of the same code only succeed once", async () => {
    const owner = await makeUser("Owner Alice", "admin");
    const peer1 = await makeUser("Peer One", "verified");
    const peer2 = await makeUser("Peer Two", "verified");
    const eq = await makeEquipment("Drone");
    await createCheckout({ equipment_id: eq.id, checked_out_by: owner.id, checked_out_by_name: owner.name });
    const handover = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });

    const results = await Promise.all([
      claimHandoverCode({ code: handover.code, claimed_by_id: peer1.id, claimed_by_name: peer1.name }),
      claimHandoverCode({ code: handover.code, claimed_by_id: peer2.id, claimed_by_name: peer2.name }),
    ]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    const open = db
      .prepare("SELECT COUNT(*) AS n FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
      .get(eq.id);
    expect(open.n).toBe(1);
  });

  test("a code goes stale once the item has been returned", async () => {
    const owner = await makeUser("Owner Alice", "admin");
    const peer = await makeUser("Peer Charlie", "verified");
    const eq = await makeEquipment("Lens Kit");
    const checkout = await createCheckout({ equipment_id: eq.id, checked_out_by: owner.id, checked_out_by_name: owner.name });
    const handover = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });

    // Simulate the loan being closed without the code being revoked.
    db.prepare("UPDATE checkouts SET returned_at = datetime('now') WHERE id = ?").run(checkout.id);

    const res = await claimHandoverCode({ code: handover.code, claimed_by_id: peer.id, claimed_by_name: peer.name });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no longer valid|already ended/);
    expect((await getHandoverCodeDetails(handover.code))?.status).not.toBe("active");
    expect(await getActiveCheckoutByEquipmentId(eq.id)).toBeUndefined();
  });

  test("returning the item revokes its outstanding code", async () => {
    const owner = await makeUser("Owner Alice", "admin");
    const peer = await makeUser("Peer Charlie", "verified");
    const eq = await makeEquipment("Boom Mic");
    await createCheckout({ equipment_id: eq.id, checked_out_by: owner.id, checked_out_by_name: owner.name });
    const handover = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });

    await returnCheckout(eq.id);

    const res = await claimHandoverCode({ code: handover.code, claimed_by_id: peer.id, claimed_by_name: peer.name });
    expect(res.success).toBe(false);
    expect(await getActiveCheckoutByEquipmentId(eq.id)).toBeUndefined();
  });

  test("claim input is normalised (lowercase prefix or bare digits)", async () => {
    const owner = await makeUser("Owner Alice", "admin");
    const peer = await makeUser("Peer Charlie", "verified");
    const eq = await makeEquipment("Light Panel");
    await createCheckout({ equipment_id: eq.id, checked_out_by: owner.id, checked_out_by_name: owner.name });
    const handover = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });

    const digits = handover.code.slice(3);
    const res = await claimHandoverCode({ code: `  ${digits} `, claimed_by_id: peer.id, claimed_by_name: peer.name });
    expect(res.success).toBe(true);
  });

  test("generating a new code revokes the previous one only after the new one exists", async () => {
    const owner = await makeUser("Owner Alice", "admin");
    const eq = await makeEquipment("Recorder");
    await createCheckout({ equipment_id: eq.id, checked_out_by: owner.id, checked_out_by_name: owner.name });

    const first = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });
    const second = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });
    expect(second.code).not.toBe(first.code);
    expect((await getHandoverCodeDetails(first.code))?.status).toBe("revoked");
    expect((await getHandoverCodeDetails(second.code))?.status).toBe("active");
  });

  test("GET /api/handover/[code] is visible only to the creator or an admin", async () => {
    const owner = await makeUser("Owner Alice", "admin");
    const other = await makeUser("Other Olivia", "verified");
    const otherAdmin = await makeUser("Admin Bob", "admin");
    const eq = await makeEquipment("Monitor");
    await createCheckout({ equipment_id: eq.id, checked_out_by: owner.id, checked_out_by_name: owner.name });
    const handover = await generateHandoverCode({ equipment_id: eq.id, from_user_id: owner.id });

    const get = () =>
      getHandoverRoute(new NextRequest(`http://localhost/api/handover/${handover.code}`), {
        params: Promise.resolve({ code: handover.code }),
      });

    mockSession(owner);
    expect((await get()).status).toBe(200);

    mockSession(other);
    expect((await get()).status).toBe(404);

    mockSession(otherAdmin);
    expect((await get()).status).toBe(200);
  });
});
