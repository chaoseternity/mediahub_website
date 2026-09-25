import { sql, ensureSchema } from "./d1";
import type {
  Equipment,
  EquipmentDetail,
  Checkout,
  User,
  Role,
  EquipmentStatus,
  Condition,
  Tag,
  AppEvent,
  EventStatus,
  EventSection,
  EventEquipmentLog,
  SectionICMap,
  SectionEquipmentMap,
  SectionEquipmentItem,
  SectionDeploymentMap,
  SectionDeploymentItem,
  SectionRehearsalMap,
  SOPDocument,
  DeploymentResponseStatus,
  NFCCard,
  NFCMemberData,
  NFCCheckoutItem,
  UserProfileData,
  UserProfileEvent,
  UserProfileCheckout,
  UserProfileRole,
} from "./types";
import { sendDeploymentInvitationEmail } from "./email";

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
  if (!Number.isInteger(id) || id <= 0) return undefined;
  await ensureSchema();
  const { rows } = await sql<User>`SELECT * FROM users WHERE id = ${id}`;
  return rows[0];
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
  if (!username) return undefined;
  await ensureSchema();
  const trimmed = username.trim();
  const { rows } = await sql<User>`
    SELECT * FROM users 
    WHERE LOWER(username) = LOWER(${trimmed}) OR LOWER(name) = LOWER(${trimmed})
    LIMIT 1
  `;
  return rows[0];
}

export async function getUserProfileData(userId: number): Promise<UserProfileData | undefined> {
  if (!Number.isInteger(userId) || userId <= 0) return undefined;
  await ensureSchema();

  const user = await getUserById(userId);
  if (!user) return undefined;

  // 1. Fetch checkouts associated with user (by ID or matching username/name)
  const username = user.username ?? "";
  const name = user.name ?? "";

  const { rows: checkoutRows } = await sql<{
    id: number;
    equipment_id: number;
    equipment_name: string;
    equipment_serial_number: string | null;
    equipment_location: string;
    equipment_condition: Condition;
    checked_out_by: number | null;
    checked_out_by_name: string;
    checked_out_at: string;
    expected_return_at: string | null;
    returned_at: string | null;
    notes: string | null;
    checkout_location: string | null;
    nfc_value: string | null;
  }>`
    SELECT 
      c.id, c.equipment_id,
      e.name AS equipment_name,
      e.serial_number AS equipment_serial_number,
      e.location AS equipment_location,
      e.condition AS equipment_condition,
      c.checked_out_by,
      c.checked_out_by_name,
      c.checked_out_at,
      c.expected_return_at,
      c.returned_at,
      c.notes,
      c.checkout_location,
      c.nfc_value
    FROM checkouts c
    JOIN equipment e ON e.id = c.equipment_id
    WHERE c.checked_out_by = ${userId}
       OR (LENGTH(${username}) > 0 AND LOWER(c.checked_out_by_name) = LOWER(${username}))
       OR (LENGTH(${name}) > 0 AND LOWER(c.checked_out_by_name) = LOWER(${name}))
    ORDER BY c.checked_out_at DESC
  `;

  const activeEquipment: UserProfileCheckout[] = [];
  const pastEquipment: UserProfileCheckout[] = [];

  for (const row of checkoutRows) {
    const item: UserProfileCheckout = {
      id: row.id,
      equipment_id: row.equipment_id,
      equipment_name: row.equipment_name,
      equipment_serial_number: row.equipment_serial_number,
      equipment_location: row.equipment_location,
      equipment_condition: row.equipment_condition,
      checked_out_by: row.checked_out_by,
      checked_out_by_name: row.checked_out_by_name,
      checked_out_at: row.checked_out_at,
      expected_return_at: row.expected_return_at,
      returned_at: row.returned_at,
      notes: row.notes,
      checkout_location: row.checkout_location,
      nfc_value: row.nfc_value ?? undefined,
    };

    if (row.returned_at === null) {
      activeEquipment.push(item);
    } else {
      pastEquipment.push(item);
    }
  }

  // 2. Fetch events where the user is OIC, Section IC, or Deployed
  // Query 2a: OIC events
  const { rows: oicEvents } = await sql<{
    event_id: number;
    event_name: string;
    description: string | null;
    start_time: string;
    end_time: string;
    location: string;
    has_rehearsal: number;
    rehearsal_start_time: string | null;
    rehearsal_end_time: string | null;
  }>`
    SELECT 
      ev.id AS event_id,
      ev.name AS event_name,
      ev.description,
      ev.start_time,
      ev.end_time,
      ev.location,
      ev.has_rehearsal,
      ev.rehearsal_start_time,
      ev.rehearsal_end_time
    FROM event_oics eo
    JOIN events ev ON ev.id = eo.event_id
    WHERE eo.user_id = ${userId}
    ORDER BY ev.start_time DESC
  `;

  // Query 2b: Section IC events
  const { rows: icEvents } = await sql<{
    event_id: number;
    event_name: string;
    description: string | null;
    start_time: string;
    end_time: string;
    location: string;
    has_rehearsal: number;
    rehearsal_start_time: string | null;
    rehearsal_end_time: string | null;
    section: EventSection;
  }>`
    SELECT 
      ev.id AS event_id,
      ev.name AS event_name,
      ev.description,
      ev.start_time,
      ev.end_time,
      ev.location,
      ev.has_rehearsal,
      ev.rehearsal_start_time,
      ev.rehearsal_end_time,
      ei.section
    FROM event_ics ei
    JOIN events ev ON ev.id = ei.event_id
    WHERE ei.user_id = ${userId}
    ORDER BY ev.start_time DESC
  `;

  // Query 2c: Section Deployed events
  const { rows: depEvents } = await sql<{
    event_id: number;
    event_name: string;
    description: string | null;
    start_time: string;
    end_time: string;
    location: string;
    has_rehearsal: number;
    rehearsal_start_time: string | null;
    rehearsal_end_time: string | null;
    section: EventSection;
    attending_rehearsal: number;
    response_status: DeploymentResponseStatus;
    responded_at: string | null;
  }>`
    SELECT 
      ev.id AS event_id,
      ev.name AS event_name,
      ev.description,
      ev.start_time,
      ev.end_time,
      ev.location,
      ev.has_rehearsal,
      ev.rehearsal_start_time,
      ev.rehearsal_end_time,
      ed.section,
      ed.attending_rehearsal,
      ed.response_status,
      ed.responded_at
    FROM event_deployments ed
    JOIN events ev ON ev.id = ed.event_id
    WHERE ed.user_id = ${userId}
    ORDER BY ev.start_time DESC
  `;

  // Map & combine all events by event_id
  const eventMap = new Map<number, UserProfileEvent>();

  const getStatus = (start: string, end: string): EventStatus => {
    const now = new Date().toISOString();
    if (now < start) return "Upcoming";
    if (now > end) return "Completed";
    return "Ongoing";
  };

  for (const oic of oicEvents) {
    if (!eventMap.has(oic.event_id)) {
      eventMap.set(oic.event_id, {
        event_id: oic.event_id,
        event_name: oic.event_name,
        description: oic.description,
        start_time: oic.start_time,
        end_time: oic.end_time,
        location: oic.location,
        has_rehearsal: Boolean(oic.has_rehearsal),
        rehearsal_start_time: oic.rehearsal_start_time,
        rehearsal_end_time: oic.rehearsal_end_time,
        status: getStatus(oic.start_time, oic.end_time),
        roles: [],
      });
    }
    eventMap.get(oic.event_id)!.roles.push({
      type: "oic",
      label: "Overall In-Charge (OIC)",
    });
  }

  for (const ic of icEvents) {
    if (!eventMap.has(ic.event_id)) {
      eventMap.set(ic.event_id, {
        event_id: ic.event_id,
        event_name: ic.event_name,
        description: ic.description,
        start_time: ic.start_time,
        end_time: ic.end_time,
        location: ic.location,
        has_rehearsal: Boolean(ic.has_rehearsal),
        rehearsal_start_time: ic.rehearsal_start_time,
        rehearsal_end_time: ic.rehearsal_end_time,
        status: getStatus(ic.start_time, ic.end_time),
        roles: [],
      });
    }
    const secUpper = ic.section.toUpperCase();
    eventMap.get(ic.event_id)!.roles.push({
      type: "section_ic",
      section: ic.section,
      label: `${secUpper} In-Charge (IC)`,
    });
  }

  for (const dep of depEvents) {
    if (!eventMap.has(dep.event_id)) {
      eventMap.set(dep.event_id, {
        event_id: dep.event_id,
        event_name: dep.event_name,
        description: dep.description,
        start_time: dep.start_time,
        end_time: dep.end_time,
        location: dep.location,
        has_rehearsal: Boolean(dep.has_rehearsal),
        rehearsal_start_time: dep.rehearsal_start_time,
        rehearsal_end_time: dep.rehearsal_end_time,
        status: getStatus(dep.start_time, dep.end_time),
        roles: [],
      });
    }
    const secUpper = dep.section.toUpperCase();
    eventMap.get(dep.event_id)!.roles.push({
      type: "deployment",
      section: dep.section,
      label: `${secUpper} Crew`,
      response_status: dep.response_status,
      attending_rehearsal: Boolean(dep.attending_rehearsal),
      responded_at: dep.responded_at,
    });
  }

  // Sort events by start_time DESC
  const events = Array.from(eventMap.values()).sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
  );

  // 3. Check for linked NFC card
  let nfcCard: NFCCard | null = null;
  const { rows: nfcCards } = await sql<NFCCard>`
    SELECT * FROM nfc_cards 
    WHERE (LENGTH(${username}) > 0 AND LOWER(member_name) = LOWER(${username}))
       OR (LENGTH(${name}) > 0 AND LOWER(member_name) = LOWER(${name}))
    LIMIT 1
  `;
  if (nfcCards.length > 0) {
    nfcCard = nfcCards[0];
  }

  // 4. Stats
  const activePossessionsCount = activeEquipment.length;
  const totalCheckoutsCount = activeEquipment.length + pastEquipment.length;
  const upcomingEventsCount = events.filter((e) => e.status !== "Completed").length;
  const completedEventsCount = events.filter((e) => e.status === "Completed").length;

  return {
    user,
    activeEquipment,
    pastEquipment,
    events,
    nfcCard,
    stats: {
      activePossessionsCount,
      totalCheckoutsCount,
      upcomingEventsCount,
      completedEventsCount,
    },
  };
}

export async function getAllUsers(): Promise<User[]> {
  await ensureSchema();
  const { rows } = await sql<User>`
    SELECT id, name, email, username, google_id, image, role, provider, created_at
    FROM users
    ORDER BY name ASC
  `;
  return rows;
}

export async function countUsers(): Promise<number> {
  await ensureSchema();
  const { rows } = await sql<{ c: number | string }>`SELECT COUNT(*) as c FROM users`;
  return parseInt(String(rows[0]?.c ?? "0"), 10);
}

export async function upsertUser(params: {
  name: string;
  email: string;
  google_id: string;
  image: string | null;
  provider: string;
}): Promise<User> {
  await ensureSchema();
  const normalizedEmail = params.email.trim().toLowerCase();
  const existing = await getUserByEmail(normalizedEmail);
  const adminEmails = getAdminEmails();
  const isAdminEmail = adminEmails.has(normalizedEmail);

  if (existing) {
    const newRole = isAdminEmail && existing.role !== "admin" ? "admin" : existing.role;
    const newImage = params.image ?? existing.image;
    await sql`
      UPDATE users
      SET name = ${params.name},
          google_id = ${params.google_id},
          image = ${newImage},
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
    VALUES (${params.name}, ${normalizedEmail}, ${params.google_id}, ${params.image}, ${role}, ${params.provider})
    RETURNING *
  `;
  return rows[0];
}

export async function countAdmins(): Promise<number> {
  await ensureSchema();
  const { rows } = await sql<{ c: number | string }>`SELECT COUNT(*) as c FROM users WHERE role = 'admin'`;
  return parseInt(String(rows[0]?.c ?? "0"), 10);
}

export async function updateUserRole(id: number, role: Role): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid user ID" };
  }
  const user = await getUserById(id);
  if (!user) {
    return { success: false, error: "User not found" };
  }
  if (user.role === "admin" && role !== "admin") {
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      return { success: false, error: "Cannot demote the only remaining admin account." };
    }
  }
  await sql`UPDATE users SET role = ${role} WHERE id = ${id}`;
  return { success: true };
}

export async function deleteUser(id: number): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid user ID" };
  }
  const user = await getUserById(id);
  if (!user) {
    return { success: false, error: "User not found" };
  }
  if (user.role === "admin") {
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      return { success: false, error: "Cannot delete the only remaining admin account." };
    }
  }
  const activeCheckouts = await sql`
    SELECT id FROM checkouts WHERE checked_out_by = ${id} AND returned_at IS NULL LIMIT 1
  `;
  if (activeCheckouts.rows.length > 0) {
    return {
      success: false,
      error: "Cannot delete user with active equipment checkouts. Please return all equipment first.",
    };
  }
  await sql`UPDATE checkouts SET checked_out_by = NULL WHERE checked_out_by = ${id}`;
  await sql`DELETE FROM users WHERE id = ${id}`;
  return { success: true };
}

export async function updateUsername(id: number, username: string): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid user ID");
  }
  const trimmed = username ? username.trim() : "";
  if (!trimmed || trimmed.length > 50) {
    throw new Error("Invalid username");
  }
  await ensureSchema();
  await sql`UPDATE users SET username = ${trimmed} WHERE id = ${id}`;
}

// ---------------------------------------------------------------------------
// NFC Card helpers (Dedicated card entity, separate from User accounts)
// ---------------------------------------------------------------------------

export async function getNfcCardByValue(nfcValue: string): Promise<NFCCard | undefined> {
  if (!nfcValue || typeof nfcValue !== "string") return undefined;
  const trimmed = nfcValue.trim().slice(0, 100);
  if (!trimmed) return undefined;
  await ensureSchema();
  const { rows } = await sql<NFCCard>`
    SELECT * FROM nfc_cards WHERE LOWER(nfc_value) = LOWER(${trimmed})
  `;
  return rows[0];
}

export async function getAllNfcCards(): Promise<NFCCard[]> {
  await ensureSchema();
  const { rows } = await sql<NFCCard>`
    SELECT * FROM nfc_cards ORDER BY member_name ASC
  `;
  return rows;
}

export async function createNfcCard(params: {
  nfc_value: string;
  member_name: string;
  notes?: string;
}): Promise<NFCCard> {
  await ensureSchema();
  const val = params.nfc_value.trim();
  const name = params.member_name.trim();
  const existing = await getNfcCardByValue(val);
  if (existing) {
    throw new Error(`NFC card "${val}" already exists in the database.`);
  }
  const { rows } = await sql<NFCCard>`
    INSERT INTO nfc_cards (nfc_value, member_name, notes)
    VALUES (${val}, ${name}, ${params.notes ?? null})
    RETURNING *
  `;
  return rows[0];
}

export async function updateNfcCard(id: number, memberName: string, notes?: string): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid NFC card ID");
  }
  await ensureSchema();
  await sql`
    UPDATE nfc_cards
    SET member_name = ${memberName.trim()}, notes = ${notes ?? null}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
  `;
}

export async function deleteNfcCard(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid NFC card ID");
  }
  await ensureSchema();
  await sql`DELETE FROM nfc_cards WHERE id = ${id}`;
}

// ---------------------------------------------------------------------------
// Equipment helpers
// ---------------------------------------------------------------------------

type EquipmentRawRow = Omit<Equipment, "tags"> & { tags: string[] | string | null };

function formatEquipmentRow(row: EquipmentRawRow): Equipment {
  let tags: string[] = [];
  if (Array.isArray(row.tags)) {
    tags = row.tags.filter(Boolean);
  } else if (typeof row.tags === "string") {
    tags = row.tags.split(",").map((t) => t.trim()).filter(Boolean);
  }

  const formatted: Equipment = {
    ...row,
    tags,
  };

  if (formatted.active_event_id && (formatted.status === "Available" || formatted.status === "Checked Out")) {
    formatted.status = formatted.is_rehearsal ? "In Event (Rehearsal)" : "In Event";
  }

  return formatted;
}

export async function getAllEquipment(): Promise<Equipment[]> {
  await ensureSchema();
  const { rows } = await sql<EquipmentRawRow>`
    SELECT 
      e.id, e.name, e.description, e.serial_number,
      e.condition, e.location, e.status, e.created_at, e.updated_at,
      GROUP_CONCAT(DISTINCT t.name) AS tags,
      c.id AS active_checkout_id,
      c.checked_out_by_name,
      c.checked_out_at,
      c.expected_return_at,
      c.checkout_location,
      ev.id AS active_event_id,
      ev.name AS active_event_name,
      ev.location AS active_event_location,
      CASE
        WHEN ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal THEN ev.rehearsal_start_time
        ELSE ev.start_time
      END AS active_event_start_time,
      CASE
        WHEN ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal THEN ev.rehearsal_end_time
        ELSE ev.end_time
      END AS active_event_end_time,
      (ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal) AS is_rehearsal
    FROM equipment e
    LEFT JOIN equipment_tags et ON et.equipment_id = e.id
    LEFT JOIN tags t ON t.id = et.tag_id
    LEFT JOIN checkouts c ON c.equipment_id = e.id AND c.returned_at IS NULL
    LEFT JOIN event_equipment ee ON ee.equipment_id = e.id
    LEFT JOIN events ev ON ev.id = ee.event_id AND (
      (CURRENT_TIMESTAMP >= ev.start_time AND CURRENT_TIMESTAMP <= ev.end_time) OR
      (ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal)
    )
    GROUP BY e.id, c.id, c.checked_out_by_name, c.checked_out_at, c.expected_return_at, c.checkout_location, ev.id, ev.name, ev.location, ev.start_time, ev.end_time, ev.has_rehearsal, ev.rehearsal_start_time, ev.rehearsal_end_time, ee.used_for_rehearsal
    ORDER BY e.updated_at DESC
  `;
  return rows.map(formatEquipmentRow);
}

export async function getEquipmentById(id: number): Promise<EquipmentDetail | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  await ensureSchema();
  const { rows: eqRows } = await sql<EquipmentRawRow>`
    SELECT 
      e.id, e.name, e.description, e.serial_number,
      e.condition, e.location, e.status, e.created_at, e.updated_at,
      GROUP_CONCAT(DISTINCT t.name) AS tags,
      c.id AS active_checkout_id,
      c.checked_out_by_name,
      c.checked_out_at,
      c.expected_return_at,
      c.checkout_location,
      ev.id AS active_event_id,
      ev.name AS active_event_name,
      ev.location AS active_event_location,
      CASE
        WHEN ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal THEN ev.rehearsal_start_time
        ELSE ev.start_time
      END AS active_event_start_time,
      CASE
        WHEN ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal THEN ev.rehearsal_end_time
        ELSE ev.end_time
      END AS active_event_end_time,
      (ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal) AS is_rehearsal
    FROM equipment e
    LEFT JOIN equipment_tags et ON et.equipment_id = e.id
    LEFT JOIN tags t ON t.id = et.tag_id
    LEFT JOIN checkouts c ON c.equipment_id = e.id AND c.returned_at IS NULL
    LEFT JOIN event_equipment ee ON ee.equipment_id = e.id
    LEFT JOIN events ev ON ev.id = ee.event_id AND (
      (CURRENT_TIMESTAMP >= ev.start_time AND CURRENT_TIMESTAMP <= ev.end_time) OR
      (ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal)
    )
    WHERE e.id = ${id}
    GROUP BY e.id, c.id, c.checked_out_by_name, c.checked_out_at, c.expected_return_at, c.checkout_location, ev.id, ev.name, ev.location, ev.start_time, ev.end_time, ev.has_rehearsal, ev.rehearsal_start_time, ev.rehearsal_end_time, ee.used_for_rehearsal
  `;

  if (eqRows.length === 0) return undefined;

  const eq = formatEquipmentRow(eqRows[0]);

  const { rows: checkouts } = await sql<Checkout>`
    SELECT * FROM checkouts WHERE equipment_id = ${id} ORDER BY checked_out_at DESC
  `;

  const { rows: event_logs } = await sql<EventEquipmentLog>`
    SELECT 
      ev.id AS event_id,
      ev.name AS event_name,
      ev.location AS event_location,
      ev.start_time,
      ev.end_time,
      ee.added_at,
      ee.used_for_rehearsal AS is_rehearsal
    FROM event_equipment ee
    JOIN events ev ON ev.id = ee.event_id
    WHERE ee.equipment_id = ${id}
    ORDER BY ee.added_at DESC
  `;

  const active_checkout = checkouts.find((c) => c.returned_at === null) ?? null;

  return {
    ...eq,
    checkouts,
    active_checkout,
    event_logs,
  };
}

export async function createEquipment(params: {
  name: string;
  tags: string[];
  description?: string;
  serial_number?: string;
  condition: Condition;
  location: string;
  status: EquipmentStatus;
}): Promise<Equipment> {
  await ensureSchema();
  let status = params.status;
  let condition = params.condition;

  if (condition === "Missing" || status === "Unavailable (Missing)") {
    condition = "Missing";
    status = "Unavailable (Missing)";
  } else if (condition === "Retired" || status === "Unavailable (Retired)") {
    condition = "Retired";
    status = "Unavailable (Retired)";
  } else if (condition === "Broken") {
    if (status !== "Unavailable (In Repairs)") {
      status = "Unavailable (Broken)";
    }
  } else if (status === "Unavailable (In Repairs)" && condition === "Working") {
    status = "Available";
  }

  const { rows } = await sql<Equipment>`
    INSERT INTO equipment (name, description, serial_number, condition, location, status)
    VALUES (${params.name}, ${params.description ?? null}, ${params.serial_number ?? null}, ${condition}, ${params.location}, ${status})
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
    condition: Condition;
    location: string;
    status: EquipmentStatus;
  }>
): Promise<EquipmentDetail | undefined> {
  await ensureSchema();
  const existing = await getEquipmentById(id);
  if (!existing) return undefined;

  const { tags, ...scalars } = params;

  if (Object.keys(scalars).length > 0) {
    let nextCondition = scalars.condition ?? existing.condition;
    let nextStatus = scalars.status ?? existing.status;

    // Condition / Status coupling for Missing
    const isMissingCond = (scalars.condition as string) === "Missing";
    const isMissingStatus = (scalars.status as string) === "Unavailable (Missing)";
    const wasMissingCond = (existing.condition as string) === "Missing";
    const wasMissingStatus = (existing.status as string) === "Unavailable (Missing)";

    if (isMissingCond || isMissingStatus) {
      nextCondition = "Missing";
      nextStatus = "Unavailable (Missing)";
    } else if (wasMissingCond && scalars.condition !== undefined && !isMissingCond) {
      // If moving away from Missing condition and status wasn't explicitly provided, default status away from Unavailable (Missing)
      if (scalars.status === undefined || isMissingStatus) {
        nextStatus = "Available";
      }
    } else if (wasMissingStatus && scalars.status !== undefined && !isMissingStatus) {
      // If moving away from Unavailable (Missing) status and condition wasn't explicitly provided, default condition to Working
      if (scalars.condition === undefined || isMissingCond) {
        nextCondition = "Working";
      }
    }

    // Condition / Status coupling for Retired
    const isRetiredCond = (scalars.condition as string) === "Retired";
    const isRetiredStatus = (scalars.status as string) === "Unavailable (Retired)";
    const wasRetiredCond = (existing.condition as string) === "Retired";
    const wasRetiredStatus = (existing.status as string) === "Unavailable (Retired)";

    if (isRetiredCond || isRetiredStatus) {
      nextCondition = "Retired";
      nextStatus = "Unavailable (Retired)";
    } else if (wasRetiredCond && scalars.condition !== undefined && !isRetiredCond) {
      if (scalars.status === undefined || isRetiredStatus) {
        nextStatus = "Available";
      }
    } else if (wasRetiredStatus && scalars.status !== undefined && !isRetiredStatus) {
      if (scalars.condition === undefined || isRetiredCond) {
        nextCondition = "Working";
      }
    }

    if (nextCondition === "Broken") {
      if (nextStatus !== "Unavailable (In Repairs)") {
        nextStatus = "Unavailable (Broken)";
      }
    } else if (nextStatus === "Unavailable (Broken)") {
      nextStatus = "Available";
    } else if (nextStatus === "Unavailable (In Repairs)" && nextCondition === "Working") {
      nextStatus = "Available";
    }

    if (scalars.name !== undefined) await sql`UPDATE equipment SET name = ${scalars.name} WHERE id = ${id}`;
    if (scalars.description !== undefined) await sql`UPDATE equipment SET description = ${scalars.description} WHERE id = ${id}`;
    if (scalars.serial_number !== undefined) await sql`UPDATE equipment SET serial_number = ${scalars.serial_number} WHERE id = ${id}`;
    await sql`UPDATE equipment SET condition = ${nextCondition} WHERE id = ${id}`;
    if (scalars.location !== undefined) await sql`UPDATE equipment SET location = ${scalars.location} WHERE id = ${id}`;
    await sql`UPDATE equipment SET status = ${nextStatus} WHERE id = ${id}`;
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

export async function batchUpsertEquipment(
  items: {
    name: string;
    serial_number?: string | null;
    tags: string[];
    description?: string | null;
    condition: Condition;
    location: string;
  }[],
  deleteMissingIds?: number[]
): Promise<{ createdCount: number; updatedCount: number; deletedCount: number; errors: string[] }> {
  await ensureSchema();
  let createdCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  const errors: string[] = [];

  // Fetch existing equipment and tags upfront to prevent hundreds of sequential roundtrips
  const { rows: existingRows } = await sql<{ id: number; name: string; serial_number: string | null; status: EquipmentStatus; condition: Condition }>`
    SELECT id, LOWER(TRIM(name)) as name, LOWER(TRIM(serial_number)) as serial_number, status, condition FROM equipment
  `;

  const { rows: tagRows } = await sql<Tag>`
    SELECT id, name FROM tags
  `;

  const tagMap = new Map<string, number>();
  for (const t of tagRows) {
    if (t.name) tagMap.set(t.name.trim().toLowerCase(), t.id);
  }

  const existingMap = new Map<number, { id: number; name: string; serial_number: string | null; status: EquipmentStatus; condition: Condition }>();
  const existingBySerial = new Map<string, number>();
  const existingByName = new Map<string, number>();

  for (const eq of existingRows) {
    existingMap.set(eq.id, eq);
    if (eq.serial_number) {
      existingBySerial.set(eq.serial_number.toLowerCase(), eq.id);
    }
    if (eq.name && !existingByName.has(eq.name.toLowerCase())) {
      existingByName.set(eq.name.toLowerCase(), eq.id);
    }
  }

  for (const item of items) {
    try {
      let existingId: number | null = null;

      const cleanSerial = item.serial_number ? item.serial_number.trim().toLowerCase() : "";
      const cleanName = item.name ? item.name.trim().toLowerCase() : "";

      // 1. Match by serial_number if provided
      if (cleanSerial) {
        const matched = existingBySerial.get(cleanSerial);
        if (matched) {
          existingId = matched;
        }
      } else if (cleanName) {
        // 2. Only fallback match by name if NO serial_number was provided!
        const matched = existingByName.get(cleanName);
        if (matched) {
          existingId = matched;
        }
      }

      let targetId: number;

      if (existingId) {
        targetId = existingId;
        const current = existingMap.get(existingId);
        const currentStatus = current ? current.status : "Available";

        // Determine next status: preserve existing status, but enforce standard status-condition pairing
        let nextStatus: EquipmentStatus = currentStatus;

        if (item.condition === "Missing") {
          nextStatus = "Unavailable (Missing)";
        } else if (item.condition === "Retired") {
          nextStatus = "Unavailable (Retired)";
        } else if (item.condition === "Broken") {
          if (currentStatus === "Unavailable (In Repairs)") {
            nextStatus = "Unavailable (In Repairs)";
          } else {
            nextStatus = "Unavailable (Broken)";
          }
        } else if (item.condition === "Impaired") {
          if (
            currentStatus === "Unavailable (Missing)" ||
            currentStatus === "Unavailable (Broken)" ||
            currentStatus === "Unavailable (Retired)"
          ) {
            nextStatus = "Available";
          }
        } else if (item.condition === "Working") {
          if (
            currentStatus === "Unavailable (Missing)" ||
            currentStatus === "Unavailable (Broken)" ||
            currentStatus === "Unavailable (In Repairs)" ||
            currentStatus === "Unavailable (Retired)"
          ) {
            nextStatus = "Available";
          }
        }

        // Update ALL equipment information
        await sql`
          UPDATE equipment 
          SET name = ${item.name},
              description = ${item.description ?? null},
              serial_number = ${item.serial_number ?? null},
              condition = ${item.condition},
              location = ${item.location},
              status = ${nextStatus},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${existingId}
        `;

        if (current) {
          current.status = nextStatus;
          current.condition = item.condition;
        }
        updatedCount++;
      } else {
        // Insert new equipment
        let initialStatus: EquipmentStatus = "Available";
        if (item.condition === "Missing") {
          initialStatus = "Unavailable (Missing)";
        } else if (item.condition === "Retired") {
          initialStatus = "Unavailable (Retired)";
        } else if (item.condition === "Broken") {
          initialStatus = "Unavailable (Broken)";
        }

        const { rows } = await sql<Equipment>`
          INSERT INTO equipment (name, description, serial_number, condition, location, status)
          VALUES (${item.name}, ${item.description ?? null}, ${item.serial_number ?? null}, ${item.condition}, ${item.location}, ${initialStatus})
          RETURNING *
        `;
        targetId = rows[0].id;
        if (cleanSerial) {
          existingBySerial.set(cleanSerial, targetId);
        }
        if (cleanName && !existingByName.has(cleanName)) {
          existingByName.set(cleanName, targetId);
        }
        createdCount++;
      }

      // Update tags
      await sql`DELETE FROM equipment_tags WHERE equipment_id = ${targetId}`;
      if (item.tags && item.tags.length > 0) {
        for (const tagName of item.tags) {
          const tClean = tagName.trim();
          if (!tClean) continue;
          const tLower = tClean.toLowerCase();
          let tagId = tagMap.get(tLower);
          if (!tagId) {
            let tagObj = (await sql<Tag>`SELECT * FROM tags WHERE LOWER(name) = LOWER(${tClean})`).rows[0];
            if (!tagObj) {
              tagObj = (await sql<Tag>`INSERT INTO tags (name) VALUES (${tClean}) RETURNING *`).rows[0];
            }
            if (tagObj) {
              tagId = tagObj.id;
              tagMap.set(tLower, tagId);
            }
          }
          if (tagId) {
            await sql`INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (${targetId}, ${tagId}) ON CONFLICT DO NOTHING`;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Error processing "${item.name}": ${msg}`);
    }
  }

  if (deleteMissingIds && deleteMissingIds.length > 0) {
    for (const id of deleteMissingIds) {
      const delResult = await deleteEquipment(id);
      if (delResult.success) {
        deletedCount++;
      } else {
        const current = existingMap.get(id);
        const label = current ? `"${current.name}" (${current.serial_number || `ID ${current.id}`})` : `Equipment ID ${id}`;
        errors.push(`Could not delete ${label}: ${delResult.error}`);
      }
    }
  }

  return { createdCount, updatedCount, deletedCount, errors };
}

export async function deleteEquipment(id: number): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid equipment ID." };
  }
  const activeCheckouts = await sql`SELECT id FROM checkouts WHERE equipment_id = ${id} AND returned_at IS NULL`;
  if (activeCheckouts.rows.length > 0) {
    return { success: false, error: "Cannot delete equipment with an active checkout." };
  }

  const activeEvents = await sql`
    SELECT ee.event_id, ev.name 
    FROM event_equipment ee 
    JOIN events ev ON ev.id = ee.event_id 
    WHERE ee.equipment_id = ${id} AND ev.end_time > CURRENT_TIMESTAMP
    LIMIT 1
  `;
  if (activeEvents.rows.length > 0) {
    return { success: false, error: `Cannot delete equipment allocated to upcoming/ongoing event "${activeEvents.rows[0].name}".` };
  }

  const { rowCount } = await sql`DELETE FROM equipment WHERE id = ${id}`;
  if (!rowCount || rowCount === 0) {
    return { success: false, error: "Equipment not found." };
  }
  return { success: true };
}

export async function getEquipmentByTagId(tagId: number): Promise<Equipment[]> {
  if (!Number.isInteger(tagId) || tagId <= 0) return [];
  await ensureSchema();
  const { rows } = await sql<EquipmentRawRow>`
    SELECT 
      e.id, e.name, e.description, e.serial_number,
      e.condition, e.location, e.status, e.created_at, e.updated_at,
      GROUP_CONCAT(DISTINCT t.name) AS tags,
      c.id AS active_checkout_id,
      c.checked_out_by_name,
      c.checked_out_at,
      c.expected_return_at,
      c.checkout_location,
      ev.id AS active_event_id,
      ev.name AS active_event_name,
      ev.location AS active_event_location,
      CASE
        WHEN ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal THEN ev.rehearsal_start_time
        ELSE ev.start_time
      END AS active_event_start_time,
      CASE
        WHEN ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal THEN ev.rehearsal_end_time
        ELSE ev.end_time
      END AS active_event_end_time,
      (ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal) AS is_rehearsal
    FROM equipment e
    INNER JOIN equipment_tags ef ON ef.equipment_id = e.id AND ef.tag_id = ${tagId}
    LEFT JOIN equipment_tags et ON et.equipment_id = e.id
    LEFT JOIN tags t ON t.id = et.tag_id
    LEFT JOIN checkouts c ON c.equipment_id = e.id AND c.returned_at IS NULL
    LEFT JOIN event_equipment ee ON ee.equipment_id = e.id
    LEFT JOIN events ev ON ev.id = ee.event_id AND (
      (CURRENT_TIMESTAMP >= ev.start_time AND CURRENT_TIMESTAMP <= ev.end_time) OR
      (ev.has_rehearsal AND CURRENT_TIMESTAMP >= ev.rehearsal_start_time AND CURRENT_TIMESTAMP <= ev.rehearsal_end_time AND ee.used_for_rehearsal)
    )
    GROUP BY e.id, c.id, c.checked_out_by_name, c.checked_out_at, c.expected_return_at, c.checkout_location, ev.id, ev.name, ev.location, ev.start_time, ev.end_time, ev.has_rehearsal, ev.rehearsal_start_time, ev.rehearsal_end_time, ee.used_for_rehearsal
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
  nfc_value?: string;
  nfc_id?: string;
}): Promise<Checkout> {
  if (!Number.isInteger(params.equipment_id) || params.equipment_id <= 0) {
    throw new Error("Invalid equipment ID");
  }
  await ensureSchema();
  const eqRes = await sql<{ id: number; status: EquipmentStatus }>`
    SELECT id, status FROM equipment WHERE id = ${params.equipment_id}
  `;
  if (eqRes.rows.length === 0) {
    throw new Error("Equipment not found.");
  }
  if (eqRes.rows[0].status?.toLowerCase() !== "available") {
    throw new Error(`Equipment is not available for checkout (current status: ${eqRes.rows[0].status}).`);
  }

  const active = await sql`SELECT id FROM checkouts WHERE equipment_id = ${params.equipment_id} AND returned_at IS NULL`;
  if (active.rows.length > 0) {
    throw new Error("Equipment is already checked out.");
  }

  const val = params.nfc_value ?? params.nfc_id ?? null;
  const { rows } = await sql<Checkout>`
    INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, expected_return_at, notes, checkout_location, nfc_value, nfc_id)
    VALUES (${params.equipment_id}, ${params.checked_out_by ?? null}, ${params.checked_out_by_name}, ${params.expected_return_at ?? null}, ${params.notes ?? null}, ${params.checkout_location ?? null}, ${val}, ${val})
    RETURNING *
  `;

  await sql`UPDATE equipment SET status = 'Checked Out', updated_at = CURRENT_TIMESTAMP WHERE id = ${params.equipment_id}`;
  return rows[0];
}

export async function returnCheckout(equipment_id: number): Promise<Checkout> {
  if (!Number.isInteger(equipment_id) || equipment_id <= 0) {
    throw new Error("Invalid equipment ID");
  }
  await ensureSchema();
  const active = await sql<Checkout>`SELECT * FROM checkouts WHERE equipment_id = ${equipment_id} AND returned_at IS NULL`;
  if (active.rows.length === 0) {
    throw new Error("No active checkout found for this equipment.");
  }

  const checkoutId = active.rows[0].id;
  const { rows } = await sql<Checkout>`
    UPDATE checkouts SET returned_at = CURRENT_TIMESTAMP WHERE id = ${checkoutId} RETURNING *
  `;

  const eqRes = await sql<{ condition: Condition }>`SELECT condition FROM equipment WHERE id = ${equipment_id}`;
  const cond = eqRes.rows[0]?.condition;
  let returnedStatus: EquipmentStatus = "Available";
  if (cond === "Retired") {
    returnedStatus = "Unavailable (Retired)";
  } else if (cond === "Broken") {
    returnedStatus = "Unavailable (Broken)";
  } else if (cond === "Missing") {
    returnedStatus = "Unavailable (Missing)";
  }

  await sql`UPDATE equipment SET status = ${returnedStatus}, updated_at = CURRENT_TIMESTAMP WHERE id = ${equipment_id}`;
  return rows[0];
}

export async function getNfcMemberData(nfcValue: string): Promise<NFCMemberData | null> {
  await ensureSchema();
  const trimmed = nfcValue.trim();
  if (!trimmed) return null;

  const card = await getNfcCardByValue(trimmed);
  if (!card) return null;

  const { rows: activeCheckouts } = await sql<NFCCheckoutItem>`
    SELECT 
      c.id,
      c.equipment_id,
      c.checked_out_by,
      c.checked_out_by_name,
      c.checked_out_at,
      c.expected_return_at,
      c.returned_at,
      c.notes,
      c.checkout_location,
      c.nfc_value,
      c.nfc_id,
      e.name AS equipment_name,
      e.serial_number AS equipment_serial_number,
      e.location AS equipment_location
    FROM checkouts c
    JOIN equipment e ON e.id = c.equipment_id
    WHERE (LOWER(c.nfc_value) = LOWER(${trimmed}) OR LOWER(c.nfc_id) = LOWER(${trimmed}))
      AND c.returned_at IS NULL
    ORDER BY c.checked_out_at DESC
  `;

  const { rows: history } = await sql<NFCCheckoutItem>`
    SELECT 
      c.id,
      c.equipment_id,
      c.checked_out_by,
      c.checked_out_by_name,
      c.checked_out_at,
      c.expected_return_at,
      c.returned_at,
      c.notes,
      c.checkout_location,
      c.nfc_value,
      c.nfc_id,
      e.name AS equipment_name,
      e.serial_number AS equipment_serial_number,
      e.location AS equipment_location
    FROM checkouts c
    JOIN equipment e ON e.id = c.equipment_id
    WHERE (LOWER(c.nfc_value) = LOWER(${trimmed}) OR LOWER(c.nfc_id) = LOWER(${trimmed}))
    ORDER BY c.checked_out_at DESC
    LIMIT 100
  `;

  return {
    card,
    activeCheckouts,
    history,
  };
}

export async function nfcCheckout(params: {
  equipmentId: number;
  nfcValue?: string;
  nfcId?: string;
  notes?: string;
  checkout_location?: string;
}): Promise<Checkout> {
  await ensureSchema();
  const raw = params.nfcValue ?? params.nfcId ?? "";
  const trimmed = raw.trim();
  const card = await getNfcCardByValue(trimmed);
  if (!card) {
    throw new Error("NFC card not found in database.");
  }

  return await createCheckout({
    equipment_id: params.equipmentId,
    checked_out_by: null,
    checked_out_by_name: card.member_name,
    notes: params.notes || "Checked out via NFC Station",
    checkout_location: params.checkout_location,
    nfc_value: trimmed,
    nfc_id: trimmed,
  });
}

export async function nfcReturn(equipmentId: number): Promise<Checkout> {
  return await returnCheckout(equipmentId);
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

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function computeEventStatus(startTime: string, endTime: string): EventStatus {
  const now = new Date();
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (now < start) return "Upcoming";
  if (now >= start && now <= end) return "Ongoing";
  return "Completed";
}

export async function getAllEvents(): Promise<AppEvent[]> {
  await ensureSchema();
  const { rows: eventRows } = await sql<Omit<AppEvent, "oics" | "section_ics" | "section_equipment" | "section_deployments" | "section_rehearsals" | "status" | "ics" | "equipment">>`
    SELECT id, name, description, start_time, end_time, location, created_by, has_rehearsal, rehearsal_start_time, rehearsal_end_time, created_at, updated_at
    FROM events
    ORDER BY start_time DESC
  `;

  const events: AppEvent[] = [];

  for (const ev of eventRows) {
    const full = await getEventById(ev.id);
    if (full) events.push(full);
  }

  return events;
}

export async function getEventById(id: number): Promise<AppEvent | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  await ensureSchema();
  const { rows } = await sql<Omit<AppEvent, "oics" | "section_ics" | "section_equipment" | "section_deployments" | "section_rehearsals" | "status" | "ics" | "equipment">>`
    SELECT id, name, description, start_time, end_time, location, created_by, has_rehearsal, rehearsal_start_time, rehearsal_end_time, created_at, updated_at
    FROM events
    WHERE id = ${id}
  `;

  if (rows.length === 0) return undefined;
  const ev = rows[0];

  // Fetch OICs
  const { rows: oics } = await sql<User>`
    SELECT u.id, u.name, u.email, u.username, u.google_id, u.image, u.role, u.provider, u.created_at
    FROM users u
    JOIN event_oics eo ON eo.user_id = u.id
    WHERE eo.event_id = ${id}
    ORDER BY u.name ASC
  `;

  // Fetch Section ICs
  const section_ics: SectionICMap = { photo: [], video: [], av: [] };
  const { rows: icRows } = await sql<User & { section: EventSection }>`
    SELECT u.id, u.name, u.email, u.username, u.google_id, u.image, u.role, u.provider, u.created_at, ei.section
    FROM users u
    JOIN event_ics ei ON ei.user_id = u.id
    WHERE ei.event_id = ${id}
    ORDER BY u.name ASC
  `;
  for (const ic of icRows) {
    if (section_ics[ic.section]) {
      section_ics[ic.section].push(ic);
    }
  }

  // Fetch Section Equipment
  const section_equipment: SectionEquipmentMap = { photo: [], video: [], av: [] };
  const { rows: eqRows } = await sql<EquipmentRawRow & { section: EventSection; used_for_rehearsal: boolean }>`
    SELECT 
      e.id, e.name, e.description, e.serial_number,
      e.condition, e.location, e.status, e.created_at, e.updated_at,
      ee.section, ee.used_for_rehearsal,
      GROUP_CONCAT(DISTINCT t.name) AS tags
    FROM equipment e
    JOIN event_equipment ee ON ee.equipment_id = e.id
    LEFT JOIN equipment_tags et ON et.equipment_id = e.id
    LEFT JOIN tags t ON t.id = et.tag_id
    WHERE ee.event_id = ${id}
    GROUP BY e.id, ee.section, ee.used_for_rehearsal
    ORDER BY e.name ASC
  `;
  for (const item of eqRows) {
    const formatted = formatEquipmentRow(item) as SectionEquipmentItem;
    formatted.used_for_rehearsal = Boolean(item.used_for_rehearsal);
    if (section_equipment[item.section]) {
      section_equipment[item.section].push(formatted);
    }
  }

  // Fetch Section Deployments
  const section_deployments: SectionDeploymentMap = { photo: [], video: [], av: [] };
  const { rows: depRows } = await sql<
    User & {
      section: EventSection;
      attending_rehearsal: boolean;
      response_status?: DeploymentResponseStatus;
      response_token?: string;
      responded_at?: string | null;
    }
  >`
    SELECT 
      u.id, u.name, u.email, u.username, u.google_id, u.image, u.role, u.provider, u.created_at, 
      ed.section, ed.attending_rehearsal, ed.response_status, ed.response_token, ed.responded_at
    FROM users u
    JOIN event_deployments ed ON ed.user_id = u.id
    WHERE ed.event_id = ${id}
    ORDER BY u.name ASC
  `;
  for (const dep of depRows) {
    const item: SectionDeploymentItem = {
      ...dep,
      attending_rehearsal: Boolean(dep.attending_rehearsal),
      response_status: dep.response_status || "pending",
      response_token: dep.response_token || undefined,
      responded_at: dep.responded_at || null,
    };
    if (section_deployments[dep.section]) {
      section_deployments[dep.section].push(item);
    }
  }

  // Fetch Section Rehearsals config
  const section_rehearsals: SectionRehearsalMap = {
    photo: { participating: false },
    video: { participating: false },
    av: { participating: false },
  };
  const { rows: rehRows } = await sql<{ section: EventSection; participating: boolean }>`
    SELECT section, participating FROM event_section_rehearsals WHERE event_id = ${id}
  `;
  for (const reh of rehRows) {
    if (section_rehearsals[reh.section]) {
      section_rehearsals[reh.section].participating = Boolean(reh.participating);
    }
  }

  return {
    ...ev,
    oics,
    section_ics,
    section_equipment,
    section_deployments,
    section_rehearsals,
    status: computeEventStatus(ev.start_time, ev.end_time),
  };
}

export async function createEvent(params: {
  name: string;
  description?: string;
  start_time: string;
  end_time: string;
  location: string;
  created_by: number | null;
  has_rehearsal?: boolean;
  rehearsal_start_time?: string;
  rehearsal_end_time?: string;
  oic_user_ids?: number[];
  photo_ic_ids?: number[];
  video_ic_ids?: number[];
  av_ic_ids?: number[];
}): Promise<AppEvent> {
  await ensureSchema();
  const { rows } = await sql<AppEvent>`
    INSERT INTO events (name, description, start_time, end_time, location, created_by, has_rehearsal, rehearsal_start_time, rehearsal_end_time)
    VALUES (${params.name}, ${params.description ?? null}, ${params.start_time}, ${params.end_time}, ${params.location}, ${params.created_by}, ${params.has_rehearsal ?? false}, ${params.rehearsal_start_time ?? null}, ${params.rehearsal_end_time ?? null})
    RETURNING *
  `;

  const newId = rows[0].id;

  if (params.oic_user_ids) {
    for (const uid of params.oic_user_ids) {
      await sql`INSERT INTO event_oics (event_id, user_id) VALUES (${newId}, ${uid}) ON CONFLICT DO NOTHING`;
    }
  }

  const sectionMap: Record<EventSection, number[] | undefined> = {
    photo: params.photo_ic_ids,
    video: params.video_ic_ids,
    av: params.av_ic_ids,
  };

  for (const sec of ["photo", "video", "av"] as EventSection[]) {
    const ids = sectionMap[sec];
    if (ids) {
      for (const uid of ids) {
        await sql`INSERT INTO event_ics (event_id, user_id, section) VALUES (${newId}, ${uid}, ${sec}) ON CONFLICT DO NOTHING`;
      }
    }
    await sql`INSERT INTO event_section_rehearsals (event_id, section, participating) VALUES (${newId}, ${sec}, FALSE) ON CONFLICT DO NOTHING`;
  }

  return (await getEventById(newId))!;
}

export async function updateEvent(
  id: number,
  params: Partial<{
    name: string;
    description: string;
    start_time: string;
    end_time: string;
    location: string;
    has_rehearsal: boolean;
    rehearsal_start_time: string | null;
    rehearsal_end_time: string | null;
    oic_user_ids: number[];
    photo_ic_ids: number[];
    video_ic_ids: number[];
    av_ic_ids: number[];
  }>
): Promise<AppEvent | undefined> {
  await ensureSchema();
  const existing = await getEventById(id);
  if (!existing) return undefined;

  const { oic_user_ids, photo_ic_ids, video_ic_ids, av_ic_ids, ...scalars } = params;

  if (Object.keys(scalars).length > 0) {
    if (scalars.name !== undefined) await sql`UPDATE events SET name = ${scalars.name} WHERE id = ${id}`;
    if (scalars.description !== undefined) await sql`UPDATE events SET description = ${scalars.description} WHERE id = ${id}`;
    if (scalars.start_time !== undefined) await sql`UPDATE events SET start_time = ${scalars.start_time} WHERE id = ${id}`;
    if (scalars.end_time !== undefined) await sql`UPDATE events SET end_time = ${scalars.end_time} WHERE id = ${id}`;
    if (scalars.location !== undefined) await sql`UPDATE events SET location = ${scalars.location} WHERE id = ${id}`;
    if (scalars.has_rehearsal !== undefined) await sql`UPDATE events SET has_rehearsal = ${scalars.has_rehearsal} WHERE id = ${id}`;
    if (scalars.rehearsal_start_time !== undefined) await sql`UPDATE events SET rehearsal_start_time = ${scalars.rehearsal_start_time} WHERE id = ${id}`;
    if (scalars.rehearsal_end_time !== undefined) await sql`UPDATE events SET rehearsal_end_time = ${scalars.rehearsal_end_time} WHERE id = ${id}`;
    await sql`UPDATE events SET updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }

  if (oic_user_ids !== undefined) {
    await sql`DELETE FROM event_oics WHERE event_id = ${id}`;
    for (const uid of oic_user_ids) {
      await sql`INSERT INTO event_oics (event_id, user_id) VALUES (${id}, ${uid}) ON CONFLICT DO NOTHING`;
    }
  }

  const sectionMap: Record<EventSection, number[] | undefined> = {
    photo: photo_ic_ids,
    video: video_ic_ids,
    av: av_ic_ids,
  };

  for (const sec of ["photo", "video", "av"] as EventSection[]) {
    const ids = sectionMap[sec];
    if (ids !== undefined) {
      await sql`DELETE FROM event_ics WHERE event_id = ${id} AND section = ${sec}`;
      for (const uid of ids) {
        await sql`INSERT INTO event_ics (event_id, user_id, section) VALUES (${id}, ${uid}, ${sec}) ON CONFLICT DO NOTHING`;
      }
    }
  }

  return getEventById(id);
}

export async function deleteEvent(id: number): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid event ID." };
  }
  const { rowCount } = await sql`DELETE FROM events WHERE id = ${id}`;
  if (!rowCount || rowCount === 0) {
    return { success: false, error: "Event not found." };
  }
  return { success: true };
}

export async function attachEquipmentToEventSection(
  eventId: number,
  equipmentId: number,
  section: EventSection,
  usedForRehearsal = false,
  addedBy: number | null = null
): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  await sql`DELETE FROM event_equipment WHERE event_id = ${eventId} AND equipment_id = ${equipmentId} AND section = ${section}`;
  await sql`
    INSERT INTO event_equipment (event_id, equipment_id, section, used_for_rehearsal, added_by)
    VALUES (${eventId}, ${equipmentId}, ${section}, ${usedForRehearsal}, ${addedBy})
  `;
  return { success: true };
}

export async function detachEquipmentFromEventSection(
  eventId: number,
  equipmentId: number,
  section: EventSection
): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  await sql`DELETE FROM event_equipment WHERE event_id = ${eventId} AND equipment_id = ${equipmentId} AND section = ${section}`;
  return { success: true };
}

export async function addDeploymentToEventSection(
  eventId: number,
  userId: number,
  section: EventSection,
  attendingRehearsal = false,
  addedBy: number | null = null
): Promise<{ success: boolean; token: string; error?: string }> {
  await ensureSchema();
  const token = crypto.randomUUID();
  await sql`DELETE FROM event_deployments WHERE event_id = ${eventId} AND user_id = ${userId} AND section = ${section}`;
  await sql`
    INSERT INTO event_deployments (event_id, user_id, section, attending_rehearsal, added_by, response_status, response_token)
    VALUES (${eventId}, ${userId}, ${section}, ${attendingRehearsal}, ${addedBy}, 'pending', ${token})
  `;
  return { success: true, token };
}

export interface DeploymentTokenDetails {
  event: AppEvent;
  user: User;
  section: EventSection;
  attending_rehearsal: boolean;
  response_status: DeploymentResponseStatus;
  response_token: string;
  responded_at: string | null;
}

export async function getDeploymentByToken(token: string): Promise<DeploymentTokenDetails | null> {
  await ensureSchema();
  const { rows } = await sql<{
    event_id: number;
    user_id: number;
    section: EventSection;
    attending_rehearsal: boolean;
    response_status: DeploymentResponseStatus;
    response_token: string;
    responded_at: string | null;
  }>`
    SELECT event_id, user_id, section, attending_rehearsal, response_status, response_token, responded_at
    FROM event_deployments
    WHERE response_token = ${token}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const dep = rows[0];
  const event = await getEventById(dep.event_id);
  const user = await getUserById(dep.user_id);
  if (!event || !user) return null;

  return {
    event,
    user,
    section: dep.section,
    attending_rehearsal: Boolean(dep.attending_rehearsal),
    response_status: dep.response_status || "pending",
    response_token: dep.response_token,
    responded_at: dep.responded_at,
  };
}

export async function updateDeploymentRSVP(
  token: string,
  status: "confirmed" | "declined"
): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  const { rowCount } = await sql`
    UPDATE event_deployments
    SET 
      response_status = ${status},
      responded_at = CURRENT_TIMESTAMP
    WHERE response_token = ${token}
  `;
  if (!rowCount || rowCount === 0) {
    return { success: false, error: "Invalid or expired invitation link" };
  }
  return { success: true };
}

export async function resendDeploymentEmail(
  eventId: number,
  userId: number,
  section: EventSection,
  origin?: string
): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  const event = await getEventById(eventId);
  const user = await getUserById(userId);
  if (!event || !user) return { success: false, error: "Event or User not found" };

  const depItem = event.section_deployments[section]?.find((d) => d.id === userId);
  if (!depItem) return { success: false, error: "Deployment record not found" };

  let token = depItem.response_token;
  if (!token) {
    token = crypto.randomUUID();
    await sql`
      UPDATE event_deployments
      SET response_token = ${token}
      WHERE event_id = ${eventId} AND user_id = ${userId} AND section = ${section}
    `;
  }

  const rehConfig = event.section_rehearsals[section];

  return sendDeploymentInvitationEmail({
    toEmail: user.email,
    recipientName: user.name,
    eventName: event.name,
    eventDescription: event.description,
    section,
    startTime: event.start_time,
    endTime: event.end_time,
    location: event.location,
    hasRehearsal: event.has_rehearsal && rehConfig?.participating,
    rehearsalStartTime: event.rehearsal_start_time,
    rehearsalEndTime: event.rehearsal_end_time,
    attendingRehearsal: depItem.attending_rehearsal,
    token,
    origin,
  });
}

export async function removeDeploymentFromEventSection(
  eventId: number,
  userId: number,
  section: EventSection
): Promise<{ success: boolean; error?: string }> {
  await ensureSchema();
  await sql`DELETE FROM event_deployments WHERE event_id = ${eventId} AND user_id = ${userId} AND section = ${section}`;
  return { success: true };
}

export async function updateSectionRehearsalConfig(
  eventId: number,
  section: EventSection,
  participating: boolean,
  rehearsalEquipmentIds?: number[],
  rehearsalUserIds?: number[]
): Promise<{ success: boolean }> {
  await ensureSchema();
  await sql`
    INSERT INTO event_section_rehearsals (event_id, section, participating)
    VALUES (${eventId}, ${section}, ${participating})
    ON CONFLICT (event_id, section) DO UPDATE SET participating = EXCLUDED.participating
  `;

  if (rehearsalEquipmentIds !== undefined) {
    await sql`
      UPDATE event_equipment
      SET used_for_rehearsal = FALSE
      WHERE event_id = ${eventId} AND section = ${section}
    `;
    for (const eqId of rehearsalEquipmentIds) {
      await sql`
        UPDATE event_equipment
        SET used_for_rehearsal = TRUE
        WHERE event_id = ${eventId} AND equipment_id = ${eqId} AND section = ${section}
      `;
    }
  }

  if (rehearsalUserIds !== undefined) {
    await sql`
      UPDATE event_deployments
      SET attending_rehearsal = FALSE
      WHERE event_id = ${eventId} AND section = ${section}
    `;
    for (const uId of rehearsalUserIds) {
      await sql`
        UPDATE event_deployments
        SET attending_rehearsal = TRUE
        WHERE event_id = ${eventId} AND user_id = ${uId} AND section = ${section}
      `;
    }
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// SOP Document Helpers
// ---------------------------------------------------------------------------

async function ensureSOPTable(): Promise<void> {
  await ensureSchema();
}

export async function getAllSOPDocuments(): Promise<SOPDocument[]> {
  await ensureSOPTable();
  const { rows } = await sql<SOPDocument>`
    SELECT 
      s.id,
      s.title,
      s.category,
      s.content,
      s.file_name,
      s.file_type,
      s.file_size,
      s.uploaded_by,
      u.name AS uploaded_by_name,
      s.created_at,
      s.updated_at
    FROM sop_documents s
    LEFT JOIN users u ON u.id = s.uploaded_by
    ORDER BY s.updated_at DESC
  `;
  return rows;
}

export async function getSOPDocumentById(id: number): Promise<SOPDocument | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  await ensureSOPTable();
  const { rows } = await sql<SOPDocument>`
    SELECT 
      s.id,
      s.title,
      s.category,
      s.content,
      s.file_name,
      s.file_type,
      s.file_size,
      s.uploaded_by,
      u.name AS uploaded_by_name,
      s.created_at,
      s.updated_at
    FROM sop_documents s
    LEFT JOIN users u ON u.id = s.uploaded_by
    WHERE s.id = ${id}
  `;
  return rows[0];
}

export async function createSOPDocument(params: {
  title: string;
  category?: string;
  content: string;
  file_name?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  uploaded_by?: number | null;
}): Promise<SOPDocument> {
  await ensureSOPTable();
  const category = params.category?.trim() || "General";

  let validUserId: number | null = null;
  if (params.uploaded_by) {
    try {
      const userExists = await getUserById(params.uploaded_by);
      if (userExists) validUserId = params.uploaded_by;
    } catch {
      validUserId = null;
    }
  }

  const { rows } = await sql<SOPDocument>`
    INSERT INTO sop_documents (
      title,
      category,
      content,
      file_name,
      file_type,
      file_size,
      uploaded_by
    )
    VALUES (
      ${params.title},
      ${category},
      ${params.content},
      ${params.file_name ?? null},
      ${params.file_type ?? null},
      ${params.file_size ?? null},
      ${validUserId}
    )
    RETURNING *
  `;
  return rows[0];
}

export async function updateSOPDocument(
  id: number,
  params: {
    title?: string;
    category?: string;
    content?: string;
    file_name?: string | null;
    file_type?: string | null;
    file_size?: number | null;
  }
): Promise<SOPDocument | undefined> {
  await ensureSOPTable();
  const existing = await getSOPDocumentById(id);
  if (!existing) return undefined;

  const title = params.title ?? existing.title;
  const category = params.category ?? existing.category;
  const content = params.content ?? existing.content;
  const file_name = params.file_name !== undefined ? params.file_name : existing.file_name;
  const file_type = params.file_type !== undefined ? params.file_type : existing.file_type;
  const file_size = params.file_size !== undefined ? params.file_size : existing.file_size;

  const { rows } = await sql<SOPDocument>`
    UPDATE sop_documents
    SET 
      title = ${title},
      category = ${category},
      content = ${content},
      file_name = ${file_name},
      file_type = ${file_type},
      file_size = ${file_size},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0];
}

export async function deleteSOPDocument(id: number): Promise<{ success: boolean; error?: string }> {
  await ensureSOPTable();
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, error: "Invalid document ID." };
  }
  const { rowCount } = await sql`DELETE FROM sop_documents WHERE id = ${id}`;
  if (!rowCount || rowCount === 0) {
    return { success: false, error: "SOP Document not found." };
  }
  return { success: true };
}

export async function searchSOPDocuments(rawQuery: string): Promise<SOPDocument[]> {
  await ensureSOPTable();
  const query = (rawQuery || "").trim().slice(0, 200);
  if (!query) {
    return getAllSOPDocuments();
  }
  const escaped = query.replace(/[%_\\]/g, "\\$&");
  const pattern = `%${escaped}%`;
  const { rows } = await sql<SOPDocument>`
    SELECT 
      s.id,
      s.title,
      s.category,
      s.content,
      s.file_name,
      s.file_type,
      s.file_size,
      s.uploaded_by,
      u.name AS uploaded_by_name,
      s.created_at,
      s.updated_at
    FROM sop_documents s
    LEFT JOIN users u ON u.id = s.uploaded_by
    WHERE s.title LIKE ${pattern} OR s.content LIKE ${pattern} OR s.category LIKE ${pattern}
    ORDER BY s.updated_at DESC
  `;
  return rows;
}
