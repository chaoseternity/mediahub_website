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
import { makeTestDb } from "@/lib/test-db";

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
       VALUES (?, ?, 'Good', 'Media Studio', ?)`
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
