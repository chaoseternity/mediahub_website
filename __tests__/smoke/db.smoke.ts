/**
 * Smoke tests — exercises every public lib/db.ts helper through the real
 * implementation, backed by an in-memory SQLite database mock for @vercel/postgres.
 *
 * Runs automatically after every `npm run build` via the `postbuild` hook.
 */

import Database from "better-sqlite3";
import { makeTestDb } from "@/lib/test-db";

let testDb: Database.Database = makeTestDb();

function resetDb() {
  testDb.close();
  testDb = makeTestDb();
}

jest.mock("@/lib/postgres", () => ({
  ensureSchema: async () => {},
}));

jest.mock("@vercel/postgres", () => {
  return {
    sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      let query = "";
      for (let i = 0; i < strings.length; i++) {
        query += strings[i];
        if (i < values.length) {
          query += "?";
        }
      }

      let sqliteQuery = query
        .replace(/COUNT\(\*\)::text/gi, "COUNT(*)")
        .replace(/SERIAL PRIMARY KEY/gi, "INTEGER PRIMARY KEY AUTOINCREMENT")
        .replace(/TIMESTAMP WITH TIME ZONE/gi, "TEXT")
        .replace(/ILIKE/gi, "LIKE")
        .replace(/COALESCE\(\s*ARRAY_AGG\(DISTINCT t\.name\)\s*FILTER\s*\(WHERE\s*t\.name\s*IS\s*NOT\s*NULL\),\s*'{}'\s*\)/gi, "GROUP_CONCAT(DISTINCT t.name)")
        .replace(/COALESCE\(\s*ARRAY_AGG\(t\.name\)\s*FILTER\s*\(WHERE\s*t\.name\s*IS\s*NOT\s*NULL\),\s*'{}'\s*\)/gi, "GROUP_CONCAT(t.name)")
        .replace(/INSERT INTO (\w+) \((.*?)\) VALUES \((.*?)\) ON CONFLICT DO NOTHING/gi, "INSERT OR IGNORE INTO $1 ($2) VALUES ($3)")
        .replace(/INSERT INTO (\w+) \((.*?)\) VALUES \((.*?)\) ON CONFLICT \((.*?)\) DO UPDATE SET (.*?)$/gi, "INSERT OR REPLACE INTO $1 ($2) VALUES ($3)");

      let isReturning = false;
      if (/RETURNING \*/i.test(sqliteQuery)) {
        isReturning = true;
        sqliteQuery = sqliteQuery.replace(/RETURNING \*/gi, "");
      }

      const trimmed = sqliteQuery.trim();
      if (/^ALTER TABLE.*ADD COLUMN/i.test(trimmed)) {
        // Columns already exist in in-memory test database schema
        return { rows: [], rowCount: 0 };
      }

      const sanitizedValues = values.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v));

      try {
        if (/^(SELECT|WITH)/i.test(trimmed)) {
          const stmt = testDb.prepare(sqliteQuery);
          const rows = stmt.all(...(sanitizedValues as [])) as Array<Record<string, unknown>>;
          const processedRows = rows.map((r) => {
            if ("tags" in r && typeof r.tags === "string") {
              const strVal = r.tags as string;
              (r as Record<string, unknown>).tags = strVal ? strVal.split(",").filter(Boolean) : [];
            }
            return r;
          });
          return { rows: processedRows, rowCount: processedRows.length };
        } else {
          const stmt = testDb.prepare(sqliteQuery);
          const info = stmt.run(...(sanitizedValues as []));
          const returnedRows: Array<Record<string, unknown>> = [];
          if (isReturning && info.lastInsertRowid) {
            let table = "users";
            if (/INSERT INTO equipment/i.test(sqliteQuery)) table = "equipment";
            else if (/INSERT INTO tags/i.test(sqliteQuery)) table = "tags";
            else if (/INSERT INTO checkouts/i.test(sqliteQuery)) table = "checkouts";
            else if (/UPDATE checkouts/i.test(sqliteQuery)) table = "checkouts";
            else if (/INSERT INTO events/i.test(sqliteQuery)) table = "events";
            else if (/INSERT INTO sop_documents/i.test(sqliteQuery)) table = "sop_documents";
            else if (/UPDATE sop_documents/i.test(sqliteQuery)) table = "sop_documents";

            const fetchStmt = testDb.prepare(`SELECT * FROM ${table} WHERE id = ?`);
            const row = fetchStmt.get(info.lastInsertRowid) as Record<string, unknown>;
            if (row) returnedRows.push(row);
          }
          return { rows: returnedRows, rowCount: info.changes };
        }
      } catch (err) {
        console.error("SQL Error in test mock:", sqliteQuery, values, err);
        throw err;
      }
    },
  };
});

import {
  getAllEquipment,
  createEquipment,
  createTag,
  upsertUser,
  createEvent,
  attachEquipmentToEventSection,
  addDeploymentToEventSection,
  updateSectionRehearsalConfig,
  getDeploymentByToken,
  updateDeploymentRSVP,
  getEventById,
  deleteEvent,
  createSOPDocument,
  getSOPDocumentById,
  getAllSOPDocuments,
  updateSOPDocument,
  deleteSOPDocument,
  searchSOPDocuments,
} from "@/lib/db";

// ── Smoke tests ───────────────────────────────────────────────────────────────

describe("Smoke — lib/db.ts (Vercel Postgres mock)", () => {
  beforeEach(resetDb);

  // ── getAllEquipment ───────────────────────────────────────────────────────

  describe("getAllEquipment", () => {
    test("returns an empty array on a fresh database", async () => {
      expect(await getAllEquipment()).toEqual([]);
    });

    test("returns all created equipment", async () => {
      await createTag("Laptop");
      await createEquipment({ name: "A", tags: ["Laptop"], condition: "Working", location: "L", status: "Available" });
      await createEquipment({ name: "B", tags: [], condition: "Working", location: "L", status: "Available" });
      const all = await getAllEquipment();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.name).sort()).toEqual(["A", "B"]);
    });
  });

  // ── createEquipment ───────────────────────────────────────────────────────

  describe("createEquipment", () => {
    test("creates equipment with default tags array", async () => {
      const eq = await createEquipment({
        name: "Camera",
        tags: [],
        condition: "Working",
        location: "Studio",
        status: "Available",
      });
      expect(eq.id).toBeGreaterThan(0);
      expect(eq.name).toBe("Camera");
      expect(eq.tags).toEqual([]);
      expect(eq.status).toBe("Available");
    });
  });

  // ── Events management ─────────────────────────────────────────────────────

  describe("Events management with Section ICs, OICs, Deployments & Rehearsals", () => {
    test("creates an event with OICs, Section ICs, section equipment, deployments, and rehearsal", async () => {
      const admin = await upsertUser({ name: "Admin", email: "admin@test.com", google_id: "g1", image: null, provider: "google" });
      const oic = await upsertUser({ name: "OIC Alice", email: "alice@test.com", google_id: "g2", image: null, provider: "google" });
      const photoIc = await upsertUser({ name: "Photo Bob", email: "bob@test.com", google_id: "g3", image: null, provider: "google" });
      const crewMember = await upsertUser({ name: "Crew Charlie", email: "charlie@test.com", google_id: "g4", image: null, provider: "google" });

      const eq = await createEquipment({ name: "DSLR Camera", tags: [], condition: "Working", location: "Cabinet", status: "Available" });

      const now = new Date();
      const startTime = new Date(now.getTime() - 1000 * 60 * 30).toISOString();
      const endTime = new Date(now.getTime() + 1000 * 60 * 90).toISOString();

      const event = await createEvent({
        name: "Gala Night 2026",
        description: "Annual gala",
        start_time: startTime,
        end_time: endTime,
        location: "Grand Ballroom",
        created_by: admin.id,
        has_rehearsal: true,
        rehearsal_start_time: startTime,
        rehearsal_end_time: endTime,
        oic_user_ids: [oic.id],
        photo_ic_ids: [photoIc.id],
      });

      expect(event.id).toBeGreaterThan(0);
      expect(event.name).toBe("Gala Night 2026");
      expect(event.oics).toHaveLength(1);
      expect(event.section_ics.photo).toHaveLength(1);

      await attachEquipmentToEventSection(event.id, eq.id, "photo", true, photoIc.id);
      const depRes = await addDeploymentToEventSection(event.id, crewMember.id, "photo", true, photoIc.id);
      expect(depRes.success).toBe(true);
      expect(depRes.token).toBeDefined();

      const depTokenDetails = await getDeploymentByToken(depRes.token);
      expect(depTokenDetails?.user.id).toBe(crewMember.id);
      expect(depTokenDetails?.response_status).toBe("pending");

      const rsvpRes = await updateDeploymentRSVP(depRes.token, "confirmed");
      expect(rsvpRes.success).toBe(true);

      await updateSectionRehearsalConfig(event.id, "photo", true, [eq.id], [crewMember.id]);

      const fetchedEvent = await getEventById(event.id);
      expect(fetchedEvent?.section_equipment.photo).toHaveLength(1);
      expect(fetchedEvent?.section_deployments.photo).toHaveLength(1);
      expect(fetchedEvent?.section_deployments.photo[0].response_status).toBe("confirmed");
      expect(fetchedEvent?.section_rehearsals.photo.participating).toBe(true);

      const delRes = await deleteEvent(event.id);
      expect(delRes.success).toBe(true);
    });
  });

  // ── SOP Documents Management ───────────────────────────────────────────────

  describe("SOP Documents management", () => {
    test("creates, reads, searches, updates (overwrites), and deletes SOP documents", async () => {
      const admin = await upsertUser({ name: "Admin", email: "admin2@test.com", google_id: "g5", image: null, provider: "google" });

      // 1. Create SOP
      const sop1 = await createSOPDocument({
        title: "Sony FX3 Camera Operation",
        category: "Video",
        content: "Always check battery charge and format CFexpress card before shooting.",
        file_name: "Sony_FX3_Operation.docx",
        file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        file_size: 45000,
        uploaded_by: admin.id,
      });

      expect(sop1.id).toBeGreaterThan(0);
      expect(sop1.title).toBe("Sony FX3 Camera Operation");
      expect(sop1.category).toBe("Video");

      // 2. Fetch by ID and All
      const fetched = await getSOPDocumentById(sop1.id);
      expect(fetched?.title).toBe("Sony FX3 Camera Operation");

      const all = await getAllSOPDocuments();
      expect(all.length).toBeGreaterThanOrEqual(1);

      // 3. Search
      const searchRes = await searchSOPDocuments("battery");
      expect(searchRes.length).toBeGreaterThanOrEqual(1);
      expect(searchRes[0].title).toBe("Sony FX3 Camera Operation");

      // 4. Update (Overwrite)
      const updated = await updateSOPDocument(sop1.id, {
        title: "Sony FX3 Camera Operation v2",
        category: "Video",
        content: "Updated battery checklist and ISO profile settings.",
        file_name: "Sony_FX3_Operation_v2.docx",
        file_size: 52000,
      });

      expect(updated?.title).toBe("Sony FX3 Camera Operation v2");
      expect(updated?.content).toContain("Updated battery checklist");

      // 5. Delete
      const del = await deleteSOPDocument(sop1.id);
      expect(del.success).toBe(true);

      const afterDelete = await getSOPDocumentById(sop1.id);
      expect(afterDelete).toBeUndefined();
    });
  });
});
