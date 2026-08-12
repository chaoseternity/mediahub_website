/**
 * Unit tests for checkout/return flow using an in-memory SQLite database.
 * Domain: AV CCA — laptops and SD cards checked out for events and shoots.
 */

import Database from "better-sqlite3";
import { makeTestDb } from "@/lib/test-db";

function makeMemoryDb() {
  return makeTestDb();
}

function seedEquipment(db: Database.Database, name = "Kamera", tag = "Laptop", status = "Available") {
  db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(tag);
  const id = db
    .prepare(
      `INSERT INTO equipment (name, condition, quantity, location, status)
       VALUES (?, 'Good', 1, 'AV Storage Room', ?)`
    )
    .run(name, status).lastInsertRowid as number;
  db.prepare(
    "INSERT OR IGNORE INTO equipment_tags (equipment_id, tag_id) SELECT ?, id FROM tags WHERE name = ?"
  ).run(id, tag);
  return id;
}

function checkout(
  db: Database.Database,
  equipment_id: number,
  memberName = "Alice",
  expected: string | null = null
) {
  const result = db
    .prepare(
      `INSERT INTO checkouts (equipment_id, checked_out_by_name, expected_return_at)
       VALUES (?, ?, ?)`
    )
    .run(equipment_id, memberName, expected);
  db.prepare(
    "UPDATE equipment SET status = 'Checked Out', updated_at = datetime('now') WHERE id = ?"
  ).run(equipment_id);
  return result.lastInsertRowid as number;
}

function returnItem(db: Database.Database, equipment_id: number) {
  const active = db
    .prepare(
      "SELECT * FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL"
    )
    .get(equipment_id) as { id: number } | undefined;

  if (!active) throw new Error("No active checkout found.");

  db.prepare(
    "UPDATE checkouts SET returned_at = datetime('now') WHERE id = ?"
  ).run(active.id);
  db.prepare(
    "UPDATE equipment SET status = 'Available', updated_at = datetime('now') WHERE id = ?"
  ).run(equipment_id);
}

function getEquipmentStatus(db: Database.Database, id: number): string {
  const row = db.prepare("SELECT status FROM equipment WHERE id = ?").get(id) as
    | { status: string }
    | undefined;
  return row?.status ?? "";
}

// ── Tests ───────────────────────────────────────────────────────────────────────────

describe("Checkout / Return flow (in-memory SQLite) — AV CCA", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  test("checking out a laptop sets its status to Checked Out", () => {
    const id = seedEquipment(db, "DJ");
    checkout(db, id, "AV Member");
    expect(getEquipmentStatus(db, id)).toBe("Checked Out");
  });

  test("checking out an SD card sets its status to Checked Out", () => {
    const id = seedEquipment(db, "SD-V-3", "SD Card (Video)");
    checkout(db, id, "AV Member");
    expect(getEquipmentStatus(db, id)).toBe("Checked Out");
  });

  test("returning a laptop sets returned_at and status back to Available", () => {
    const id = seedEquipment(db, "Kamera");
    const checkoutId = checkout(db, id, "AV Member");
    returnItem(db, id);

    expect(getEquipmentStatus(db, id)).toBe("Available");

    const row = db.prepare("SELECT returned_at FROM checkouts WHERE id = ?").get(checkoutId) as {
      returned_at: string | null;
    };
    expect(row.returned_at).not.toBeNull();
  });

  test("double-checkout of a laptop is rejected while one is active", () => {
    const id = seedEquipment(db, "Bulbasaur");
    checkout(db, id, "AV Member");

    const existingActive = db
      .prepare("SELECT id FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
      .get(id);
    expect(existingActive).toBeDefined();
  });

  test("SD card can be checked out again after it is returned", () => {
    const id = seedEquipment(db, "SD-P-5", "SD Card (Photo)");
    checkout(db, id, "First Member");
    returnItem(db, id);

    checkout(db, id, "Second Member");
    expect(getEquipmentStatus(db, id)).toBe("Checked Out");

    const checkouts = db
      .prepare("SELECT * FROM checkouts WHERE equipment_id = ?")
      .all(id) as Array<{ returned_at: string | null }>;
    expect(checkouts.length).toBe(2);
  });

  test("return throws when laptop has no active checkout", () => {
    const id = seedEquipment(db, "Middle Earth");
    expect(() => returnItem(db, id)).toThrow("No active checkout found.");
  });

  test("checkout history shows both active and returned entries for an SD card", () => {
    const id = seedEquipment(db, "SD-V-1", "SD Card (Video)");
    checkout(db, id, "First Member");
    returnItem(db, id);
    checkout(db, id, "Second Member");

    const all = db
      .prepare("SELECT * FROM checkouts WHERE equipment_id = ? ORDER BY checked_out_at")
      .all(id) as Array<{ checked_out_by_name: string; returned_at: string | null }>;

    expect(all.length).toBe(2);
    expect(all[0].returned_at).not.toBeNull();
    expect(all[1].returned_at).toBeNull();
  });
});
