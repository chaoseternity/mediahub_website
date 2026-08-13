/**
 * Smoke tests — exercises every public lib/db.ts helper through the real
 * implementation, backed by an in-memory Firestore mock.
 *
 * Runs automatically after every `npm run build` via the `postbuild` hook.
 */

// ── In-Memory Firestore Mock Setup ──────────────────────────────────────────

interface MockDocRef {
  col: string;
  id: string;
}

interface MockQuery {
  col: string;
  filters: Array<{ field: string; op: string; val: unknown }>;
  orderField?: string;
  orderDir?: "asc" | "desc";
}

let store: Record<string, Record<string, Record<string, unknown>>> = {};

function resetStore() {
  store = {};
}

jest.mock("@/lib/firebase", () => ({
  db: { _type: "mock_db" },
}));

jest.mock("firebase/firestore", () => {
  return {
    collection: (_db: unknown, path: string) => path,
    doc: (_db: unknown, colOrPath: string, ...rest: string[]) => {
      let col = colOrPath;
      let id = rest[0];
      if (rest.length === 0) {
        const parts = colOrPath.split("/");
        col = parts[0];
        id = parts[1];
      }
      return { col, id } as MockDocRef;
    },
    getDoc: async (ref: MockDocRef) => {
      const data = store[ref.col]?.[ref.id];
      return {
        exists: () => data !== undefined,
        data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
      };
    },
    getDocs: async (q: string | MockQuery) => {
      let col: string;
      let filters: Array<{ field: string; op: string; val: unknown }> = [];
      let orderField: string | undefined;
      let orderDir: "asc" | "desc" | undefined;

      if (typeof q === "string") {
        col = q;
      } else {
        col = q.col;
        filters = q.filters;
        orderField = q.orderField;
        orderDir = q.orderDir;
      }

      const colDocs = store[col] ? Object.values(store[col]) : [];
      let filtered = colDocs.filter((d) => {
        for (const f of filters) {
          const val = d[f.field];
          if (f.op === "==" && val !== f.val) return false;
        }
        return true;
      });

      if (orderField) {
        filtered = filtered.sort((a, b) => {
          const va = (a[orderField!] ?? "") as string | number;
          const vb = (b[orderField!] ?? "") as string | number;
          if (va < vb) return orderDir === "desc" ? 1 : -1;
          if (va > vb) return orderDir === "desc" ? -1 : 1;
          return 0;
        });
      }

      const docs = filtered.map((d) => ({
        data: () => JSON.parse(JSON.stringify(d)),
        ref: { col, id: String(d.id ?? d.equipment_id) },
      }));

      return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
      };
    },
    setDoc: async (ref: MockDocRef, data: Record<string, unknown>) => {
      if (!store[ref.col]) store[ref.col] = {};
      store[ref.col][ref.id] = JSON.parse(JSON.stringify(data));
    },
    updateDoc: async (ref: MockDocRef, patch: Record<string, unknown>) => {
      if (!store[ref.col]) store[ref.col] = {};
      const current = store[ref.col][ref.id] || {};
      store[ref.col][ref.id] = { ...current, ...JSON.parse(JSON.stringify(patch)) };
    },
    deleteDoc: async (ref: MockDocRef) => {
      if (store[ref.col]) {
        delete store[ref.col][ref.id];
      }
    },
    query: (colPath: string, ...clauses: unknown[]) => {
      const q: MockQuery = { col: colPath, filters: [] };
      for (const c of clauses) {
        const clause = c as { type: string; field: string; op?: string; val?: unknown; dir?: "asc" | "desc" };
        if (clause.type === "where") {
          q.filters.push({ field: clause.field, op: clause.op!, val: clause.val });
        } else if (clause.type === "orderBy") {
          q.orderField = clause.field;
          q.orderDir = clause.dir ?? "asc";
        }
      }
      return q;
    },
    where: (field: string, op: string, val: unknown) => ({ type: "where", field, op, val }),
    orderBy: (field: string, dir?: "asc" | "desc") => ({ type: "orderBy", field, dir }),
    runTransaction: async (_db: unknown, updateFunction: (t: unknown) => Promise<unknown>) => {
      const transaction = {
        get: async (ref: MockDocRef) => {
          const data = store[ref.col]?.[ref.id];
          return {
            exists: () => data !== undefined,
            data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
          };
        },
        set: (ref: MockDocRef, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
          if (!store[ref.col]) store[ref.col] = {};
          if (opts?.merge) {
            store[ref.col][ref.id] = { ...(store[ref.col][ref.id] || {}), ...JSON.parse(JSON.stringify(data)) };
          } else {
            store[ref.col][ref.id] = JSON.parse(JSON.stringify(data));
          }
        },
      };
      return await updateFunction(transaction);
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

describe("Smoke — lib/db.ts (in-memory Firestore)", () => {
  beforeEach(resetStore);

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
      expect(eq.tags).toEqual(["Camera", "Accessory"]);
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
