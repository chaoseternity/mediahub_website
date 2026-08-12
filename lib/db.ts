import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";
import type {
  Equipment,
  EquipmentDetail,
  Checkout,
  User,
  Role,
  EquipmentStatus,
  Condition,
  Tag,
} from "./types";

// ---------------------------------------------------------------------------
// D1 connection — falls back to a local SQLite adapter when running `next dev`
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type D1Like = any;

async function getDB(): Promise<D1Like> {
  try {
    const ctx = await getCloudflareContext({ async: true });
    return (ctx.env as { DB: D1Database }).DB;
  } catch {
    // Not running in a Cloudflare Workers context (e.g. `next dev`).
    // Lazy-import the local SQLite adapter so it's never bundled for production.
    const { localD1 } = await import("./local-db");
    return localD1;
  }
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const db = await getDB();
  return (await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first()) as
    | User
    | undefined;
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDB();
  return (await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first()) as
    | User
    | undefined;
}

export async function getAllUsers(): Promise<User[]> {
  const db = await getDB();
  const result = await db
    .prepare(
      "SELECT id, name, email, username, google_id, image, role, provider, created_at FROM users ORDER BY created_at"
    )
    .all();
  return result.results as unknown as User[];
}

export async function countUsers(): Promise<number> {
  const db = await getDB();
  const row = (await db.prepare("SELECT COUNT(*) as c FROM users").first()) as {
    c: number;
  } | null;
  return row?.c ?? 0;
}

function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
}

export async function upsertUser(params: {
  name: string;
  email: string;
  google_id: string;
  image: string | null;
  provider: string;
}): Promise<User> {
  const db = await getDB();
  const existing = await getUserByEmail(params.email);
  const adminEmails = getAdminEmails();
  const isAdminEmail = adminEmails.has(params.email.toLowerCase());

  if (existing) {
    if (isAdminEmail && existing.role !== "admin") {
      await db.prepare("UPDATE users SET role = 'admin' WHERE email = ?")
        .bind(params.email)
        .run();
    }
    await db.prepare(
      "UPDATE users SET name = ?, google_id = ?, image = ?, provider = ? WHERE email = ?"
    ).bind(params.name, params.google_id, params.image, params.provider, params.email).run();
    return (await getUserByEmail(params.email))!;
  }

  const count = await countUsers();
  const role: Role = isAdminEmail || count === 0 ? "admin" : "viewer";
  await db.prepare(
    "INSERT INTO users (name, email, google_id, image, role, provider) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(params.name, params.email, params.google_id, params.image, role, params.provider).run();
  return (await getUserByEmail(params.email))!;
}

export async function updateUserRole(id: number, role: Role): Promise<void> {
  const db = await getDB();
  await db.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
}

export async function deleteUser(id: number): Promise<void> {
  const db = await getDB();
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
}

export async function updateUsername(id: number, username: string): Promise<void> {
  const db = await getDB();
  await db.prepare("UPDATE users SET username = ? WHERE id = ?").bind(username, id).run();
}

// ---------------------------------------------------------------------------
// Equipment helpers
// ---------------------------------------------------------------------------

type EquipmentRow = Omit<Equipment, "tags"> & { tags_concat: string | null };

function parseTagsRow(row: EquipmentRow): Equipment {
  const { tags_concat, ...rest } = row;
  return {
    ...(rest as Omit<Equipment, "tags">),
    tags: tags_concat ? tags_concat.split("|||").filter(Boolean) : [],
  };
}

const EQUIPMENT_TAG_SELECT = `
  e.id, e.name, e.description, e.serial_number, e.purchase_date,
  e.condition, e.quantity, e.location, e.status, e.created_at, e.updated_at,
  GROUP_CONCAT(t.name, '|||') AS tags_concat
`;

export async function getAllEquipment(): Promise<Equipment[]> {
  const db = await getDB();
  const result = await db
    .prepare(
      `SELECT
        ${EQUIPMENT_TAG_SELECT},
        c.id    AS active_checkout_id,
        c.checked_out_by_name,
        c.checked_out_at,
        c.expected_return_at,
        c.checkout_location
      FROM equipment e
      LEFT JOIN equipment_tags et ON et.equipment_id = e.id
      LEFT JOIN tags t ON t.id = et.tag_id
      LEFT JOIN checkouts c ON c.equipment_id = e.id AND c.returned_at IS NULL
      GROUP BY e.id
      ORDER BY e.updated_at DESC
    `)
    .all();
  return (result.results as EquipmentRow[]).map(parseTagsRow);
}

export async function getEquipmentById(id: number): Promise<EquipmentDetail | undefined> {
  const db = await getDB();
  const row = (await db
    .prepare(
      `SELECT ${EQUIPMENT_TAG_SELECT}
      FROM equipment e
      LEFT JOIN equipment_tags et ON et.equipment_id = e.id
      LEFT JOIN tags t ON t.id = et.tag_id
      WHERE e.id = ?
      GROUP BY e.id`
    )
    .bind(id)
    .first()) as EquipmentRow | null;

  if (!row) return undefined;

  const checkoutsResult = await db
    .prepare("SELECT * FROM checkouts WHERE equipment_id = ? ORDER BY checked_out_at DESC")
    .bind(id)
    .all();
  const checkouts = checkoutsResult.results as unknown as Checkout[];
  const active_checkout = checkouts.find((ch) => ch.returned_at === null) ?? null;
  const { tags_concat, ...rest } = row;

  return {
    ...(rest as Omit<Equipment, "tags">),
    tags: tags_concat ? tags_concat.split("|||").filter(Boolean) : [],
    checkouts,
    active_checkout,
  };
}

export async function createEquipment(params: {
  name: string;
  tags: string[];
  description?: string;
  serial_number?: string;
  purchase_date?: string;
  condition: Condition;
  quantity: number;
  location: string;
  status: EquipmentStatus;
}): Promise<Equipment> {
  const db = await getDB();
  const { tags, ...rest } = params;
  const result = await db
    .prepare(
      `INSERT INTO equipment (name, description, serial_number, purchase_date, condition, quantity, location, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      rest.name,
      rest.description ?? null,
      rest.serial_number ?? null,
      rest.purchase_date ?? null,
      rest.condition,
      rest.quantity,
      rest.location,
      rest.status
    )
    .run();

  const newId = result.meta.last_row_id;
  if (tags.length > 0) {
    await db.batch(
      tags.map((tagName) =>
        db.prepare(
          "INSERT OR IGNORE INTO equipment_tags (equipment_id, tag_id) SELECT ?, id FROM tags WHERE name = ?"
        ).bind(newId, tagName)
      )
    );
  }

  return (await getEquipmentById(newId)) as unknown as Equipment;
}

export async function updateEquipment(
  id: number,
  params: Partial<{
    name: string;
    tags: string[];
    description: string;
    serial_number: string;
    purchase_date: string;
    condition: Condition;
    quantity: number;
    location: string;
    status: EquipmentStatus;
  }>
): Promise<EquipmentDetail | undefined> {
  const db = await getDB();
  const { tags, ...scalarParams } = params;

  const entries = Object.entries(scalarParams).filter(([, v]) => v !== undefined);
  if (entries.length > 0) {
    const fields = entries.map(([k]) => `${k} = ?`).join(", ");
    const values = entries.map(([, v]) => v);
    await db.prepare(
      `UPDATE equipment SET ${fields}, updated_at = datetime('now') WHERE id = ?`
    ).bind(...values, id).run();
  } else if (tags !== undefined) {
    await db.prepare("UPDATE equipment SET updated_at = datetime('now') WHERE id = ?").bind(id).run();
  }

  if (tags !== undefined) {
    await db.prepare("DELETE FROM equipment_tags WHERE equipment_id = ?").bind(id).run();
    if (tags.length > 0) {
      await db.batch(
        tags.map((tagName) =>
          db.prepare(
            "INSERT OR IGNORE INTO equipment_tags (equipment_id, tag_id) SELECT ?, id FROM tags WHERE name = ?"
          ).bind(id, tagName)
        )
      );
    }
  }

  return getEquipmentById(id);
}

export async function deleteEquipment(id: number): Promise<{ success: boolean; error?: string }> {
  const db = await getDB();
  const active = await db
    .prepare("SELECT id FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
    .bind(id)
    .first();

  if (active) {
    return { success: false, error: "Cannot delete equipment with an active checkout." };
  }

  await db.prepare("DELETE FROM equipment WHERE id = ?").bind(id).run();
  return { success: true };
}

export async function getEquipmentByTagId(tagId: number): Promise<Equipment[]> {
  const db = await getDB();
  const result = await db
    .prepare(
      `SELECT
        ${EQUIPMENT_TAG_SELECT},
        c.id    AS active_checkout_id,
        c.checked_out_by_name,
        c.checked_out_at,
        c.expected_return_at,
        c.checkout_location
      FROM equipment e
      INNER JOIN equipment_tags ef ON ef.equipment_id = e.id AND ef.tag_id = ?
      LEFT JOIN equipment_tags et ON et.equipment_id = e.id
      LEFT JOIN tags t ON t.id = et.tag_id
      LEFT JOIN checkouts c ON c.equipment_id = e.id AND c.returned_at IS NULL
      GROUP BY e.id
      ORDER BY e.name
    `)
    .bind(tagId)
    .all();
  return (result.results as EquipmentRow[]).map(parseTagsRow);
}

export async function addTagToEquipment(
  equipmentId: number,
  tagId: number
): Promise<{ success: boolean; error?: string }> {
  const db = await getDB();
  const equipment = await db.prepare("SELECT id FROM equipment WHERE id = ?").bind(equipmentId).first();
  if (!equipment) return { success: false, error: "Equipment not found." };
  const tag = await db.prepare("SELECT id FROM tags WHERE id = ?").bind(tagId).first();
  if (!tag) return { success: false, error: "Tag not found." };
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO equipment_tags (equipment_id, tag_id) VALUES (?, ?)").bind(equipmentId, tagId),
    db.prepare("UPDATE equipment SET updated_at = datetime('now') WHERE id = ?").bind(equipmentId),
  ]);
  return { success: true };
}

export async function removeTagFromEquipment(
  equipmentId: number,
  tagId: number
): Promise<{ success: boolean; error?: string }> {
  const db = await getDB();
  await db.batch([
    db.prepare("DELETE FROM equipment_tags WHERE equipment_id = ? AND tag_id = ?").bind(equipmentId, tagId),
    db.prepare("UPDATE equipment SET updated_at = datetime('now') WHERE id = ?").bind(equipmentId),
  ]);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Checkout helpers
// ---------------------------------------------------------------------------

export async function createCheckout(params: {
  equipment_id: number;
  checked_out_by: number | null;
  checked_out_by_name: string;
  expected_return_at?: string;
  notes?: string;
  checkout_location?: string;
}): Promise<Checkout> {
  const db = await getDB();

  const existing = await db
    .prepare("SELECT id FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
    .bind(params.equipment_id)
    .first();
  if (existing) throw new Error("Equipment is already checked out.");

  const result = await db
    .prepare(
      `INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, expected_return_at, notes, checkout_location)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      params.equipment_id,
      params.checked_out_by ?? null,
      params.checked_out_by_name,
      params.expected_return_at ?? null,
      params.notes ?? null,
      params.checkout_location ?? null
    )
    .run();

  await db
    .prepare("UPDATE equipment SET status = 'Checked Out', updated_at = datetime('now') WHERE id = ?")
    .bind(params.equipment_id)
    .run();

  return (await db
    .prepare("SELECT * FROM checkouts WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first()) as Checkout;
}

export async function returnCheckout(equipment_id: number): Promise<Checkout> {
  const db = await getDB();
  const active = (await db
    .prepare("SELECT * FROM checkouts WHERE equipment_id = ? AND returned_at IS NULL")
    .bind(equipment_id)
    .first()) as Checkout | null;

  if (!active) throw new Error("No active checkout found for this equipment.");

  await db.batch([
    db.prepare("UPDATE checkouts SET returned_at = datetime('now') WHERE id = ?").bind(active.id),
    db.prepare("UPDATE equipment SET status = 'Available', updated_at = datetime('now') WHERE id = ?").bind(equipment_id),
  ]);

  return (await db
    .prepare("SELECT * FROM checkouts WHERE id = ?")
    .bind(active.id)
    .first()) as Checkout;
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

export async function getAllTags(): Promise<Tag[]> {
  const db = await getDB();
  const result = await db.prepare("SELECT * FROM tags ORDER BY name").all();
  return result.results as unknown as Tag[];
}

export async function createTag(name: string): Promise<Tag> {
  const db = await getDB();
  const result = await db.prepare("INSERT INTO tags (name) VALUES (?)").bind(name).run();
  return (await db
    .prepare("SELECT * FROM tags WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first()) as Tag;
}

export async function deleteTag(id: number): Promise<{ success: boolean; error?: string }> {
  const db = await getDB();
  const tag = (await db
    .prepare("SELECT id, name FROM tags WHERE id = ?")
    .bind(id)
    .first()) as { id: number; name: string } | null;
  if (!tag) return { success: false, error: "Tag not found." };
  const inUse = await db
    .prepare("SELECT equipment_id FROM equipment_tags WHERE tag_id = ? LIMIT 1")
    .bind(id)
    .first();
  if (inUse) return { success: false, error: "Cannot delete a tag that is in use by equipment." };
  await db.prepare("DELETE FROM tags WHERE id = ?").bind(id).run();
  return { success: true };
}
