import { sql } from "@vercel/postgres";
import { ensureSchema } from "./postgres";
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

function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

export async function getUserByEmail(email: string): Promise<User | undefined> {
  await ensureSchema();
  const { rows } = await sql<User>`SELECT * FROM users WHERE LOWER(email) = LOWER(${email})`;
  return rows[0];
}

export async function getUserById(id: number): Promise<User | undefined> {
  await ensureSchema();
  const { rows } = await sql<User>`SELECT * FROM users WHERE id = ${id}`;
  return rows[0];
}

export async function getAllUsers(): Promise<User[]> {
  await ensureSchema();
  const { rows } = await sql<User>`
    SELECT id, name, email, username, google_id, image, role, provider, created_at
    FROM users
    ORDER BY created_at ASC
  `;
  return rows;
}

export async function countUsers(): Promise<number> {
  await ensureSchema();
  const { rows } = await sql<{ c: string }>`SELECT COUNT(*)::text as c FROM users`;
  return parseInt(rows[0]?.c ?? "0", 10);
}

export async function upsertUser(params: {
  name: string;
  email: string;
  google_id: string;
  image: string | null;
  provider: string;
}): Promise<User> {
  await ensureSchema();
  const existing = await getUserByEmail(params.email);
  const adminEmails = getAdminEmails();
  const isAdminEmail = adminEmails.has(params.email.toLowerCase());

  if (existing) {
    const newRole = isAdminEmail && existing.role !== "admin" ? "admin" : existing.role;
    await sql`
      UPDATE users
      SET name = ${params.name},
          google_id = ${params.google_id},
          image = ${params.image},
          provider = ${params.provider},
          role = ${newRole}
      WHERE id = ${existing.id}
    `;
    return (await getUserById(existing.id))!;
  }

  const count = await countUsers();
  const role: Role = isAdminEmail || count === 0 ? "admin" : "viewer";

  const { rows } = await sql<User>`
    INSERT INTO users (name, email, google_id, image, role, provider)
    VALUES (${params.name}, ${params.email}, ${params.google_id}, ${params.image}, ${role}, ${params.provider})
    RETURNING *
  `;
  return rows[0];
}

export async function updateUserRole(id: number, role: Role): Promise<void> {
  await ensureSchema();
  await sql`UPDATE users SET role = ${role} WHERE id = ${id}`;
}

export async function deleteUser(id: number): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM users WHERE id = ${id}`;
}

export async function updateUsername(id: number, username: string): Promise<void> {
  await ensureSchema();
  await sql`UPDATE users SET username = ${username} WHERE id = ${id}`;
}

// ---------------------------------------------------------------------------
// Equipment helpers
// ---------------------------------------------------------------------------

type EquipmentRawRow = Omit<Equipment, "tags"> & { tags: string[] | null };

function formatEquipmentRow(row: EquipmentRawRow): Equipment {
  return {
    ...row,
    tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
  };
}

export async function getAllEquipment(): Promise<Equipment[]> {
  await ensureSchema();
  const { rows } = await sql<EquipmentRawRow>`
    SELECT 
      e.id, e.name, e.description, e.serial_number, e.purchase_date,
      e.condition, e.quantity, e.location, e.status, e.created_at, e.updated_at,
      COALESCE(
        ARRAY_AGG(t.name) FILTER (WHERE t.name IS NOT NULL),
        '{}'
      ) AS tags,
      c.id AS active_checkout_id,
      c.checked_out_by_name,
      c.checked_out_at,
      c.expected_return_at,
      c.checkout_location
    FROM equipment e
    LEFT JOIN equipment_tags et ON et.equipment_id = e.id
    LEFT JOIN tags t ON t.id = et.tag_id
    LEFT JOIN checkouts c ON c.equipment_id = e.id AND c.returned_at IS NULL
    GROUP BY e.id, c.id, c.checked_out_by_name, c.checked_out_at, c.expected_return_at, c.checkout_location
    ORDER BY e.updated_at DESC
  `;
  return rows.map(formatEquipmentRow);
}

export async function getEquipmentById(id: number): Promise<EquipmentDetail | undefined> {
  await ensureSchema();
  const { rows: eqRows } = await sql<EquipmentRawRow>`
    SELECT 
      e.id, e.name, e.description, e.serial_number, e.purchase_date,
      e.condition, e.quantity, e.location, e.status, e.created_at, e.updated_at,
      COALESCE(
        ARRAY_AGG(t.name) FILTER (WHERE t.name IS NOT NULL),
        '{}'
      ) AS tags
    FROM equipment e
    LEFT JOIN equipment_tags et ON et.equipment_id = e.id
    LEFT JOIN tags t ON t.id = et.tag_id
    WHERE e.id = ${id}
    GROUP BY e.id
  `;

  if (eqRows.length === 0) return undefined;

  const eq = formatEquipmentRow(eqRows[0]);

  const { rows: checkouts } = await sql<Checkout>`
    SELECT * FROM checkouts WHERE equipment_id = ${id} ORDER BY checked_out_at DESC
  `;

  const active_checkout = checkouts.find((c) => c.returned_at === null) ?? null;

  return {
    ...eq,
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
  await ensureSchema();
  const { rows } = await sql<Equipment>`
    INSERT INTO equipment (name, description, serial_number, purchase_date, condition, quantity, location, status)
    VALUES (${params.name}, ${params.description ?? null}, ${params.serial_number ?? null}, ${params.purchase_date ?? null}, ${params.condition}, ${params.quantity}, ${params.location}, ${params.status})
    RETURNING *
  `;

  const newId = rows[0].id;

  if (params.tags && params.tags.length > 0) {
    for (const tagName of params.tags) {
      let tagObj = (await sql<Tag>`SELECT * FROM tags WHERE LOWER(name) = LOWER(${tagName})`).rows[0];
      if (!tagObj) {
        tagObj = (await sql<Tag>`INSERT INTO tags (name) VALUES (${tagName}) RETURNING *`).rows[0];
      }
      await sql`INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (${newId}, ${tagObj.id}) ON CONFLICT DO NOTHING`;
    }
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
  await ensureSchema();
  const existing = await getEquipmentById(id);
  if (!existing) return undefined;

  const { tags, ...scalars } = params;

  if (Object.keys(scalars).length > 0) {
    if (scalars.name !== undefined) await sql`UPDATE equipment SET name = ${scalars.name} WHERE id = ${id}`;
    if (scalars.description !== undefined) await sql`UPDATE equipment SET description = ${scalars.description} WHERE id = ${id}`;
    if (scalars.serial_number !== undefined) await sql`UPDATE equipment SET serial_number = ${scalars.serial_number} WHERE id = ${id}`;
    if (scalars.purchase_date !== undefined) await sql`UPDATE equipment SET purchase_date = ${scalars.purchase_date} WHERE id = ${id}`;
    if (scalars.condition !== undefined) await sql`UPDATE equipment SET condition = ${scalars.condition} WHERE id = ${id}`;
    if (scalars.quantity !== undefined) await sql`UPDATE equipment SET quantity = ${scalars.quantity} WHERE id = ${id}`;
    if (scalars.location !== undefined) await sql`UPDATE equipment SET location = ${scalars.location} WHERE id = ${id}`;
    if (scalars.status !== undefined) await sql`UPDATE equipment SET status = ${scalars.status} WHERE id = ${id}`;
    await sql`UPDATE equipment SET updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }

  if (tags !== undefined) {
    await sql`DELETE FROM equipment_tags WHERE equipment_id = ${id}`;
    for (const tagName of tags) {
      let tagObj = (await sql<Tag>`SELECT * FROM tags WHERE LOWER(name) = LOWER(${tagName})`).rows[0];
      if (!tagObj) {
        tagObj = (await sql<Tag>`INSERT INTO tags (name) VALUES (${tagName}) RETURNING *`).rows[0];
      }
      await sql`INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (${id}, ${tagObj.id}) ON CONFLICT DO NOTHING`;
    }
    await sql`UPDATE equipment SET updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }

  return getEquipmentById(id);
}

export async function deleteEquipment(id: number): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  const activeCheckouts = await sql`SELECT id FROM checkouts WHERE equipment_id = ${id} AND returned_at IS NULL`;
  if (activeCheckouts.rows.length > 0) {
    return { success: false, error: "Cannot delete equipment with an active checkout." };
  }

  await sql`DELETE FROM equipment WHERE id = ${id}`;
  return { success: true };
}

export async function getEquipmentByTagId(tagId: number): Promise<Equipment[]> {
  await ensureSchema();
  const { rows } = await sql<EquipmentRawRow>`
    SELECT 
      e.id, e.name, e.description, e.serial_number, e.purchase_date,
      e.condition, e.quantity, e.location, e.status, e.created_at, e.updated_at,
      COALESCE(
        ARRAY_AGG(t.name) FILTER (WHERE t.name IS NOT NULL),
        '{}'
      ) AS tags,
      c.id AS active_checkout_id,
      c.checked_out_by_name,
      c.checked_out_at,
      c.expected_return_at,
      c.checkout_location
    FROM equipment e
    INNER JOIN equipment_tags ef ON ef.equipment_id = e.id AND ef.tag_id = ${tagId}
    LEFT JOIN equipment_tags et ON et.equipment_id = e.id
    LEFT JOIN tags t ON t.id = et.tag_id
    LEFT JOIN checkouts c ON c.equipment_id = e.id AND c.returned_at IS NULL
    GROUP BY e.id, c.id, c.checked_out_by_name, c.checked_out_at, c.expected_return_at, c.checkout_location
    ORDER BY e.name ASC
  `;
  return rows.map(formatEquipmentRow);
}

export async function addTagToEquipment(
  equipmentId: number,
  tagId: number
): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  const eq = await sql`SELECT id FROM equipment WHERE id = ${equipmentId}`;
  if (eq.rows.length === 0) return { success: false, error: "Equipment not found." };
  const tag = await sql`SELECT id FROM tags WHERE id = ${tagId}`;
  if (tag.rows.length === 0) return { success: false, error: "Tag not found." };

  await sql`INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (${equipmentId}, ${tagId}) ON CONFLICT DO NOTHING`;
  await sql`UPDATE equipment SET updated_at = CURRENT_TIMESTAMP WHERE id = ${equipmentId}`;

  return { success: true };
}

export async function removeTagFromEquipment(
  equipmentId: number,
  tagId: number
): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  await sql`DELETE FROM equipment_tags WHERE equipment_id = ${equipmentId} AND tag_id = ${tagId}`;
  await sql`UPDATE equipment SET updated_at = CURRENT_TIMESTAMP WHERE id = ${equipmentId}`;
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
  await ensureSchema();
  const active = await sql`SELECT id FROM checkouts WHERE equipment_id = ${params.equipment_id} AND returned_at IS NULL`;
  if (active.rows.length > 0) {
    throw new Error("Equipment is already checked out.");
  }

  const { rows } = await sql<Checkout>`
    INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, expected_return_at, notes, checkout_location)
    VALUES (${params.equipment_id}, ${params.checked_out_by ?? null}, ${params.checked_out_by_name}, ${params.expected_return_at ?? null}, ${params.notes ?? null}, ${params.checkout_location ?? null})
    RETURNING *
  `;

  await sql`UPDATE equipment SET status = 'Checked Out', updated_at = CURRENT_TIMESTAMP WHERE id = ${params.equipment_id}`;
  return rows[0];
}

export async function returnCheckout(equipment_id: number): Promise<Checkout> {
  await ensureSchema();
  const active = await sql<Checkout>`SELECT * FROM checkouts WHERE equipment_id = ${equipment_id} AND returned_at IS NULL`;
  if (active.rows.length === 0) {
    throw new Error("No active checkout found for this equipment.");
  }

  const checkoutId = active.rows[0].id;
  const { rows } = await sql<Checkout>`
    UPDATE checkouts SET returned_at = CURRENT_TIMESTAMP WHERE id = ${checkoutId} RETURNING *
  `;

  await sql`UPDATE equipment SET status = 'Available', updated_at = CURRENT_TIMESTAMP WHERE id = ${equipment_id}`;
  return rows[0];
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

export async function getAllTags(): Promise<Tag[]> {
  await ensureSchema();
  const { rows } = await sql<Tag>`SELECT * FROM tags ORDER BY name ASC`;
  return rows;
}

export async function createTag(name: string): Promise<Tag> {
  await ensureSchema();
  const { rows } = await sql<Tag>`INSERT INTO tags (name) VALUES (${name}) RETURNING *`;
  return rows[0];
}

export async function deleteTag(id: number): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  const inUse = await sql`SELECT equipment_id FROM equipment_tags WHERE tag_id = ${id} LIMIT 1`;
  if (inUse.rows.length > 0) {
    return { success: false, error: "Cannot delete a tag that is in use by equipment." };
  }

  const { rowCount } = await sql`DELETE FROM tags WHERE id = ${id}`;
  if (rowCount === 0) {
    return { success: false, error: "Tag not found." };
  }

  return { success: true };
}
