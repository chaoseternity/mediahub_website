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
        .replace(/CURRENT_TIMESTAMP/gi, "datetime('now')")
        .replace(/COALESCE\(\s*ARRAY_AGG\(t\.name\)\s*FILTER\s*\(WHERE\s*t\.name\s*IS\s*NOT\s*NULL\),\s*'{}'\s*\)/gi, "GROUP_CONCAT(t.name, '|||')")
        .replace(/INSERT INTO (\w+) \((.*?)\) VALUES \((.*?)\) ON CONFLICT DO NOTHING/gi, "INSERT OR IGNORE INTO $1 ($2) VALUES ($3)");

      let isReturning = false;
      if (/RETURNING \*/i.test(sqliteQuery)) {
        isReturning = true;
        sqliteQuery = sqliteQuery.replace(/RETURNING \*/gi, "");
      }

      const trimmed = sqliteQuery.trim();

      try {
        if (/^(SELECT|WITH)/i.test(trimmed)) {
          const stmt = testDb.prepare(sqliteQuery);
          const rows = stmt.all(...(values as [])) as Array<Record<string, unknown>>;
          const processedRows = rows.map((r) => {
            if ("tags" in r && typeof r.tags === "string") {
              const strVal = r.tags as string;
              (r as Record<string, unknown>).tags = strVal ? strVal.split("|||").filter(Boolean) : [];
            }
            return r;
          });
          return { rows: processedRows, rowCount: processedRows.length };
        } else {
          const stmt = testDb.prepare(sqliteQuery);
          const info = stmt.run(...(values as []));
          let returnedRows: Array<Record<string, unknown>> = [];
          if (isReturning && info.lastInsertRowid) {
            let table = "users";
            if (/INSERT INTO equipment/i.test(sqliteQuery)) table = "equipment";
            else if (/INSERT INTO tags/i.test(sqliteQuery)) table = "tags";
            else if (/INSERT INTO checkouts/i.test(sqliteQuery)) table = "checkouts";
            else if (/UPDATE checkouts/i.test(sqliteQuery)) table = "checkouts";

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
  getEquipmentById,
  updateEquipment,
  deleteEquipment,
  createCheckout,
  returnCheckout,
  getAllTags,
  createTag,
  deleteTag,
  upsertUser,
  updateUserRole,
  getAllUsers,
  getEquipmentByTagId,
  addTagToEquipment,
  removeTagFromEquipment,
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
      await createEquipment({ name: "A", tags: ["Laptop"], condition: "Good", quantity: 1, location: "L", status: "Available" });
      await createEquipment({ name: "B", tags: [], condition: "New", quantity: 2, location: "L", status: "Available" });
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
        condition: "New",
        quantity: 1,
        location: "Studio",
        status: "Available",
      });
      expect(eq.id).toBeGreaterThan(0);
      expect(eq.name).toBe("Camera");
      expect(eq.tags).toEqual([]);
      expect(eq.status).toBe("Available");
    });

    test("creates equipment with tags and auto-creates non-existent tags", async () => {
      const eq = await createEquipment({
        name: "Tripod",
        tags: ["Camera", "Accessory"],
        condition: "Good",
        quantity: 3,
        location: "Locker",
        status: "Available",
      });
      expect(eq.tags.sort()).toEqual(["Accessory", "Camera"]);
      const tags = await getAllTags();
      expect(tags.map((t) => t.name).sort()).toEqual(["Accessory", "Camera"]);
    });
  });

  // ── getEquipmentById ──────────────────────────────────────────────────────

  describe("getEquipmentById", () => {
    test("returns undefined for non-existent ID", async () => {
      expect(await getEquipmentById(999)).toBeUndefined();
    });

    test("returns equipment detail with checkouts array", async () => {
      const created = await createEquipment({
        name: "Mic",
        tags: [],
        condition: "Good",
        quantity: 1,
        location: "Rack",
        status: "Available",
      });
      const fetched = await getEquipmentById(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe("Mic");
      expect(fetched!.checkouts).toEqual([]);
      expect(fetched!.active_checkout).toBeNull();
    });
  });

  // ── updateEquipment ───────────────────────────────────────────────────────

  describe("updateEquipment", () => {
    test("updates scalar fields", async () => {
      const eq = await createEquipment({
        name: "Old Name",
        tags: [],
        condition: "Good",
        quantity: 1,
        location: "Room A",
        status: "Available",
      });

      const updated = await updateEquipment(eq.id, { name: "New Name", location: "Room B" });
      expect(updated?.name).toBe("New Name");
      expect(updated?.location).toBe("Room B");
    });

    test("updates tags", async () => {
      const eq = await createEquipment({
        name: "Item",
        tags: ["Tag1"],
        condition: "Good",
        quantity: 1,
        location: "A",
        status: "Available",
      });

      const updated = await updateEquipment(eq.id, { tags: ["Tag2", "Tag3"] });
      expect(updated?.tags.sort()).toEqual(["Tag2", "Tag3"]);
    });
  });

  // ── deleteEquipment ───────────────────────────────────────────────────────

  describe("deleteEquipment", () => {
    test("deletes equipment cleanly", async () => {
      const eq = await createEquipment({
        name: "Temp",
        tags: [],
        condition: "Poor",
        quantity: 1,
        location: "Trash",
        status: "Retired",
      });

      const res = await deleteEquipment(eq.id);
      expect(res.success).toBe(true);
      expect(await getEquipmentById(eq.id)).toBeUndefined();
    });

    test("refuses to delete equipment with active checkout", async () => {
      const eq = await createEquipment({
        name: "Active Item",
        tags: [],
        condition: "Good",
        quantity: 1,
        location: "A",
        status: "Available",
      });
      await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "John" });

      const res = await deleteEquipment(eq.id);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/active checkout/i);
    });
  });

  // ── checkouts ─────────────────────────────────────────────────────────────

  describe("createCheckout & returnCheckout", () => {
    test("creates a checkout and updates status", async () => {
      const eq = await createEquipment({
        name: "Lens",
        tags: [],
        condition: "New",
        quantity: 1,
        location: "Safe",
        status: "Available",
      });

      const co = await createCheckout({
        equipment_id: eq.id,
        checked_out_by: null,
        checked_out_by_name: "Alice",
        notes: "Project A",
      });

      expect(co.equipment_id).toBe(eq.id);
      expect(co.checked_out_by_name).toBe("Alice");

      const fetched = await getEquipmentById(eq.id);
      expect(fetched?.status).toBe("Checked Out");
      expect(fetched?.active_checkout?.id).toBe(co.id);
    });

    test("returns a checkout and resets status to Available", async () => {
      const eq = await createEquipment({
        name: "Monitor",
        tags: [],
        condition: "Good",
        quantity: 1,
        location: "Desk",
        status: "Available",
      });

      await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Bob" });
      const returned = await returnCheckout(eq.id);

      expect(returned.returned_at).not.toBeNull();

      const fetched = await getEquipmentById(eq.id);
      expect(fetched?.status).toBe("Available");
      expect(fetched?.active_checkout).toBeNull();
    });
  });

  // ── User management ───────────────────────────────────────────────────────

  describe("upsertUser & user management", () => {
    test("creates admin user on first insert", async () => {
      const u = await upsertUser({
        name: "Admin User",
        email: "admin@test.com",
        google_id: "g123",
        image: null,
        provider: "google",
      });
      expect(u.role).toBe("admin");

      const all = await getAllUsers();
      expect(all).toHaveLength(1);
    });

    test("creates viewer user on second insert", async () => {
      await upsertUser({ name: "Admin", email: "admin@test.com", google_id: "g1", image: null, provider: "google" });
      const viewer = await upsertUser({ name: "Viewer", email: "viewer@test.com", google_id: "g2", image: null, provider: "google" });
      expect(viewer.role).toBe("viewer");
    });

    test("updates role", async () => {
      await upsertUser({ name: "Admin", email: "admin@test.com", google_id: "g1", image: null, provider: "google" });
      const viewer = await upsertUser({ name: "Viewer", email: "viewer@test.com", google_id: "g2", image: null, provider: "google" });

      await updateUserRole(viewer.id, "admin");
      const users = await getAllUsers();
      const updated = users.find((u) => u.id === viewer.id);
      expect(updated?.role).toBe("admin");
    });
  });

  // ── Tag management ────────────────────────────────────────────────────────

  describe("Tags management", () => {
    test("creates and deletes tags", async () => {
      const tag = await createTag("Audio");
      expect(tag.name).toBe("Audio");

      const all = await getAllTags();
      expect(all.some((t) => t.name === "Audio")).toBe(true);

      const delRes = await deleteTag(tag.id);
      expect(delRes.success).toBe(true);
    });

    test("getEquipmentByTagId returns associated equipment", async () => {
      const tag = await createTag("Lighting");
      const eq = await createEquipment({ name: "Spotlight", tags: [], condition: "Good", quantity: 1, location: "Stage", status: "Available" });

      await addTagToEquipment(eq.id, tag.id);

      const items = await getEquipmentByTagId(tag.id);
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe("Spotlight");

      await removeTagFromEquipment(eq.id, tag.id);
      const emptyItems = await getEquipmentByTagId(tag.id);
      expect(emptyItems).toHaveLength(0);
    });
  });
});
