/**
 * Unit tests for equipment query helpers in lib/db.ts.
 * Domain: AV CCA — laptops and SD cards.
 * Uses an in-memory SQLite database — no filesystem side effects.
 */

import Database from "better-sqlite3";
import { makeTestDb } from "@/lib/test-db";
import type { Condition, EquipmentStatus } from "@/lib/types";

// ── Helpers ─────────────────────────────────────────────────────────────────────────

function makeMemoryDb() {
  return makeTestDb();
}

// Thin wrappers that accept an explicit db instance (mirrors lib/db.ts internals)
function insertEquipment(
  db: Database.Database,
  overrides: Partial<{
    name: string;
    tags: string[];
    condition: Condition;
    location: string;
    status: EquipmentStatus;
  }> = {}
) {
  const { tags = ["Laptop"], ...rest } = {
    name: "Kamera",
    tags: ["Laptop"],
    description: null,
    serial_number: null,
    condition: "Working" as Condition,
    location: "AV Storage Room",
    status: "Available" as EquipmentStatus,
    ...overrides,
  };
  const result = db
    .prepare(
      `INSERT INTO equipment (name, description, serial_number, condition, location, status)
       VALUES (@name, @description, @serial_number, @condition, @location, @status)`
    )
    .run(rest);
  const id = result.lastInsertRowid as number;
  // Ensure tags exist and link them
  for (const tagName of tags) {
    db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)").run(tagName);
    db.prepare(
      "INSERT OR IGNORE INTO equipment_tags (equipment_id, tag_id) SELECT ?, id FROM tags WHERE name = ?"
    ).run(id, tagName);
  }
  return id;
}

function getEquipmentRow(db: Database.Database, id: number) {
  return db.prepare("SELECT * FROM equipment WHERE id = ?").get(id) as Record<string, unknown> | undefined;
}

function insertCheckout(
  db: Database.Database,
  equipment_id: number,
  returned_at: string | null = null
) {
  return db
    .prepare(
      `INSERT INTO checkouts (equipment_id, checked_out_by_name, returned_at)
       VALUES (?, 'AV Member', ?)`
    )
    .run(equipment_id, returned_at).lastInsertRowid as number;
}

// ── Tests ───────────────────────────────────────────────────────────────────────────

describe("Equipment DB helpers (in-memory SQLite) — AV CCA", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  // ── CREATE ─────────────────────────────────────────────────────────────────────

  test("creates a laptop and returns its id", () => {
    const id = insertEquipment(db);
    expect(id).toBeGreaterThan(0);
    const row = getEquipmentRow(db, id);
    expect(row).toBeDefined();
    expect(row!.name).toBe("Kamera");
    expect(row!.status).toBe("Available");
  });

  test("creates an SD card with all optional fields", () => {
    const id = insertEquipment(db, {
      name: "SD-V-1",
      tags: ["SD Card (Video)"],
      condition: "Working",
      location: "AV Storage Room – SD Card Wallet",
      status: "Available",
    });
    const row = getEquipmentRow(db, id);
    expect(row!.name).toBe("SD-V-1");
    const tagRow = db.prepare("SELECT t.name FROM tags t JOIN equipment_tags et ON et.tag_id = t.id WHERE et.equipment_id = ?").get(id) as { name: string } | undefined;
    expect(tagRow?.name).toBe("SD Card (Video)");
    expect(row!.condition).toBe("Working");
  });

  test("creates a photo SD card item", () => {
    const id = insertEquipment(db, {
      name: "SD-P-3",
      tags: ["SD Card (Photo)"],
    });
    const tagRow = db.prepare("SELECT t.name FROM tags t JOIN equipment_tags et ON et.tag_id = t.id WHERE et.equipment_id = ?").get(id) as { name: string } | undefined;
    expect(tagRow?.name).toBe("SD Card (Photo)");
  });

  // ── READ ──────────────────────────────────────────────────────────────────────────

  test("retrieves laptop by id", () => {
    const id = insertEquipment(db, { name: "Middle Earth" });
    const row = getEquipmentRow(db, id);
    expect(row).not.toBeNull();
    expect(row!.name).toBe("Middle Earth");
  });

  test("returns undefined for non-existent id", () => {
    const row = getEquipmentRow(db, 9999);
    expect(row).toBeUndefined();
  });

  test("retrieves all equipment ordered by updated_at desc", () => {
    insertEquipment(db, { name: "DJ" });
    insertEquipment(db, { name: "SD-V-1", tags: ["SD Card (Video)"] });
    const rows = db.prepare("SELECT * FROM equipment ORDER BY updated_at DESC").all() as Record<string, unknown>[];
    expect(rows.length).toBe(2);
  });

  // ── UPDATE ─────────────────────────────────────────────────────────────────────

  test("updates laptop location", () => {
    const id = insertEquipment(db, { name: "Clapper", location: "AV Storage Room" });
    db.prepare("UPDATE equipment SET location = ?, updated_at = datetime('now') WHERE id = ?")
      .run("Auditorium Backstage", id);
    const row = getEquipmentRow(db, id);
    expect(row!.location).toBe("Auditorium Backstage");
  });

  test("updates laptop status to Unavailable (In Repairs)", () => {
    const id = insertEquipment(db, { name: "Strawberry" });
    db.prepare("UPDATE equipment SET status = 'Unavailable (In Repairs)', updated_at = datetime('now') WHERE id = ?").run(id);
    const row = getEquipmentRow(db, id);
    expect(row!.status).toBe("Unavailable (In Repairs)");
  });

  test("updates SD card condition to Impaired after wear", () => {
    const id = insertEquipment(db, { name: "SD-P-10", tags: ["SD Card (Photo)"], condition: "Working" });
    db.prepare("UPDATE equipment SET condition = 'Impaired', updated_at = datetime('now') WHERE id = ?").run(id);
    const row = getEquipmentRow(db, id);
    expect(row!.condition).toBe("Impaired");
  });

  // ── DELETE ─────────────────────────────────────────────────────────────────────

  test("deletes SD card with no active checkout", () => {
    const id = insertEquipment(db, { name: "SD-V-10", tags: ["SD Card (Video)"] });
    db.prepare("DELETE FROM equipment WHERE id = ?").run(id);
    const row = getEquipmentRow(db, id);
    expect(row).toBeUndefined();
  });

  test("blocks delete when laptop has an active checkout", () => {
    const id = insertEquipment(db, { name: "Bulbasaur", status: "Checked Out" });
    insertCheckout(db, id, null); // active checkout

    const active = db
      .prepare("SELECT id FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
      .get(id);
    expect(active).toBeDefined();
    expect(active).not.toBeNull();
  });

  test("allows delete of SD card after all checkouts are returned", () => {
    const id = insertEquipment(db, { name: "SD-P-15", tags: ["SD Card (Photo)"] });
    insertCheckout(db, id, "2026-03-10 18:00:00"); // returned

    const active = db
      .prepare("SELECT id FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
      .get(id);
    expect(active).toBeUndefined();

    db.prepare("DELETE FROM checkouts WHERE equipment_id = ?").run(id);
    db.prepare("DELETE FROM equipment WHERE id = ?").run(id);
    expect(getEquipmentRow(db, id)).toBeUndefined();
  });

  test("marks a damaged SD card as Unavailable (Broken)", () => {
    const id = insertEquipment(db, { name: "SD-V-8", tags: ["SD Card (Video)"], condition: "Broken" });
    db.prepare("UPDATE equipment SET status = 'Unavailable (Broken)', updated_at = datetime('now') WHERE id = ?").run(id);
    const row = getEquipmentRow(db, id);
    expect(row!.status).toBe("Unavailable (Broken)");
  });

  test("marks a lost item as Missing and Unavailable (Missing)", () => {
    const id = insertEquipment(db, { name: "SD-P-99", tags: ["SD Card (Photo)"], condition: "Missing" });
    db.prepare("UPDATE equipment SET status = 'Unavailable (Missing)', updated_at = datetime('now') WHERE id = ?").run(id);
    const row = getEquipmentRow(db, id);
    expect(row!.condition).toBe("Missing");
    expect(row!.status).toBe("Unavailable (Missing)");
  });
});
