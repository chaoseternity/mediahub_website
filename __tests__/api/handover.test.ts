import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import {
  createEquipment,
  upsertUser,
  createCheckout,
  generateHandoverCode,
  claimHandoverCode,
  getHandoverCodeDetails,
  getActiveCheckoutByEquipmentId,
} from "@/lib/db";
import { POST as claimHandoverRoute } from "@/app/api/handover/claim/route";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

describe("Peer-to-Peer Handover Protocol", () => {
  let db: any;

  beforeEach(() => {
    db = makeTestDb();
    setTestDb(db);
  });

  afterEach(() => {
    setTestDb(null);
  });

  test("generates temporary handover code and allows peer to claim ownership", async () => {
    const owner = await upsertUser({
      name: "Owner Alice",
      email: "alice@school.edu",
      google_id: "google_alice",
      image: null,
      provider: "google",
    });

    const peer = await upsertUser({
      name: "Peer Charlie",
      email: "charlie@school.edu",
      google_id: "google_charlie",
      image: null,
      provider: "google",
    });

    const eq = await createEquipment({
      name: "Sony FX6 Camera",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Cabinet 1",
    });

    // Checkout to Alice
    const checkout = await createCheckout({
      equipment_id: eq.id,
      checked_out_by: owner.id,
      checked_out_by_name: owner.name,
      notes: "Project A",
    });

    // Generate handover code
    const handover = await generateHandoverCode({
      equipment_id: eq.id,
      from_user_id: owner.id,
    });

    expect(handover.code).toMatch(/^HD-[A-Z0-9]{4}$/);
    expect(handover.status).toBe("active");

    // Lookup handover code
    const details = await getHandoverCodeDetails(handover.code);
    expect(details).toBeDefined();
    expect(details?.equipment_name).toBe("Sony FX6 Camera");

    // Charlie claims handover via API route
    (auth as jest.Mock).mockResolvedValue({
      user: { id: String(peer.id), email: peer.email, name: peer.name, role: "verified" },
    });

    const req = new NextRequest("http://localhost/api/handover/claim", {
      method: "POST",
      body: JSON.stringify({ code: handover.code }),
    });

    const res = await claimHandoverRoute(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify equipment is now checked out to Charlie
    const newActiveCheckout = await getActiveCheckoutByEquipmentId(eq.id);
    expect(newActiveCheckout).toBeDefined();
    expect(newActiveCheckout?.checked_out_by).toBe(peer.id);
  });

  test("prevents user from claiming their own handover", async () => {
    const owner = await upsertUser({
      name: "Owner Alice",
      email: "alice@school.edu",
      google_id: "google_alice",
      image: null,
      provider: "google",
    });

    const eq = await createEquipment({
      name: "Wireless Mic Set",
      tags: [],
      status: "Available",
      condition: "Working",
      location: "Audio Rack",
    });

    await createCheckout({
      equipment_id: eq.id,
      checked_out_by: owner.id,
      checked_out_by_name: owner.name,
    });

    const handover = await generateHandoverCode({
      equipment_id: eq.id,
      from_user_id: owner.id,
    });

    const claimRes = await claimHandoverCode({
      code: handover.code,
      claimed_by_id: owner.id,
      claimed_by_name: owner.name,
    });

    expect(claimRes.success).toBe(false);
    expect(claimRes.error).toContain("handover equipment to yourself");
  });
});
