/**
 * Unit tests for NFC workflow:
 * - NFC card is a dedicated entity (independent of user accounts)
 * - NFC card lookup
 * - Retrieval of currently checked out equipment and checkout history
 * - Return equipment by barcode
 * - Checkout equipment by barcode with collision detection and prompt decision
 * - Registering NFC card into database
 */

import Database from "better-sqlite3";
import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import { auth } from "@/lib/auth";
import * as dbModule from "@/lib/db";
import { NextRequest } from "next/server";
import { POST as checkoutRoute } from "@/app/api/nfc/checkout/route";
import { POST as returnRoute } from "@/app/api/nfc/return/route";
import { POST as registerCardRoute } from "@/app/api/nfc/card/route";

function makeMemoryDb() {
  return makeTestDb();
}

function seedNfcCard(
  db: Database.Database,
  nfcValue = "NFC-CARD-123",
  memberName = "John Doe",
  notes = "Camera Crew"
) {
  const result = db
    .prepare(
      `INSERT INTO nfc_cards (nfc_value, member_name, notes)
       VALUES (?, ?, ?)`
    )
    .run(nfcValue, memberName, notes);
  return result.lastInsertRowid as number;
}

function seedEquipment(
  db: Database.Database,
  name = "Sony A7 IV",
  serial = "CAM-01",
  status = "Available"
) {
  const id = db
    .prepare(
      `INSERT INTO equipment (name, serial_number, condition, location, status)
       VALUES (?, ?, 'Working', 'Media Studio', ?)`
    )
    .run(name, serial, status).lastInsertRowid as number;
  return id;
}

function nfcCheckout(
  db: Database.Database,
  equipmentId: number,
  nfcValue: string,
  notes = "Checked out via NFC Station"
) {
  const card = db.prepare("SELECT * FROM nfc_cards WHERE nfc_value = ?").get(nfcValue) as {
    member_name: string;
  };
  if (!card) throw new Error("Card not found");

  const active = db
    .prepare("SELECT id FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
    .get(equipmentId);
  if (active) throw new Error("Equipment is already checked out.");

  const result = db
    .prepare(
      `INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, notes, nfc_value)
       VALUES (?, NULL, ?, ?, ?)`
    )
    .run(equipmentId, card.member_name, notes, nfcValue);

  db.prepare("UPDATE equipment SET status = 'Checked Out' WHERE id = ?").run(equipmentId);
  return result.lastInsertRowid as number;
}

function nfcReturn(db: Database.Database, equipmentId: number) {
  const active = db
    .prepare("SELECT * FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
    .get(equipmentId) as { id: number } | undefined;

  if (!active) throw new Error("No active checkout found for this equipment.");

  db.prepare("UPDATE checkouts SET returned_at = datetime('now') WHERE id = ?").run(active.id);
  db.prepare("UPDATE equipment SET status = 'Available' WHERE id = ?").run(equipmentId);
}

describe("NFC Member Equipment Workflow (Decoupled from User Accounts)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeMemoryDb();
  });

  describe("NFC Card Lookup & History", () => {
    test("retrieves NFC card from database if registered", () => {
      const cardId = seedNfcCard(db, "CARD-8888", "Bob Tan");
      const card = db
        .prepare("SELECT * FROM nfc_cards WHERE LOWER(nfc_value) = LOWER(?)")
        .get("CARD-8888") as { id: number; member_name: string; nfc_value: string } | undefined;

      expect(card).toBeDefined();
      expect(card?.id).toBe(cardId);
      expect(card?.member_name).toBe("Bob Tan");
      expect(card?.nfc_value).toBe("CARD-8888");
    });

    test("returns null if NFC card is not in database", () => {
      const card = db
        .prepare("SELECT * FROM nfc_cards WHERE LOWER(nfc_value) = LOWER(?)")
        .get("UNKNOWN-999");
      expect(card).toBeUndefined();
    });

    test("retrieves currently checked out equipment under that NFC value", () => {
      seedNfcCard(db, "NFC-ALICE-1", "Alice Lee");
      const camId = seedEquipment(db, "Canon R6", "CAM-R6-01");
      const micId = seedEquipment(db, "Rode Wireless Pro", "MIC-01");

      nfcCheckout(db, camId, "NFC-ALICE-1");
      nfcCheckout(db, micId, "NFC-ALICE-1");

      const active = db
        .prepare(
          `SELECT c.*, e.name as equipment_name, e.serial_number as equipment_serial_number
           FROM checkouts c
           JOIN equipment e ON e.id = c.equipment_id
           WHERE c.nfc_value = ? AND c.returned_at IS NULL`
        )
        .all("NFC-ALICE-1") as Array<{ equipment_name: string; equipment_serial_number: string }>;

      expect(active.length).toBe(2);
      expect(active.map((a) => a.equipment_name)).toContain("Canon R6");
      expect(active.map((a) => a.equipment_name)).toContain("Rode Wireless Pro");
    });

    test("retrieves full checkout history for NFC value including past returns", () => {
      seedNfcCard(db, "NFC-ALICE-1", "Alice Lee");
      const camId = seedEquipment(db, "Canon R6", "CAM-R6-01");

      nfcCheckout(db, camId, "NFC-ALICE-1");
      nfcReturn(db, camId); // Alice returns it

      // Alice checks it out again later
      nfcCheckout(db, camId, "NFC-ALICE-1");

      const history = db
        .prepare(
          `SELECT c.*, e.name as equipment_name
           FROM checkouts c
           JOIN equipment e ON e.id = c.equipment_id
           WHERE c.nfc_value = ?
           ORDER BY c.id DESC`
        )
        .all("NFC-ALICE-1") as Array<{ returned_at: string | null }>;

      expect(history.length).toBe(2);
      expect(history[0].returned_at).toBeNull(); // current active
      expect(history[1].returned_at).not.toBeNull(); // past returned
    });
  });

  describe("Return Equipment by Barcode", () => {
    test("successfully returns equipment under NFC card and restores Available status", () => {
      seedNfcCard(db, "NFC-CHARLIE", "Charlie");
      const eqId = seedEquipment(db, "Tripod Manfrotto", "TRI-01");

      nfcCheckout(db, eqId, "NFC-CHARLIE");
      const beforeReturn = db.prepare("SELECT status FROM equipment WHERE id = ?").get(eqId) as {
        status: string;
      };
      expect(beforeReturn.status).toBe("Checked Out");

      // Scan barcode and return
      nfcReturn(db, eqId);

      const afterReturn = db.prepare("SELECT status FROM equipment WHERE id = ?").get(eqId) as {
        status: string;
      };
      expect(afterReturn.status).toBe("Available");

      const activeCheckout = db
        .prepare("SELECT id FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
        .get(eqId);
      expect(activeCheckout).toBeUndefined();
    });
  });

  describe("Checkout More Equipment & Collision Prompt Decision", () => {
    test("detects when equipment is already checked out to NFC card and handles return on prompt 'Yes'", () => {
      seedNfcCard(db, "NFC-DAVID", "David");
      const eqId = seedEquipment(db, "Audio Recorder Zoom H6", "ZOOM-01");

      // 1. Initial checkout under NFC card
      nfcCheckout(db, eqId, "NFC-DAVID");

      // 2. User tries to scan same equipment barcode in checkout mode
      const activeCheckout = db
        .prepare("SELECT * FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
        .get(eqId) as { nfc_value: string };

      const isAlreadyCheckedOutUnderThisNfc = activeCheckout?.nfc_value === "NFC-DAVID";
      expect(isAlreadyCheckedOutUnderThisNfc).toBe(true);

      // 3. User responds "YES" to return prompt -> equipment is returned
      nfcReturn(db, eqId);

      const eqAfter = db.prepare("SELECT status FROM equipment WHERE id = ?").get(eqId) as {
        status: string;
      };
      expect(eqAfter.status).toBe("Available");
    });

    test("ignores scan when user responds 'No' to return prompt, leaving item checked out", () => {
      seedNfcCard(db, "NFC-DAVID", "David");
      const eqId = seedEquipment(db, "Audio Recorder Zoom H6", "ZOOM-01");

      nfcCheckout(db, eqId, "NFC-DAVID");

      // User scans same equipment in checkout mode -> prompt appears -> user selects "No"
      // Scan is ignored, no database modification occurs
      const activeCheckout = db
        .prepare("SELECT * FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
        .get(eqId) as { nfc_value: string };

      expect(activeCheckout.nfc_value).toBe("NFC-DAVID");

      const eq = db.prepare("SELECT status FROM equipment WHERE id = ?").get(eqId) as {
        status: string;
      };
      expect(eq.status).toBe("Checked Out");
    });
  });

  describe("Registering Independent NFC Cards", () => {
    test("registers an NFC card with member name directly without user account", () => {
      const cardId = seedNfcCard(db, "NFC-INDEPENDENT-1", "External Member Sam", "Guest Crew");

      const card = db.prepare("SELECT * FROM nfc_cards WHERE id = ?").get(cardId) as {
        nfc_value: string;
        member_name: string;
        notes: string;
      };

      expect(card.nfc_value).toBe("NFC-INDEPENDENT-1");
      expect(card.member_name).toBe("External Member Sam");
      expect(card.notes).toBe("Guest Crew");

      // Verify users table is completely untouched
      const usersCount = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
      expect(usersCount.c).toBe(0);
    });
  });
});

/**
 * Route-level tests for offline replay of NFC actions (real route handlers + lib/db on an
 * in-memory SQLite DB): occurred_at is recorded, small future skew is clamped, stale /
 * invalid times are 400, business rejections are 4xx, unexpected DB errors are 500, and
 * replays are idempotent.
 */
describe("NFC offline replay via /api/nfc routes", () => {
  let db: Database.Database;
  const HOUR = 60 * 60 * 1000;

  const toSqlite = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

  function post(handler: (req: NextRequest) => Promise<Response>, path: string, body: unknown) {
    return handler(
      new NextRequest(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  beforeEach(() => {
    db = makeMemoryDb();
    setTestDb(db);
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "1", email: "station@school.edu", role: "verified", name: "Station" },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setTestDb(null);
    db.close();
  });

  function openCheckouts(eqId: number) {
    return db
      .prepare("SELECT * FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
      .all(eqId) as Array<{ checked_out_at: string; nfc_value: string }>;
  }

  test("replayed checkout records occurred_at and echoes client_action_id", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    const eqId = seedEquipment(db, "Sony FX3", "FX3-01");
    const occurred = Date.now() - 3 * HOUR;

    const res = await post(checkoutRoute, "/api/nfc/checkout", {
      nfc_value: "NFC-R1",
      equipment_ids: [eqId],
      occurred_at: new Date(occurred).toISOString(),
      expected_member_name: "Rita",
      client_action_id: "offline-abc",
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.client_action_id).toBe("offline-abc");

    const rows = openCheckouts(eqId);
    expect(rows).toHaveLength(1);
    expect(rows[0].checked_out_at).toBe(toSqlite(occurred));
  });

  test("replaying the same checkout again is idempotent (200, no duplicate)", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    const eqId = seedEquipment(db, "Sony FX3", "FX3-01");
    const body = {
      nfc_value: "NFC-R1",
      equipment_ids: [eqId],
      occurred_at: new Date(Date.now() - HOUR).toISOString(),
      client_action_id: "offline-dup",
    };
    expect((await post(checkoutRoute, "/api/nfc/checkout", body)).status).toBe(201);
    const again = await post(checkoutRoute, "/api/nfc/checkout", body);
    expect(again.status).toBe(200);
    expect((await again.json()).success).toBe(true);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM checkouts WHERE equipment_id = ?").get(eqId) as { n: number }).n
    ).toBe(1);
  });

  test("a live (non-replay) duplicate checkout is still a 409", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    const eqId = seedEquipment(db, "Sony FX3", "FX3-01");
    expect((await post(checkoutRoute, "/api/nfc/checkout", { nfc_value: "NFC-R1", equipment_id: eqId })).status).toBe(201);
    const dup = await post(checkoutRoute, "/api/nfc/checkout", { nfc_value: "NFC-R1", equipment_id: eqId });
    expect(dup.status).toBe(409);
  });

  test("a slightly-future occurred_at (station clock skew) is clamped to now", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    const eqId = seedEquipment(db, "Sony FX3", "FX3-01");
    const before = Date.now();
    const res = await post(checkoutRoute, "/api/nfc/checkout", {
      nfc_value: "NFC-R1",
      equipment_ids: [eqId],
      occurred_at: new Date(before + 60_000).toISOString(),
    });
    expect(res.status).toBe(201);
    const stored = Date.parse(openCheckouts(eqId)[0].checked_out_at.replace(" ", "T") + "Z");
    expect(stored).toBeLessThanOrEqual(Date.now());
    expect(stored).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
  });

  test("occurred_at more than 2 minutes in the future is a 400", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    const eqId = seedEquipment(db, "Sony FX3", "FX3-01");
    const res = await post(checkoutRoute, "/api/nfc/checkout", {
      nfc_value: "NFC-R1",
      equipment_ids: [eqId],
      occurred_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/future/i);
    expect(openCheckouts(eqId)).toHaveLength(0);
  });

  test("occurred_at older than 7 days (or invalid) is a 400 with a clear message", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    const eqId = seedEquipment(db, "Sony FX3", "FX3-01");
    const old = await post(checkoutRoute, "/api/nfc/checkout", {
      nfc_value: "NFC-R1",
      equipment_ids: [eqId],
      occurred_at: new Date(Date.now() - 8 * 24 * HOUR).toISOString(),
    });
    expect(old.status).toBe(400);
    expect((await old.json()).error).toMatch(/more than 7 days old/);

    const invalid = await post(returnRoute, "/api/nfc/return", {
      nfc_value: "NFC-R1",
      equipment_ids: [eqId],
      occurred_at: "not-a-date",
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toMatch(/Invalid action timestamp/);
    expect(openCheckouts(eqId)).toHaveLength(0);
  });

  test("replayed return records occurred_at and is idempotent", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    const eqId = seedEquipment(db, "Sony FX3", "FX3-01");
    const outAt = Date.now() - 5 * HOUR;
    const backAt = Date.now() - 2 * HOUR;
    expect(
      (await post(checkoutRoute, "/api/nfc/checkout", {
        nfc_value: "NFC-R1",
        equipment_ids: [eqId],
        occurred_at: new Date(outAt).toISOString(),
      })).status
    ).toBe(201);

    const body = {
      nfc_value: "NFC-R1",
      equipment_ids: [eqId],
      occurred_at: new Date(backAt).toISOString(),
      client_action_id: "offline-ret",
    };
    const res = await post(returnRoute, "/api/nfc/return", body);
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT returned_at FROM checkouts WHERE equipment_id = ?").get(eqId) as {
      returned_at: string;
    };
    expect(row.returned_at).toBe(toSqlite(backAt));
    expect((db.prepare("SELECT status FROM equipment WHERE id = ?").get(eqId) as { status: string }).status).toBe(
      "Available"
    );

    // The same queued return delivered again (response was lost) succeeds without changes.
    const again = await post(returnRoute, "/api/nfc/return", body);
    expect(again.status).toBe(200);
    expect((await again.json()).already_applied).toBe(1);
  });

  test("replayed return does not close a newer checkout of the same item", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    const eqId = seedEquipment(db, "Sony FX3", "FX3-01");
    const t = Date.now();
    const at = (ms: number) => new Date(ms).toISOString();
    await post(checkoutRoute, "/api/nfc/checkout", { nfc_value: "NFC-R1", equipment_ids: [eqId], occurred_at: at(t - 4 * HOUR) });
    const ret = { nfc_value: "NFC-R1", equipment_ids: [eqId], occurred_at: at(t - 3 * HOUR) };
    await post(returnRoute, "/api/nfc/return", ret);
    await post(checkoutRoute, "/api/nfc/checkout", { nfc_value: "NFC-R1", equipment_ids: [eqId], occurred_at: at(t - 2 * HOUR) });

    const replay = await post(returnRoute, "/api/nfc/return", ret);
    expect(replay.status).toBe(200);
    expect(openCheckouts(eqId)).toHaveLength(1); // newer checkout still open
  });

  test("business rejections are 4xx: unavailable item (409), unknown card (404), reassigned card (409)", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    seedNfcCard(db, "NFC-B2", "Ben");
    const eqId = seedEquipment(db, "Sony FX3", "FX3-01");
    const brokenId = seedEquipment(db, "Old Mic", "MIC-9", "Unavailable (Broken)");

    await post(checkoutRoute, "/api/nfc/checkout", { nfc_value: "NFC-B2", equipment_ids: [eqId] });
    const taken = await post(checkoutRoute, "/api/nfc/checkout", {
      nfc_value: "NFC-R1",
      equipment_ids: [eqId],
      occurred_at: new Date(Date.now() - HOUR).toISOString(),
    });
    expect(taken.status).toBe(409);

    const broken = await post(checkoutRoute, "/api/nfc/checkout", { nfc_value: "NFC-R1", equipment_ids: [brokenId] });
    expect(broken.status).toBe(409);

    const unknown = await post(checkoutRoute, "/api/nfc/checkout", { nfc_value: "NFC-NOPE", equipment_ids: [brokenId] });
    expect(unknown.status).toBe(404);

    const reassigned = await post(returnRoute, "/api/nfc/return", {
      nfc_value: "NFC-B2",
      equipment_ids: [eqId],
      expected_member_name: "Someone Else",
      occurred_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(reassigned.status).toBe(409);
    expect((await reassigned.json()).error).toMatch(/now belongs to Ben/);
    expect(openCheckouts(eqId)).toHaveLength(1);

    const notOut = await post(returnRoute, "/api/nfc/return", { nfc_value: "NFC-R1", equipment_ids: [brokenId] });
    expect(notOut.status).toBe(409);
  });

  test("unexpected DB errors are 500 (transient), not 409", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    const eqId = seedEquipment(db, "Sony FX3", "FX3-01");
    jest.spyOn(console, "error").mockImplementation(() => {});

    jest.spyOn(dbModule, "getEquipmentById").mockRejectedValue(new Error("D1_ERROR: Network connection lost."));
    const co = await post(checkoutRoute, "/api/nfc/checkout", { nfc_value: "NFC-R1", equipment_ids: [eqId] });
    expect(co.status).toBe(500);
    const ret = await post(returnRoute, "/api/nfc/return", { nfc_value: "NFC-R1", equipment_ids: [eqId] });
    expect(ret.status).toBe(500);

    jest.spyOn(dbModule, "createNfcCard").mockRejectedValue(new Error("SQLITE_BUSY: database is locked"));
    const card = await post(registerCardRoute, "/api/nfc/card", { nfc_value: "NFC-NEW", member_name: "Nia" });
    expect(card.status).toBe(500);
  });

  test("replayed card registration is idempotent; a conflicting one is 409", async () => {
    seedNfcCard(db, "NFC-R1", "Rita");
    const same = await post(registerCardRoute, "/api/nfc/card", { nfc_value: "NFC-R1", member_name: "rita" });
    expect(same.status).toBe(200);
    const clash = await post(registerCardRoute, "/api/nfc/card", { nfc_value: "NFC-R1", member_name: "Ben" });
    expect(clash.status).toBe(409);
  });
});

describe("normalizeOccurredAt", () => {
  const { normalizeOccurredAt, InvalidOccurredAtError } = dbModule;

  test("absent means now (null)", () => {
    expect(normalizeOccurredAt(undefined)).toBeNull();
    expect(normalizeOccurredAt("")).toBeNull();
  });

  test("converts ISO to SQLite UTC format and is idempotent", () => {
    const iso = new Date(Date.now() - 3600_000).toISOString();
    const once = normalizeOccurredAt(iso)!;
    expect(once).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(normalizeOccurredAt(once)).toBe(once);
  });

  test("clamps up to 2 minutes of future skew, rejects beyond, rejects > 7 days", () => {
    const clamped = normalizeOccurredAt(new Date(Date.now() + 90_000).toISOString())!;
    expect(Date.parse(clamped.replace(" ", "T") + "Z")).toBeLessThanOrEqual(Date.now());
    expect(() => normalizeOccurredAt(new Date(Date.now() + 3 * 60_000).toISOString())).toThrow(
      InvalidOccurredAtError
    );
    expect(() =>
      normalizeOccurredAt(new Date(Date.now() - 8 * 24 * 3600_000).toISOString())
    ).toThrow(/7 days/);
    expect(() => normalizeOccurredAt("garbage")).toThrow(InvalidOccurredAtError);
  });
});
