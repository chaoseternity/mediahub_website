/**
 * Unit tests for SOP query helpers and conflict handling.
 */

import Database from "better-sqlite3";
import { makeTestDb } from "@/lib/test-db";

function makeMemoryDb() {
  return makeTestDb();
}

function insertUser(
  db: Database.Database,
  user: { name: string; email: string; role?: string }
) {
  const result = db
    .prepare(
      `INSERT INTO users (name, email, role)
       VALUES (@name, @email, @role)`
    )
    .run({
      name: user.name,
      email: user.email,
      role: user.role || "admin",
    });
  return result.lastInsertRowid as number;
}

function insertSOP(
  db: Database.Database,
  sop: {
    title: string;
    category?: string;
    content: string;
    file_name?: string | null;
    file_type?: string | null;
    file_size?: number | null;
    uploaded_by?: number | null;
  }
) {
  const result = db
    .prepare(
      `INSERT INTO sop_documents (title, category, content, file_name, file_type, file_size, uploaded_by)
       VALUES (@title, @category, @content, @file_name, @file_type, @file_size, @uploaded_by)`
    )
    .run({
      title: sop.title,
      category: sop.category || "General",
      content: sop.content,
      file_name: sop.file_name || null,
      file_type: sop.file_type || null,
      file_size: sop.file_size || null,
      uploaded_by: sop.uploaded_by || null,
    });
  return result.lastInsertRowid as number;
}

describe("SOP database helpers & duplicate conflict logic", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeMemoryDb();
  });

  test("inserts and retrieves SOP document with full metadata", () => {
    const adminId = insertUser(db, { name: "Lead Admin", email: "admin@mediahub.org" });
    const sopId = insertSOP(db, {
      title: "Audio Mixer SOP",
      category: "Audio/AV",
      content: "Ensure phantom power is turned off before disconnecting condenser mics.",
      file_name: "Audio_Mixer_SOP.docx",
      file_size: 32000,
      uploaded_by: adminId,
    });

    const row = db.prepare("SELECT * FROM sop_documents WHERE id = ?").get(sopId) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.title).toBe("Audio Mixer SOP");
    expect(row.category).toBe("Audio/AV");
    expect(row.uploaded_by).toBe(adminId);
  });

  test("detects exact same title or file_name as a conflict", () => {
    insertSOP(db, {
      title: "Drone Flight Safety Rules",
      category: "Safety & Handling",
      content: "Maintain visual line of sight at all times.",
      file_name: "Drone_Safety.pdf",
    });

    // Check duplicate title
    const duplicateTitle = db
      .prepare("SELECT * FROM sop_documents WHERE LOWER(title) = LOWER(?)")
      .get("drone flight safety rules") as Record<string, unknown> | undefined;

    expect(duplicateTitle).toBeDefined();
    expect(duplicateTitle?.title).toBe("Drone Flight Safety Rules");

    // Check duplicate file_name
    const duplicateFileName = db
      .prepare("SELECT * FROM sop_documents WHERE LOWER(file_name) = LOWER(?)")
      .get("drone_safety.pdf") as Record<string, unknown> | undefined;

    expect(duplicateFileName).toBeDefined();
    expect(duplicateFileName?.file_name).toBe("Drone_Safety.pdf");
  });

  test("overwrites existing document when requested", () => {
    const originalId = insertSOP(db, {
      title: "Lighting Kit SOP",
      category: "Photo",
      content: "Old bulb replacement instructions.",
      file_name: "Lighting_Kit.docx",
    });

    db.prepare(
      `UPDATE sop_documents
       SET title = @title, category = @category, content = @content, file_name = @file_name, updated_at = datetime('now')
       WHERE id = @id`
    ).run({
      id: originalId,
      title: "Lighting Kit SOP v2",
      category: "Photo",
      content: "New LED panel instructions.",
      file_name: "Lighting_Kit_v2.docx",
    });

    const updated = db.prepare("SELECT * FROM sop_documents WHERE id = ?").get(originalId) as Record<string, unknown>;
    expect(updated.title).toBe("Lighting Kit SOP v2");
    expect(updated.content).toBe("New LED panel instructions.");
    expect(updated.file_name).toBe("Lighting_Kit_v2.docx");
  });
});
