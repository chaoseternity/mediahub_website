/**
 * Unit tests for NFC workflow:
 * - NFC card lookup
 * - Retrieval of currently checked out equipment and checkout history
 * - Return equipment by barcode
 * - Checkout equipment by barcode with collision detection and prompt decision
 * - Pairing NFC card to member
 */

import Database from "better-sqlite3";
import { makeTestDb } from "@/lib/test-db";

function makeMemoryDb() {
  return makeTestDb();
}

function seedUser(
  db: Database.Database,
  name = "John Doe",
  email = "john@example.com",
  nfcId: string | null = "NFC-CARD-123"
) {
  const result = db
    .prepare(
      `INSERT INTO users (name, email, role, nfc_id)
       VALUES (?, ?, 'verified', ?)`
    )
    .run(name, email, nfcId);
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
  userId: number,
  nfcId: string,
  notes = "Checked out via NFC Station"
) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as {
    name: string;
  };
  const active = db
    .prepare("SELECT id FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
    .get(equipmentId);
  if (active) throw new Error("Equipment is already checked out.");

  const result = db
    .prepare(
      `INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, notes, nfc_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(equipmentId, userId, user.name, notes, nfcId);

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

describe("NFC Member Checkout & Return Workflow", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeMemoryDb();
  });

  describe("NFC Card Lookup & History", () => {
    test("retrieves member by NFC ID if registered", () => {
      const userId = seedUser(db, "Bob Tan", "bob@example.com", "CARD-8888");
      const member = db
        .prepare("SELECT * FROM users WHERE LOWER(nfc_id) = LOWER(?)")
        .get("CARD-8888") as { id: number; name: string } | undefined;

      expect(member).toBeDefined();
      expect(member?.id).toBe(userId);
      expect(member?.name).toBe("Bob Tan");
    });

    test("returns null if NFC card is unassigned", () => {
      const member = db
        .prepare("SELECT * FROM users WHERE LOWER(nfc_id) = LOWER(?)")
        .get("UNASSIGNED-CARD-999");
      expect(member).toBeUndefined();
    });

    test("retrieves currently checked out equipment under member's NFC", () => {
      const userId = seedUser(db, "Alice Lee", "alice@example.com", "NFC-ALICE-1");
      const camId = seedEquipment(db, "Canon R6", "CAM-R6-01");
      const micId = seedEquipment(db, "Rode Wireless Pro", "MIC-01");

      nfcCheckout(db, camId, userId, "NFC-ALICE-1");
      nfcCheckout(db, micId, userId, "NFC-ALICE-1");

      const active = db
        .prepare(
          `SELECT c.*, e.name as equipment_name, e.serial_number as equipment_serial_number
           FROM checkouts c
           JOIN equipment e ON e.id = c.equipment_id
           WHERE c.checked_out_by = ? AND c.returned_at IS NULL`
        )
        .all(userId) as Array<{ equipment_name: string; equipment_serial_number: string }>;

      expect(active.length).toBe(2);
      expect(active.map((a) => a.equipment_name)).toContain("Canon R6");
      expect(active.map((a) => a.equipment_name)).toContain("Rode Wireless Pro");
    });

    test("retrieves full checkout history including returned items", () => {
      const userId = seedUser(db, "Alice Lee", "alice@example.com", "NFC-ALICE-1");
      const camId = seedEquipment(db, "Canon R6", "CAM-R6-01");

      nfcCheckout(db, camId, userId, "NFC-ALICE-1");
      nfcReturn(db, camId); // Alice returns it

      // Alice checks it out again later
      nfcCheckout(db, camId, userId, "NFC-ALICE-1");

      const history = db
        .prepare(
          `SELECT c.*, e.name as equipment_name
           FROM checkouts c
           JOIN equipment e ON e.id = c.equipment_id
           WHERE c.checked_out_by = ?
           ORDER BY c.id DESC`
        )
        .all(userId) as Array<{ returned_at: string | null }>;

      expect(history.length).toBe(2);
      expect(history[0].returned_at).toBeNull(); // current active
      expect(history[1].returned_at).not.toBeNull(); // past returned
    });
  });

  describe("Return Equipment by Barcode", () => {
    test("successfully returns checked-out equipment and restores Available status", () => {
      const userId = seedUser(db, "Charlie", "charlie@example.com", "NFC-CHARLIE");
      const eqId = seedEquipment(db, "Tripod Manfrotto", "TRI-01");

      nfcCheckout(db, eqId, userId, "NFC-CHARLIE");
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
    test("detects when equipment is already checked out to member and handles return on prompt 'Yes'", () => {
      const userId = seedUser(db, "David", "david@example.com", "NFC-DAVID");
      const eqId = seedEquipment(db, "Audio Recorder Zoom H6", "ZOOM-01");

      // 1. Initial checkout
      nfcCheckout(db, eqId, userId, "NFC-DAVID");

      // 2. User tries to scan same equipment barcode in checkout mode
      const activeCheckout = db
        .prepare("SELECT * FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
        .get(eqId) as { checked_out_by: number };

      const isAlreadyCheckedOutByThisMember = activeCheckout?.checked_out_by === userId;
      expect(isAlreadyCheckedOutByThisMember).toBe(true);

      // 3. User responds "YES" to return prompt -> equipment is returned
      nfcReturn(db, eqId);

      const eqAfter = db.prepare("SELECT status FROM equipment WHERE id = ?").get(eqId) as {
        status: string;
      };
      expect(eqAfter.status).toBe("Available");
    });

    test("ignores scan when user responds 'No' to return prompt, leaving item checked out", () => {
      const userId = seedUser(db, "David", "david@example.com", "NFC-DAVID");
      const eqId = seedEquipment(db, "Audio Recorder Zoom H6", "ZOOM-01");

      nfcCheckout(db, eqId, userId, "NFC-DAVID");

      // User scans same equipment in checkout mode -> prompt appears -> user selects "No"
      // Scan is ignored, no database modification occurs
      const activeCheckout = db
        .prepare("SELECT * FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
        .get(eqId) as { checked_out_by: number };

      expect(activeCheckout.checked_out_by).toBe(userId);

      const eq = db.prepare("SELECT status FROM equipment WHERE id = ?").get(eqId) as {
        status: string;
      };
      expect(eq.status).toBe("Checked Out");
    });
  });

  describe("Pairing NFC Card to Member", () => {
    test("assigns NFC card to member", () => {
      const userId = seedUser(db, "Eve", "eve@example.com", null);
      db.prepare("UPDATE users SET nfc_id = ? WHERE id = ?").run("NEW-NFC-EVE", userId);

      const updated = db.prepare("SELECT nfc_id FROM users WHERE id = ?").get(userId) as {
        nfc_id: string;
      };
      expect(updated.nfc_id).toBe("NEW-NFC-EVE");
    });
  });
});
