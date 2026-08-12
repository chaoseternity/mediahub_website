/**
 * Smoke tests — exercises every public lib/db.ts helper through the real
 * implementation, backed by an ephemeral in-memory SQLite database.
 *
 * Runs automatically after every `npm run build` via the `postbuild` hook.
 */

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

// ── Mocks ────────────────────────────────────────────────────────────────────
//
// 1. Make getCloudflareContext() always throw — triggers the fallback path in
//    getDB() that lazily imports ./local-db.
// 2. Replace ./local-db with an in-memory SQLite adapter whose database can be
//    reset between every test via __resetDb().

jest.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: jest.fn().mockRejectedValue(new Error("no cloudflare context in test")),
}));

jest.mock("@/lib/local-db", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const BetterSqlite3 = require("better-sqlite3");
  const { SCHEMA_SQL } = require("@/lib/test-db") as typeof import("@/lib/test-db");
  /* eslint-enable @typescript-eslint/no-require-imports */

  function freshDb() {
    const d = new BetterSqlite3(":memory:");
    d.pragma("journal_mode = WAL");
    d.pragma("foreign_keys = ON");
    d.exec(SCHEMA_SQL);
    return d;
  }

  // `db` is captured by the closures below; __resetDb() swaps it out.
  // eslint-disable-next-line prefer-const
  let db = freshDb();

  class Stmt {
    constructor(
      public readonly _sql: string,
      public readonly _params: unknown[] = [],
    ) {}

    bind(...params: unknown[]): Stmt {
      return new Stmt(this._sql, params);
    }

    async first<T = Record<string, unknown>>(): Promise<T | null> {
      const row = db.prepare(this._sql).get(...(this._params as []));
      return (row !== undefined ? row : null) as T | null;
    }

    async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
      return { results: db.prepare(this._sql).all(...(this._params as [])) as T[] };
    }

    async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
      const info = db.prepare(this._sql).run(...(this._params as []));
      return { meta: { last_row_id: info.lastInsertRowid as number, changes: info.changes } };
    }
  }

  const localD1 = {
    prepare(sql: string): Stmt {
      return new Stmt(sql);
    },
    async batch(stmts: Stmt[]): Promise<void> {
      db.transaction(() => {
        for (const s of stmts) {
          db.prepare(s._sql).run(...(s._params as []));
        }
      })();
    },
  };

  /** Exposed so tests can get a clean slate before each test case. */
  function __resetDb(): void {
    db.close();
    db = freshDb();
  }

  return { localD1, __resetDb };
});

// ── Helper ────────────────────────────────────────────────────────────────────

function resetDb() {
  (jest.requireMock("@/lib/local-db") as { __resetDb: () => void }).__resetDb();
}

// ── Smoke tests ───────────────────────────────────────────────────────────────

describe("Smoke — lib/db.ts (in-memory SQLite)", () => {
  beforeEach(resetDb);

  // ── getAllEquipment ───────────────────────────────────────────────────────

  describe("getAllEquipment", () => {
    test("returns an empty array on a fresh database", async () => {
      expect(await getAllEquipment()).toEqual([]);
    });

    test("returns all created equipment", async () => {
      await createTag("Laptop");
      await createEquipment({ name: "A", tags: ["Laptop"], condition: "Good", quantity: 1, location: "L", status: "Available" });
      await createEquipment({ name: "B", tags: [],          condition: "New",  quantity: 2, location: "L", status: "Available" });
      const all = await getAllEquipment();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.name).sort()).toEqual(["A", "B"]);
    });
  });

  // ── createEquipment ───────────────────────────────────────────────────────

  describe("createEquipment", () => {
    test("creates a laptop with a tag and returns the correct shape", async () => {
      await createTag("Laptop");
      const eq = await createEquipment({
        name: "MacBook Pro",
        tags: ["Laptop"],
        condition: "Good",
        quantity: 1,
        location: "AV Storage",
        status: "Available",
      });
      expect(eq.id).toBeGreaterThan(0);
      expect(eq.name).toBe("MacBook Pro");
      expect(eq.status).toBe("Available");
      expect(eq.tags).toEqual(["Laptop"]);
    });

    test("creates an SD card with all optional fields", async () => {
      await createTag("SD Card (Video)");
      const eq = await createEquipment({
        name: "SanDisk 256 GB",
        tags: ["SD Card (Video)"],
        description: "High-speed video card",
        serial_number: "SD-001",
        purchase_date: "2024-01-01",
        condition: "New",
        quantity: 3,
        location: "Equipment Cabinet",
        status: "Available",
      });
      expect(eq.serial_number).toBe("SD-001");
      expect(eq.quantity).toBe(3);
      expect(eq.description).toBe("High-speed video card");
      expect(eq.tags).toContain("SD Card (Video)");
    });

    test("creates equipment without tags", async () => {
      const eq = await createEquipment({ name: "Mic", tags: [], condition: "Fair", quantity: 2, location: "Stage", status: "Available" });
      expect(eq.tags).toEqual([]);
    });

    test("creates equipment whose status survives a re-fetch", async () => {
      const eq = await createEquipment({ name: "Projector", tags: [], condition: "Good", quantity: 1, location: "Hall", status: "Under Maintenance" });
      const fetched = await getEquipmentById(eq.id);
      expect(fetched!.status).toBe("Under Maintenance");
    });
  });

  // ── getEquipmentById ──────────────────────────────────────────────────────

  describe("getEquipmentById", () => {
    test("returns undefined for a nonexistent id", async () => {
      expect(await getEquipmentById(9999)).toBeUndefined();
    });

    test("returns a fully populated EquipmentDetail including empty history", async () => {
      await createTag("A/V");
      const created = await createEquipment({ name: "Dell XPS", tags: ["A/V"], condition: "Good", quantity: 1, location: "Room A", status: "Available" });
      const detail = await getEquipmentById(created.id);
      expect(detail).toBeDefined();
      expect(detail!.name).toBe("Dell XPS");
      expect(detail!.tags).toContain("A/V");
      expect(detail!.checkouts).toEqual([]);
      expect(detail!.active_checkout).toBeNull();
    });
  });

  // ── updateEquipment ───────────────────────────────────────────────────────

  describe("updateEquipment", () => {
    test("updates scalar fields", async () => {
      const eq = await createEquipment({ name: "Projector", tags: [], condition: "Good", quantity: 1, location: "Lecture Hall", status: "Available" });
      const updated = await updateEquipment(eq.id, { name: "Epson EB-X", location: "Main Stage" });
      expect(updated!.name).toBe("Epson EB-X");
      expect(updated!.location).toBe("Main Stage");
    });

    test("replaces tags completely on update", async () => {
      await createTag("Lighting");
      await createTag("A/V");
      const eq = await createEquipment({ name: "Mixer", tags: ["Lighting"], condition: "Good", quantity: 1, location: "Booth", status: "Available" });
      const updated = await updateEquipment(eq.id, { tags: ["A/V"] });
      expect(updated!.tags).toContain("A/V");
      expect(updated!.tags).not.toContain("Lighting");
    });

    test("clears all tags when updated with an empty array", async () => {
      await createTag("Lighting");
      const eq = await createEquipment({ name: "Cable", tags: ["Lighting"], condition: "Good", quantity: 1, location: "Booth", status: "Available" });
      const updated = await updateEquipment(eq.id, { tags: [] });
      expect(updated!.tags).toEqual([]);
    });
  });

  // ── deleteEquipment ───────────────────────────────────────────────────────

  describe("deleteEquipment", () => {
    test("deletes equipment that is not checked out", async () => {
      const eq = await createEquipment({ name: "Old Cam", tags: [], condition: "Poor", quantity: 1, location: "Storage", status: "Retired" });
      const result = await deleteEquipment(eq.id);
      expect(result.success).toBe(true);
      expect(await getEquipmentById(eq.id)).toBeUndefined();
    });

    test("refuses to delete equipment with an active checkout", async () => {
      const eq = await createEquipment({ name: "Camera", tags: [], condition: "Good", quantity: 1, location: "Booth", status: "Available" });
      await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Alice" });
      const result = await deleteEquipment(eq.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/active checkout/i);
    });
  });

  // ── createCheckout ────────────────────────────────────────────────────────

  describe("createCheckout", () => {
    test("marks equipment as Checked Out and records the borrower", async () => {
      const eq = await createEquipment({ name: "Sony A7III", tags: [], condition: "Good", quantity: 1, location: "AV Storage", status: "Available" });
      await createCheckout({
        equipment_id: eq.id,
        checked_out_by: null,
        checked_out_by_name: "Alice",
        expected_return_at: "2026-03-25",
        notes: "Club shoot",
      });
      const detail = await getEquipmentById(eq.id);
      expect(detail!.active_checkout).not.toBeNull();
      expect(detail!.active_checkout!.checked_out_by_name).toBe("Alice");
      expect(detail!.active_checkout!.expected_return_at).toBe("2026-03-25");
      expect(detail!.active_checkout!.notes).toBe("Club shoot");
    });

    test("throws when the same equipment is checked out twice", async () => {
      const eq = await createEquipment({ name: "Tripod", tags: [], condition: "Good", quantity: 1, location: "AV Storage", status: "Available" });
      await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Bob" });
      await expect(
        createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Carol" })
      ).rejects.toThrow(/already checked out/i);
    });

    test("checkout appears in the full history on re-fetch", async () => {
      const eq = await createEquipment({ name: "Lens", tags: [], condition: "Good", quantity: 1, location: "AV Storage", status: "Available" });
      await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Dave" });
      const detail = await getEquipmentById(eq.id);
      expect(detail!.checkouts).toHaveLength(1);
      expect(detail!.checkouts[0].checked_out_by_name).toBe("Dave");
    });
  });

  // ── returnCheckout ────────────────────────────────────────────────────────

  describe("returnCheckout", () => {
    test("sets returned_at and clears the active checkout", async () => {
      const eq = await createEquipment({ name: "Gimbal", tags: [], condition: "Good", quantity: 1, location: "AV Storage", status: "Available" });
      await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Eve" });
      const returned = await returnCheckout(eq.id);
      expect(returned.returned_at).not.toBeNull();
      const detail = await getEquipmentById(eq.id);
      expect(detail!.active_checkout).toBeNull();
    });

    test("preserves checkout in history after return", async () => {
      const eq = await createEquipment({ name: "Drone", tags: [], condition: "New", quantity: 1, location: "AV Storage", status: "Available" });
      await createCheckout({ equipment_id: eq.id, checked_out_by: null, checked_out_by_name: "Frank" });
      await returnCheckout(eq.id);
      const detail = await getEquipmentById(eq.id);
      expect(detail!.checkouts).toHaveLength(1);
      expect(detail!.checkouts[0].returned_at).not.toBeNull();
    });

    test("throws when there is no active checkout to return", async () => {
      const eq = await createEquipment({ name: "Flash", tags: [], condition: "Good", quantity: 1, location: "AV Storage", status: "Available" });
      await expect(returnCheckout(eq.id)).rejects.toThrow(/no active checkout/i);
    });
  });

  // ── Tags ──────────────────────────────────────────────────────────────────

  describe("getAllTags", () => {
    test("returns an empty array on a fresh database", async () => {
      expect(await getAllTags()).toEqual([]);
    });

    test("returns all created tags in alphabetical order", async () => {
      await createTag("Zebra");
      await createTag("Alpha");
      const tags = await getAllTags();
      expect(tags.map((t) => t.name)).toEqual(["Alpha", "Zebra"]);
    });
  });

  describe("createTag", () => {
    test("creates a tag and returns it with an id", async () => {
      const tag = await createTag("SD Card (Photo)");
      expect(tag.id).toBeGreaterThan(0);
      expect(tag.name).toBe("SD Card (Photo)");
    });
  });

  describe("deleteTag", () => {
    test("deletes an unused tag successfully", async () => {
      const tag = await createTag("Unused");
      const result = await deleteTag(tag.id);
      expect(result.success).toBe(true);
      expect(await getAllTags()).toHaveLength(0);
    });

    test("refuses to delete a tag that is assigned to equipment", async () => {
      const tag = await createTag("In Use");
      await createEquipment({ name: "Boom Mic", tags: ["In Use"], condition: "Good", quantity: 1, location: "Stage", status: "Available" });
      const result = await deleteTag(tag.id);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/in use/i);
    });

    test("returns an error for a nonexistent tag id", async () => {
      const result = await deleteTag(9999);
      expect(result.success).toBe(false);
    });
  });

  // ── Tag ↔ Equipment association helpers ──────────────────────────────────

  describe("getEquipmentByTagId", () => {
    test("returns only equipment linked to the given tag", async () => {
      await createTag("Laptop");
      await createTag("Video");
      const laptop = await createEquipment({ name: "ThinkPad", tags: ["Laptop"], condition: "Good", quantity: 1, location: "L", status: "Available" });
      await createEquipment({ name: "SD Card", tags: ["Video"], condition: "New", quantity: 1, location: "L", status: "Available" });
      const laptopTag = (await getAllTags()).find((t) => t.name === "Laptop")!;
      const results = await getEquipmentByTagId(laptopTag.id);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(laptop.id);
    });
  });

  describe("addTagToEquipment / removeTagFromEquipment", () => {
    test("adds a tag then removes it", async () => {
      await createTag("Extra");
      const eq = await createEquipment({ name: "Widget", tags: [], condition: "Good", quantity: 1, location: "Lab", status: "Available" });
      const extraTag = (await getAllTags()).find((t) => t.name === "Extra")!;

      const addResult = await addTagToEquipment(eq.id, extraTag.id);
      expect(addResult.success).toBe(true);
      expect((await getEquipmentById(eq.id))!.tags).toContain("Extra");

      const removeResult = await removeTagFromEquipment(eq.id, extraTag.id);
      expect(removeResult.success).toBe(true);
      expect((await getEquipmentById(eq.id))!.tags).not.toContain("Extra");
    });

    test("returns error when equipment or tag does not exist", async () => {
      const result = await addTagToEquipment(9999, 9999);
      expect(result.success).toBe(false);
    });
  });

  // ── Users ─────────────────────────────────────────────────────────────────

  describe("upsertUser", () => {
    test("grants admin role to the very first user", async () => {
      const user = await upsertUser({ name: "Alice", email: "alice@example.com", google_id: "g1", image: null, provider: "google" });
      expect(user.id).toBeGreaterThan(0);
      expect(user.role).toBe("admin");
    });

    test("grants viewer role to subsequent users", async () => {
      await upsertUser({ name: "First",  email: "first@example.com",  google_id: "g1", image: null, provider: "google" });
      const second = await upsertUser({ name: "Second", email: "second@example.com", google_id: "g2", image: null, provider: "google" });
      expect(second.role).toBe("viewer");
    });

    test("updates name and image on re-login without creating a duplicate", async () => {
      await upsertUser({ name: "Old Name", email: "user@example.com", google_id: "gid", image: null,        provider: "google" });
      const updated = await upsertUser({ name: "New Name", email: "user@example.com", google_id: "gid", image: "avatar.png", provider: "google" });
      expect(updated.name).toBe("New Name");
      expect(updated.image).toBe("avatar.png");
      const all = await getAllUsers();
      expect(all.filter((u) => u.email === "user@example.com")).toHaveLength(1);
    });
  });

  describe("updateUserRole", () => {
    test("promotes a viewer to admin", async () => {
      await upsertUser({ name: "Admin", email: "admin@test.com", google_id: "g0", image: null, provider: "google" });
      const viewer = await upsertUser({ name: "Bob", email: "bob@test.com", google_id: "g1", image: null, provider: "google" });
      expect(viewer.role).toBe("viewer");
      await updateUserRole(viewer.id, "admin");
      const bob = (await getAllUsers()).find((u) => u.email === "bob@test.com")!;
      expect(bob.role).toBe("admin");
    });
  });
});
