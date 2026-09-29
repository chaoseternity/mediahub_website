import { sql, ensureSchema, batch, stmt, rawStmt, query, type BoundStatement } from "./d1";
import { formatLongDateTime, parseDbDate, parseDueDate } from "./timezone";
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
  SectionEquipmentItem,
  SectionDeploymentItem,
  EventMember,
  SOPDocument,
  DeploymentResponseStatus,
  NFCCard,
  NFCMemberData,
  NFCCheckoutItem,
  UserProfileData,
  UserProfileEvent,
  UserProfileCheckout,
  UserProfileRole,
  ReminderType,
  CheckoutReminder,
  ReminderProcessResult,
  Reservation,
  ReservationStatus,
  ReservationConflictCheck,
  HandoverCode,
  HandoverStatus,
  AuditSession,
  AuditSessionStatus,
  AuditRecord,
  AuditRecordStatus,
  StorageCabinet,
  StorageShelf,
  StorageMapConfigCabinet,
} from "./types";
import { sendDeploymentInvitationEmail, sendOverdueReminderEmail } from "./email";
import { sendClubWebhook } from "./webhook";

function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
}

/** True if the email is listed in ADMIN_EMAILS (such accounts are re-promoted on every login). */
export function isConfiguredAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().has(email.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Error types (route handlers can map these to 4xx responses)
// ---------------------------------------------------------------------------

/** updateUsername: the username is invalid or already used (as a username or display name). */
export class UsernameTakenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsernameTakenError";
  }
}

/** updateUserRole: the target account is listed in ADMIN_EMAILS and cannot be demoted. */
export class ConfiguredAdminError extends Error {
  constructor(message = "This account is a configured administrator (ADMIN_EMAILS) and can't be demoted here.") {
    super(message);
    this.name = "ConfiguredAdminError";
  }
}

/** createReservation: the request is invalid (bad times, unavailable equipment, bad notes...). */
export class ReservationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservationValidationError";
  }
}

/** saveStorageMapConfig: the cabinets configuration is malformed. */
export class StorageMapConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageMapConfigError";
  }
}

/** createTag / tag normalisation: the tag name is empty or too long. */
export class InvalidTagNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTagNameError";
  }
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
  if (!trimmed) return undefined;
  // Username only: display names are not unique and can be copied by anyone, so matching them
  // here would let one user resolve to (and view) another user's profile.
  const { rows } = await sql<User>`
    SELECT * FROM users
    WHERE LOWER(username) = LOWER(${trimmed})
    ORDER BY id ASC
    LIMIT 1
  `;
  return rows[0];
}

export async function getUserProfileData(userId: number): Promise<UserProfileData | undefined> {
  if (!Number.isInteger(userId) || userId <= 0) return undefined;
  await ensureSchema();

  const user = await getUserById(userId);
  if (!user) return undefined;

  // 1. Fetch checkouts made under this user's account. Matching by checked_out_by_name is
  // deliberately NOT done: names are not unique (and usernames can be set to anyone's name), so
  // it would expose other people's history. NFC-station checkouts have no user link (nfc_cards
  // has no user column), so they are not attributed to accounts.
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
    ORDER BY julianday(c.checked_out_at) DESC, c.id DESC
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
    // Compare as instants, not strings (stored times may be ISO or "YYYY-MM-DD HH:MM:SS").
    const now = Date.now();
    if (now < new Date(start).getTime()) return "Upcoming";
    if (now > new Date(end).getTime()) return "Completed";
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

  // 3. Linked NFC card: nfc_cards has no user_id column, so there is no explicit card <-> account
  // link. Guessing by member_name would attach someone else's card, so none is reported.
  const nfcCard: NFCCard | null = null;

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
  role?: Role;
}): Promise<User> {
  await ensureSchema();
  const normalizedEmail = params.email.trim().toLowerCase();
  const existing = await getUserByEmail(normalizedEmail);
  const adminEmails = getAdminEmails();
  const isAdminEmail = adminEmails.has(normalizedEmail);

  if (existing) {
    const newRole = params.role ?? (isAdminEmail && existing.role !== "admin" ? "admin" : existing.role);
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

  // Admins come only from ADMIN_EMAILS or scripts/set-role.ts. (The first account to sign in is
  // NOT made admin: on a fresh deployment that would hand the site to whoever logs in first.)
  const role: Role = params.role ?? (isAdminEmail ? "admin" : "viewer");

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
  if (role !== "admin" && isConfiguredAdminEmail(user.email)) {
    // upsertUser re-promotes ADMIN_EMAILS accounts on every login, so a demotion here would
    // silently revert. Remove the address from ADMIN_EMAILS instead.
    throw new ConfiguredAdminError();
  }
  if (user.role === "admin" && role !== "admin") {
    // Conditional UPDATE so two concurrent demotions can't remove the last two admins.
    const { rowCount } = await sql`
      UPDATE users SET role = ${role}
      WHERE id = ${id}
        AND (SELECT COUNT(*) FROM users WHERE role = 'admin' AND id <> ${id}) >= 1
    `;
    if (rowCount === 0) {
      return { success: false, error: "Cannot demote the only remaining admin account." };
    }
    return { success: true };
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
  // reservations.reserved_by still cascades on user delete. Announce the cancellation of any
  // upcoming confirmed reservations (after the delete commits) so the freed slots don't silently
  // disappear.
  const { rows: futureReservations } = await sql<{ id: number; equipment_name: string | null; reserved_by_name: string }>`
    SELECT r.id, e.name AS equipment_name, r.reserved_by_name
    FROM reservations r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.reserved_by = ${id}
      AND r.status = 'confirmed'
      AND julianday(r.end_time) > julianday('now')
  `;

  // All writes are applied atomically: checkout history is detached (checked_out_by_name keeps
  // the borrower's name), audit sessions get a name snapshot (started_by is ON DELETE SET NULL
  // since migration 0005), reservations are cancelled, then the user row is deleted. If a
  // checkout was opened concurrently, the DELETE fails on the checkouts FK and nothing changes.
  const buildStatements = (withAuditSnapshot: boolean): BoundStatement[] => [
    stmt`UPDATE checkouts SET checked_out_by = NULL WHERE checked_out_by = ${id} AND returned_at IS NOT NULL`,
    ...(withAuditSnapshot
      ? [
          stmt`
            UPDATE audit_sessions SET started_by_name = ${user.name}
            WHERE started_by = ${id} AND (started_by_name IS NULL OR started_by_name = '')
          `,
        ]
      : []),
    stmt`
      UPDATE reservations SET status = 'cancelled'
      WHERE reserved_by = ${id} AND status = 'confirmed' AND julianday(end_time) > julianday('now')
    `,
    stmt`DELETE FROM users WHERE id = ${id}`,
  ];
  try {
    try {
      await batch(buildStatements(true));
    } catch (err) {
      // Migration 0005 not applied yet (no started_by_name column): skip the snapshot.
      if (!(err instanceof Error) || !/started_by_name/i.test(err.message)) throw err;
      await batch(buildStatements(false));
    }
  } catch (err) {
    if (err instanceof Error && /FOREIGN KEY/i.test(err.message)) {
      return {
        success: false,
        error: "Cannot delete user with active equipment checkouts. Please return all equipment first.",
      };
    }
    throw err;
  }

  if (futureReservations.length > 0) {
    for (const r of futureReservations) {
      try {
        await sendClubWebhook({
          event: "reservation.cancelled",
          title: `❌ Reservation Cancelled: ${r.equipment_name || "Equipment"}`,
          description: `Reservation #${r.id} for **${r.equipment_name || "Equipment"}** by **${r.reserved_by_name}** was cancelled because the user account was deleted.`,
        });
      } catch {
        // Notification failures must not block account deletion.
      }
    }
  }

  return { success: true };
}

/** Allowed username characters (same rule as the API route schemas): letters, digits, space, _ - . */
const USERNAME_RE = /^[\p{L}\p{N}_\-. ]+$/u;
export const USERNAME_MAX_LENGTH = 50;

/**
 * Sets a user's username.
 *
 * Throws UsernameTakenError (a subclass of Error) when the username is invalid or when, compared
 * case-insensitively, it equals another user's username OR another user's display name (so
 * nobody can impersonate someone else by taking their name as a username). Throws a plain
 * Error("Invalid user ID") / Error("User not found") for a bad id.
 */
export async function updateUsername(id: number, username: string): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid user ID");
  }
  const trimmed = typeof username === "string" ? username.normalize("NFC").trim().replace(/\s+/g, " ") : "";
  if (!trimmed) {
    throw new UsernameTakenError("Username cannot be empty.");
  }
  if (trimmed.length > USERNAME_MAX_LENGTH) {
    throw new UsernameTakenError(`Username cannot exceed ${USERNAME_MAX_LENGTH} characters.`);
  }
  if (!USERNAME_RE.test(trimmed)) {
    throw new UsernameTakenError("Username may only contain letters, numbers, spaces, and _ - .");
  }
  await ensureSchema();

  // The availability check is part of the UPDATE, so two users can't claim the same name at once.
  let rowCount: number;
  try {
    ({ rowCount } = await sql`
      UPDATE users SET username = ${trimmed}
      WHERE id = ${id}
        AND NOT EXISTS (
          SELECT 1 FROM users o
          WHERE o.id <> ${id}
            AND (LOWER(o.username) = LOWER(${trimmed}) OR LOWER(TRIM(o.name)) = LOWER(${trimmed}))
        )
    `);
  } catch (err) {
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      throw new UsernameTakenError(`The username "${trimmed}" is already taken.`);
    }
    throw err;
  }
  if (rowCount === 0) {
    const exists = await sql`SELECT 1 FROM users WHERE id = ${id}`;
    if (exists.rows.length === 0) throw new Error("User not found");
    throw new UsernameTakenError(`The username "${trimmed}" is already taken.`);
  }
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

type EquipmentRawRow = Omit<Equipment, "tags" | "is_rehearsal"> & {
  tags: string[] | string | null;
  is_rehearsal?: boolean | number | null;
};

function formatEquipmentRow(row: EquipmentRawRow): Equipment {
  let tags: string[] = [];
  if (Array.isArray(row.tags)) {
    tags = row.tags.filter(Boolean);
  } else if (typeof row.tags === "string") {
    tags = row.tags.split(",").map((t) => t.trim()).filter(Boolean);
  }

  const { is_rehearsal, ...rest } = row;
  const formatted: Equipment = {
    ...rest,
    tags,
  };
  // SQLite returns 0/1; normalise to a real boolean (only when the query selected it).
  if (is_rehearsal !== undefined) {
    formatted.is_rehearsal = Boolean(is_rehearsal);
  }

  if (formatted.active_event_id && (formatted.status === "Available" || formatted.status === "Checked Out")) {
    formatted.status = formatted.is_rehearsal ? "In Event (Rehearsal)" : "In Event";
  }

  return formatted;
}

/** SQL: "now" falls inside the event's main window. */
const EV_MAIN_ACTIVE = (ev: string) =>
  `(julianday('now') >= julianday(${ev}.start_time) AND julianday('now') <= julianday(${ev}.end_time))`;
/** SQL: "now" falls inside the event's rehearsal window (has_rehearsal set). */
const EV_REHEARSAL_ACTIVE = (ev: string) =>
  `(${ev}.has_rehearsal AND julianday('now') >= julianday(${ev}.rehearsal_start_time) AND julianday('now') <= julianday(${ev}.rehearsal_end_time))`;

/** SQL: some section of event `ev` uses equipment `e` for the rehearsal. */
const EV_USED_FOR_REHEARSAL =
  "EXISTS (SELECT 1 FROM event_equipment eer WHERE eer.event_id = ev.id AND eer.equipment_id = e.id AND eer.used_for_rehearsal)";

/**
 * One row per equipment item. Tags come from a correlated GROUP_CONCAT, the open checkout is
 * the single most recent open one, and at most one active event is chosen per item: among the
 * events whose main window is now, or whose rehearsal window is now and the item is used for
 * rehearsal in some section, the one that ends first (rehearsal end for a rehearsal match) wins,
 * with a rehearsal match preferred on ties. is_rehearsal is true when the chosen event's
 * rehearsal is running and any of the item's sections for that event is used for rehearsal.
 *
 * Append WHERE / ORDER BY clauses; alias `e` is the equipment row.
 */
const EQUIPMENT_SELECT_SQL = `
  SELECT
    e.id, e.name, e.description, e.serial_number,
    e.condition, e.location, e.status, e.created_at, e.updated_at,
    (SELECT GROUP_CONCAT(t.name) FROM equipment_tags et JOIN tags t ON t.id = et.tag_id WHERE et.equipment_id = e.id) AS tags,
    c.id AS active_checkout_id,
    c.checked_out_by,
    c.checked_out_by_name,
    c.checked_out_at,
    c.expected_return_at,
    c.checkout_location,
    ev.id AS active_event_id,
    ev.name AS active_event_name,
    ev.location AS active_event_location,
    CASE WHEN ${EV_REHEARSAL_ACTIVE("ev")} AND ${EV_USED_FOR_REHEARSAL} THEN ev.rehearsal_start_time ELSE ev.start_time END AS active_event_start_time,
    CASE WHEN ${EV_REHEARSAL_ACTIVE("ev")} AND ${EV_USED_FOR_REHEARSAL} THEN ev.rehearsal_end_time ELSE ev.end_time END AS active_event_end_time,
    CASE WHEN ev.id IS NULL THEN 0 WHEN ${EV_REHEARSAL_ACTIVE("ev")} AND ${EV_USED_FOR_REHEARSAL} THEN 1 ELSE 0 END AS is_rehearsal
  FROM equipment e
  LEFT JOIN checkouts c ON c.id = (
    SELECT c2.id FROM checkouts c2
    WHERE c2.equipment_id = e.id AND c2.returned_at IS NULL
    ORDER BY julianday(c2.checked_out_at) DESC, c2.id DESC
    LIMIT 1
  )
  LEFT JOIN events ev ON ev.id = (
    SELECT ev2.id
    FROM event_equipment ee2
    JOIN events ev2 ON ev2.id = ee2.event_id
    WHERE ee2.equipment_id = e.id
      AND (${EV_MAIN_ACTIVE("ev2")} OR (${EV_REHEARSAL_ACTIVE("ev2")} AND ee2.used_for_rehearsal))
    ORDER BY
      julianday(CASE WHEN ${EV_REHEARSAL_ACTIVE("ev2")} AND ee2.used_for_rehearsal THEN ev2.rehearsal_end_time ELSE ev2.end_time END) ASC,
      (CASE WHEN ${EV_REHEARSAL_ACTIVE("ev2")} AND ee2.used_for_rehearsal THEN 1 ELSE 0 END) DESC,
      ev2.id ASC
    LIMIT 1
  )
`;

export async function getAllEquipment(): Promise<Equipment[]> {
  await ensureSchema();
  const { rows } = await query<EquipmentRawRow>(`${EQUIPMENT_SELECT_SQL} ORDER BY e.updated_at DESC, e.id DESC`);
  return rows.map(formatEquipmentRow);
}

export async function getEquipmentById(id: number): Promise<EquipmentDetail | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  await ensureSchema();
  const { rows: eqRows } = await query<EquipmentRawRow>(`${EQUIPMENT_SELECT_SQL} WHERE e.id = ?`, [id]);

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
    event_logs: event_logs.map((log) => ({ ...log, is_rehearsal: Boolean(log.is_rehearsal) })),
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
  let status = params.status || "Available";
  let condition = params.condition || "Working";

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

  // Tags are resolved (found case-insensitively or created) first; the equipment row and its tag
  // links are then written atomically. Within the batch the new id is the table's MAX(id)
  // (AUTOINCREMENT ids only grow, and the batch is one transaction).
  const tagObjs = await findOrCreateTags(params.tags ?? []);
  const results = await batch<{ id: number }>([
    stmt`
      INSERT INTO equipment (name, description, serial_number, condition, location, status)
      VALUES (${params.name}, ${params.description ?? null}, ${params.serial_number ?? null}, ${condition}, ${params.location}, ${status})
      RETURNING id
    `,
    ...tagObjs.map(
      (t) => stmt`INSERT INTO equipment_tags (equipment_id, tag_id) VALUES ((SELECT MAX(id) FROM equipment), ${t.id}) ON CONFLICT DO NOTHING`
    ),
  ]);

  const newId = results[0].rows[0].id;

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
  const statements: BoundStatement[] = [];

  // "In Event" / "In Event (Rehearsal)" are computed for display from active events
  // (formatEquipmentRow); an edit form echoing them back must not persist them.
  if (scalars.status === "In Event" || scalars.status === "In Event (Rehearsal)") {
    delete scalars.status;
  }

  if (Object.keys(scalars).length > 0) {
    // Work from the stored row, not getEquipmentById's display-formatted status.
    const stored = (
      await sql<{ status: EquipmentStatus; condition: Condition }>`SELECT status, condition FROM equipment WHERE id = ${id}`
    ).rows[0];
    if (!stored) return undefined;
    const storedStatus = stored.status;
    let nextCondition = scalars.condition ?? stored.condition;
    let nextStatus = scalars.status ?? storedStatus;

    // Condition / Status coupling for Missing
    const isMissingCond = (scalars.condition as string) === "Missing";
    const isMissingStatus = (scalars.status as string) === "Unavailable (Missing)";
    const wasMissingCond = (stored.condition as string) === "Missing";
    const wasMissingStatus = (storedStatus as string) === "Unavailable (Missing)";

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
    const wasRetiredCond = (stored.condition as string) === "Retired";
    const wasRetiredStatus = (storedStatus as string) === "Unavailable (Retired)";

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

    // Single statement so a partial failure can't leave a half-updated row. The status is
    // only changed if nobody else (e.g. a concurrent checkout/return) changed it since we read it.
    statements.push(stmt`
      UPDATE equipment SET
        name = COALESCE(${scalars.name ?? null}, name),
        description = COALESCE(${scalars.description ?? null}, description),
        serial_number = COALESCE(${scalars.serial_number ?? null}, serial_number),
        location = COALESCE(${scalars.location ?? null}, location),
        condition = ${nextCondition},
        status = CASE WHEN status = ${storedStatus} THEN ${nextStatus} ELSE status END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `);
  }

  if (tags !== undefined) {
    // Resolve tags first (find case-insensitively or create), then replace the links atomically
    // together with the scalar update, so the item can never be left with its tags wiped.
    const tagObjs = await findOrCreateTags(tags);
    statements.push(stmt`DELETE FROM equipment_tags WHERE equipment_id = ${id}`);
    for (const t of tagObjs) {
      statements.push(stmt`INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (${id}, ${t.id}) ON CONFLICT DO NOTHING`);
    }
    statements.push(stmt`UPDATE equipment SET updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`);
  }

  await batch(statements);

  return getEquipmentById(id);
}

export interface BatchUpsertFailure {
  /** "item": an import row (`index` is its position in `items`); "delete": a deleteMissingIds entry. */
  kind: "item" | "delete";
  index: number;
  /** Equipment id, when known (existing item matched, or the id that could not be deleted). */
  id?: number;
  name: string;
  error: string;
}

export interface BatchUpsertResult {
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  retiredCount: number;
  /** Number of import rows and deletions that failed (= failed.length). */
  failedCount: number;
  failed: BatchUpsertFailure[];
  /** Informational messages (e.g. retired instead of deleted, status kept because the item is out). */
  notices: string[];
  /** Human-readable failures followed by notices (kept for backwards compatibility). */
  errors: string[];
  /** true when anything failed: the import was only partially applied. */
  partial: boolean;
}

const UNAVAILABLE_CONDITIONS: ReadonlySet<Condition> = new Set<Condition>(["Missing", "Broken", "Retired"]);

/** SQL: equipment row `alias` has an open checkout or is in an active event (julianday-based). */
const EQUIPMENT_BUSY_SQL = (alias: string) => `(
  EXISTS (SELECT 1 FROM checkouts bc WHERE bc.equipment_id = ${alias}.id AND bc.returned_at IS NULL)
  OR EXISTS (
    SELECT 1 FROM event_equipment bee JOIN events bev ON bev.id = bee.event_id
    WHERE bee.equipment_id = ${alias}.id
      AND (${EV_MAIN_ACTIVE("bev")} OR (${EV_REHEARSAL_ACTIVE("bev")} AND bee.used_for_rehearsal))
  )
)`;

/**
 * Imports equipment rows: matches by serial number (or by name when the row has no serial),
 * updates matches and creates the rest. Each row is written atomically (equipment row + tag
 * links in one batch); a failing row is reported in `failed` and the remaining rows continue.
 *
 * - A row without a serial number never clears an item's stored serial.
 * - A row that sets condition Missing/Broken/Retired on an item that is checked out or in an
 *   active event updates the condition only; the status is left alone (so the open checkout /
 *   event stays consistent) and a notice is added.
 */
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
): Promise<BatchUpsertResult> {
  await ensureSchema();
  let createdCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let retiredCount = 0;
  const failed: BatchUpsertFailure[] = [];
  const notices: string[] = [];

  type ExistingRow = {
    id: number;
    name: string;
    serial_number: string | null;
    status: EquipmentStatus;
    condition: Condition;
    has_open_checkout: number | boolean;
    busy: number | boolean;
  };

  // Everything needed for matching is fetched up front (one query) instead of per row.
  const { rows: existingRows } = await query<ExistingRow>(`
    SELECT
      e.id,
      LOWER(TRIM(e.name)) AS name,
      LOWER(TRIM(e.serial_number)) AS serial_number,
      e.status,
      e.condition,
      EXISTS (SELECT 1 FROM checkouts c WHERE c.equipment_id = e.id AND c.returned_at IS NULL) AS has_open_checkout,
      ${EQUIPMENT_BUSY_SQL("e")} AS busy
    FROM equipment e
  `);

  const existingMap = new Map<number, ExistingRow>();
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

  // Validate every row's tag names, then resolve all distinct tags with a fixed number of queries.
  const itemTagNames: (string[] | Error)[] = items.map((item) => {
    try {
      const names: string[] = [];
      for (const raw of item.tags ?? []) {
        if (typeof raw !== "string" || !raw.trim()) continue;
        names.push(normalizeTagName(raw));
      }
      return names;
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  });
  const tagIdByKey = new Map<string, number>();
  const allTagNames = itemTagNames.flatMap((t) => (Array.isArray(t) ? t : []));
  let tagResolveError: Error | null = null;
  if (allTagNames.length > 0) {
    try {
      for (const t of await findOrCreateTags(allTagNames)) tagIdByKey.set(tagKey(t.name), t.id);
    } catch (err) {
      tagResolveError = err instanceof Error ? err : new Error(String(err));
    }
  }

  const tagLinkStatements = (idExpr: string, idValues: unknown[], tagIds: number[]): BoundStatement[] =>
    chunk(tagIds, MAX_IN_PARAMS).map((part) =>
      rawStmt(
        `INSERT INTO equipment_tags (equipment_id, tag_id)
         SELECT ${idExpr}, t.id FROM tags t WHERE t.id IN (${part.map(() => "?").join(", ")})
         ON CONFLICT DO NOTHING`,
        [...idValues, ...part]
      )
    );

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    let matchedId: number | undefined;
    try {
      const tagNames = itemTagNames[index];
      if (tagNames instanceof Error) throw tagNames;
      if (tagNames.length > 0 && tagResolveError) throw tagResolveError;
      const tagIds = [...new Set(tagNames.map((n) => tagIdByKey.get(tagKey(n))))].filter(
        (id): id is number => typeof id === "number"
      );

      const serialRaw = typeof item.serial_number === "string" ? item.serial_number.trim() : "";
      const cleanSerial = serialRaw.toLowerCase();
      const cleanName = item.name ? item.name.trim().toLowerCase() : "";

      // 1. Match by serial_number if provided; 2. only fall back to name if NO serial was given.
      let existingId: number | undefined;
      if (cleanSerial) {
        existingId = existingBySerial.get(cleanSerial);
      } else if (cleanName) {
        existingId = existingByName.get(cleanName);
      }
      matchedId = existingId;

      if (existingId) {
        const current = existingMap.get(existingId);
        const currentStatus: EquipmentStatus = current ? current.status : "Available";

        // Preserve the existing status, but enforce the standard status-condition pairing.
        let nextStatus: EquipmentStatus = currentStatus;
        if (item.condition === "Missing") {
          nextStatus = "Unavailable (Missing)";
        } else if (item.condition === "Retired") {
          nextStatus = "Unavailable (Retired)";
        } else if (item.condition === "Broken") {
          nextStatus = currentStatus === "Unavailable (In Repairs)" ? "Unavailable (In Repairs)" : "Unavailable (Broken)";
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

        // An item that is out (open checkout) or in an active event keeps its status; only the
        // condition is recorded. The same guard is repeated inside the UPDATE, so a checkout
        // opened after the prefetch is protected too.
        const protectStatus = UNAVAILABLE_CONDITIONS.has(item.condition);
        const busy = Boolean(current?.busy);
        if (protectStatus && busy && nextStatus !== currentStatus) {
          const why = current?.has_open_checkout ? "is currently checked out" : "is in an active event";
          notices.push(
            `"${item.name}" ${why}: condition set to ${item.condition}, but its status was left as "${currentStatus}" (not "${nextStatus}") so the ${current?.has_open_checkout ? "open checkout" : "event"} stays consistent.`
          );
        }

        await batch([
          rawStmt(
            `UPDATE equipment
             SET name = ?,
                 description = ?,
                 serial_number = COALESCE(NULLIF(TRIM(?), ''), serial_number),
                 condition = ?,
                 location = ?,
                 status = CASE WHEN ? AND ${EQUIPMENT_BUSY_SQL("equipment")} THEN status ELSE ? END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
              item.name,
              item.description ?? null,
              serialRaw,
              item.condition,
              item.location,
              protectStatus,
              nextStatus,
              existingId,
            ]
          ),
          stmt`DELETE FROM equipment_tags WHERE equipment_id = ${existingId}`,
          ...tagLinkStatements("?", [existingId], tagIds),
        ]);

        if (current) {
          if (!(protectStatus && busy)) current.status = nextStatus;
          current.condition = item.condition;
        }
        if (cleanSerial && !existingBySerial.has(cleanSerial)) {
          existingBySerial.set(cleanSerial, existingId);
        }
        updatedCount++;
      } else {
        let initialStatus: EquipmentStatus = "Available";
        if (item.condition === "Missing") {
          initialStatus = "Unavailable (Missing)";
        } else if (item.condition === "Retired") {
          initialStatus = "Unavailable (Retired)";
        } else if (item.condition === "Broken") {
          initialStatus = "Unavailable (Broken)";
        }

        // The new id is the table's MAX(id) inside the batch (one transaction, AUTOINCREMENT).
        const results = await batch<{ id: number }>([
          stmt`
            INSERT INTO equipment (name, description, serial_number, condition, location, status)
            VALUES (${item.name}, ${item.description ?? null}, ${serialRaw || null}, ${item.condition}, ${item.location}, ${initialStatus})
            RETURNING id
          `,
          ...tagLinkStatements("(SELECT MAX(id) FROM equipment)", [], tagIds),
        ]);
        const targetId = results[0].rows[0].id;
        existingMap.set(targetId, {
          id: targetId,
          name: cleanName,
          serial_number: cleanSerial || null,
          status: initialStatus,
          condition: item.condition,
          has_open_checkout: 0,
          busy: 0,
        });
        if (cleanSerial) {
          existingBySerial.set(cleanSerial, targetId);
        }
        if (cleanName && !existingByName.has(cleanName)) {
          existingByName.set(cleanName, targetId);
        }
        createdCount++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ kind: "item", index, id: matchedId, name: item.name, error: msg });
    }
  }

  if (deleteMissingIds && deleteMissingIds.length > 0) {
    for (let index = 0; index < deleteMissingIds.length; index++) {
      const id = deleteMissingIds[index];
      const current = existingMap.get(id);
      const label = current ? `"${current.name}" (${current.serial_number || `ID ${current.id}`})` : `Equipment ID ${id}`;
      try {
        const delResult = await deleteEquipment(id);
        if (delResult.success && delResult.retired) {
          // Items with checkout/reservation/audit/event history are retired, not deleted.
          retiredCount++;
          if (!delResult.alreadyRetired) {
            notices.push(`${label} has usage history, so it was retired instead of deleted.`);
          }
        } else if (delResult.success) {
          deletedCount++;
        } else {
          failed.push({ kind: "delete", index, id, name: label, error: `Could not delete ${label}: ${delResult.error}` });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push({ kind: "delete", index, id, name: label, error: `Could not delete ${label}: ${msg}` });
      }
    }
  }

  const errors = [
    ...failed.map((f) => (f.kind === "item" ? `Error processing "${f.name}": ${f.error}` : f.error)),
    ...notices,
  ];

  return {
    createdCount,
    updatedCount,
    deletedCount,
    retiredCount,
    failedCount: failed.length,
    failed,
    notices,
    errors,
    partial: failed.length > 0,
  };
}

export async function deleteEquipment(id: number): Promise<{
  success: boolean;
  error?: string;
  /** true when the item had history and was retired instead of hard-deleted. */
  retired?: boolean;
  /** true when the (retired) item was already retired before this call. */
  alreadyRetired?: boolean;
}> {
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
    WHERE ee.equipment_id = ${id} AND julianday(ev.end_time) > julianday('now')
    LIMIT 1
  `;
  if (activeEvents.rows.length > 0) {
    return { success: false, error: `Cannot delete equipment allocated to upcoming/ongoing event "${activeEvents.rows[0].name}".` };
  }

  const existing = (
    await sql<{ id: number; condition: Condition; status: EquipmentStatus }>`
      SELECT id, condition, status FROM equipment WHERE id = ${id}
    `
  ).rows[0];
  if (!existing) {
    return { success: false, error: "Equipment not found." };
  }

  // Hard-delete only items with no history. Every table below cascades from equipment, so
  // deleting an item that has been used would silently wipe checkout / reservation / audit /
  // handover / event records. The history check is part of the DELETE itself, so history
  // created concurrently still prevents the hard delete.
  const { rowCount } = await sql`
    DELETE FROM equipment
    WHERE id = ${id}
      AND NOT EXISTS (SELECT 1 FROM checkouts WHERE equipment_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM reservations WHERE equipment_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM audit_records WHERE equipment_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM handover_codes WHERE equipment_id = ${id})
      AND NOT EXISTS (SELECT 1 FROM event_equipment WHERE equipment_id = ${id})
  `;
  if (rowCount === 1) {
    return { success: true, retired: false };
  }

  // Has history: retire instead of deleting (condition/status coupling as in updateEquipment).
  const alreadyRetired = existing.condition === "Retired" && existing.status === "Unavailable (Retired)";
  const retire = await sql`
    UPDATE equipment
    SET condition = 'Retired', status = 'Unavailable (Retired)', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
      AND NOT EXISTS (SELECT 1 FROM checkouts WHERE equipment_id = ${id} AND returned_at IS NULL)
  `;
  if (retire.rowCount === 0) {
    const stillThere = await sql`SELECT id FROM equipment WHERE id = ${id}`;
    return {
      success: false,
      error: stillThere.rows.length > 0 ? "Cannot delete equipment with an active checkout." : "Equipment not found.",
    };
  }

  // A retired item can't be lent out, so upcoming reservations for it are cancelled
  // (previously the hard delete removed them outright).
  await sql`
    UPDATE reservations SET status = 'cancelled'
    WHERE equipment_id = ${id} AND status = 'confirmed' AND julianday(end_time) > julianday('now')
  `;

  return { success: true, retired: true, alreadyRetired };
}

export async function getEquipmentByTagId(tagId: number): Promise<Equipment[]> {
  if (!Number.isInteger(tagId) || tagId <= 0) return [];
  await ensureSchema();
  const { rows } = await query<EquipmentRawRow>(
    `${EQUIPMENT_SELECT_SQL}
     WHERE EXISTS (SELECT 1 FROM equipment_tags ef WHERE ef.equipment_id = e.id AND ef.tag_id = ?)
     ORDER BY e.name ASC, e.id ASC`,
    [tagId]
  );
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

/** Thrown by normalizeOccurredAt for a client-supplied action time that cannot be accepted. */
export class InvalidOccurredAtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOccurredAtError";
  }
}

/** Allowed station-clock skew: action times up to this far in the future are clamped to now. */
export const OCCURRED_AT_MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
/** Offline actions older than this are refused. */
export const OCCURRED_AT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const SQLITE_UTC_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Normalises an optional client-supplied event time (e.g. an offline NFC action
 * replayed later) into SQLite's "YYYY-MM-DD HH:MM:SS" UTC format. Returns null when no
 * time was given (caller uses "now").
 *
 * - Up to 2 minutes in the future (clock skew): clamped to now.
 * - Invalid, more than 2 minutes in the future, or more than 7 days old: throws
 *   InvalidOccurredAtError.
 *
 * Already-normalised "YYYY-MM-DD HH:MM:SS" values are treated as UTC, so the function
 * is idempotent.
 */
export function normalizeOccurredAt(input?: string | null): string | null {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "string") throw new InvalidOccurredAtError("Invalid action timestamp.");
  const trimmed = input.trim();
  const d = new Date(
    SQLITE_UTC_DATETIME_RE.test(trimmed) ? `${trimmed.replace(" ", "T")}Z` : trimmed
  );
  if (Number.isNaN(d.getTime())) {
    throw new InvalidOccurredAtError(`Invalid action timestamp "${trimmed.slice(0, 40)}".`);
  }
  const now = Date.now();
  if (d.getTime() > now + OCCURRED_AT_MAX_FUTURE_SKEW_MS) {
    throw new InvalidOccurredAtError(
      "Action timestamp is in the future. Check the station's clock and try again."
    );
  }
  if (d.getTime() < now - OCCURRED_AT_MAX_AGE_MS) {
    throw new InvalidOccurredAtError(
      "Action timestamp is more than 7 days old; offline actions must be synced within 7 days."
    );
  }
  const effective = d.getTime() > now ? new Date(now) : d;
  return effective.toISOString().replace("T", " ").slice(0, 19);
}

export async function createCheckout(params: {
  equipment_id: number;
  checked_out_by: number | null;
  checked_out_by_name: string;
  expected_return_at?: string;
  notes?: string;
  checkout_location?: string;
  nfc_value?: string;
  nfc_id?: string;
  /** Original time of the checkout (offline replay). Defaults to now. */
  checked_out_at?: string | null;
}): Promise<Checkout> {
  if (!Number.isInteger(params.equipment_id) || params.equipment_id <= 0) {
    throw new Error("Invalid equipment ID");
  }
  const checkedOutAt = normalizeOccurredAt(params.checked_out_at);
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

  // Atomically claim the item: this single conditional UPDATE only succeeds for one of
  // several concurrent checkouts, so the same item can never be checked out twice.
  const claim = await sql`
    UPDATE equipment SET status = 'Checked Out', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${params.equipment_id}
      AND LOWER(status) = 'available'
      AND NOT EXISTS (SELECT 1 FROM checkouts WHERE equipment_id = ${params.equipment_id} AND returned_at IS NULL)
  `;
  if (claim.rowCount === 0) {
    throw new Error("Equipment is already checked out.");
  }

  const val = params.nfc_value ?? params.nfc_id ?? null;
  try {
    const { rows } = await sql<Checkout>`
      INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, notes, checkout_location, nfc_value, nfc_id)
      VALUES (${params.equipment_id}, ${params.checked_out_by ?? null}, ${params.checked_out_by_name}, COALESCE(${checkedOutAt}, datetime('now')), ${params.expected_return_at ?? null}, ${params.notes ?? null}, ${params.checkout_location ?? null}, ${val}, ${val})
      RETURNING *
    `;
    return rows[0];
  } catch (err) {
    // Release the claim so the item doesn't stay stuck as "Checked Out" with no checkout row.
    await sql`
      UPDATE equipment SET status = 'Available', updated_at = CURRENT_TIMESTAMP
      WHERE id = ${params.equipment_id} AND status = 'Checked Out'
        AND NOT EXISTS (SELECT 1 FROM checkouts WHERE equipment_id = ${params.equipment_id} AND returned_at IS NULL)
    `;
    throw err;
  }
}

export async function returnCheckout(
  equipment_id: number,
  options?: { returned_at?: string | null }
): Promise<Checkout> {
  if (!Number.isInteger(equipment_id) || equipment_id <= 0) {
    throw new Error("Invalid equipment ID");
  }
  const returnedAt = normalizeOccurredAt(options?.returned_at);
  await ensureSchema();

  // Conditional UPDATE: only one concurrent return can close the open checkout.
  // A replayed (offline) return time is never allowed to precede the checkout time.
  const { rows } = await sql<Checkout>`
    UPDATE checkouts
    SET returned_at = CASE
      WHEN julianday(COALESCE(${returnedAt}, datetime('now'))) < julianday(checked_out_at) THEN checked_out_at
      ELSE COALESCE(${returnedAt}, datetime('now'))
    END
    WHERE equipment_id = ${equipment_id} AND returned_at IS NULL
    RETURNING *
  `;
  if (rows.length === 0) {
    throw new Error("No active checkout found for this equipment.");
  }

  // Any outstanding handover codes for the closed checkout(s) can no longer be claimed.
  await ensureHandoverTable();
  for (const row of rows) {
    await sql`UPDATE handover_codes SET status = 'revoked' WHERE checkout_id = ${row.id} AND status = 'active'`;
  }

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

export async function getActiveCheckoutByEquipmentId(equipmentId: number): Promise<Checkout | undefined> {
  await ensureSchema();
  const { rows } = await sql<Checkout>`
    SELECT * FROM checkouts 
    WHERE equipment_id = ${equipmentId} AND returned_at IS NULL 
    ORDER BY checked_out_at DESC 
    LIMIT 1
  `;
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
  /** Original time of the action when replayed from the offline queue. */
  occurredAt?: string | null;
  /**
   * Member the card belonged to when the action was queued offline. If the card has
   * since been reassigned to someone else, the replay is rejected.
   */
  expectedMemberName?: string | null;
}): Promise<Checkout> {
  await ensureSchema();
  const raw = params.nfcValue ?? params.nfcId ?? "";
  const trimmed = raw.trim();
  const card = await getNfcCardByValue(trimmed);
  if (!card) {
    throw new Error("NFC card not found in database.");
  }
  assertCardMember(card, params.expectedMemberName);

  // Idempotent replay: this exact checkout (same card, same original time) already exists.
  if (params.occurredAt) {
    const existing = await findReplayedNfcCheckout(params.equipmentId, trimmed, params.occurredAt);
    if (existing) return existing;
  }

  return await createCheckout({
    equipment_id: params.equipmentId,
    checked_out_by: null,
    checked_out_by_name: card.member_name,
    notes: params.notes || "Checked out via NFC Station",
    checkout_location: params.checkout_location,
    nfc_value: trimmed,
    nfc_id: trimmed,
    checked_out_at: params.occurredAt,
  });
}

export async function nfcReturn(
  equipmentId: number,
  options?: { occurredAt?: string | null; nfcValue?: string | null }
): Promise<Checkout> {
  // Idempotent replay: this card already returned the item at the original time.
  if (options?.occurredAt && options.nfcValue) {
    const existing = await findReplayedNfcReturn(equipmentId, options.nfcValue, options.occurredAt);
    if (existing) return existing;
  }
  return await returnCheckout(equipmentId, { returned_at: options?.occurredAt });
}

/**
 * Window (seconds) within which an existing record is considered the same action as a
 * replay. Covers a live request that reached the server but timed out on the station
 * and was then queued with the station's time instead of the server's.
 */
const REPLAY_MATCH_TOLERANCE_SECONDS = 120;

/**
 * Replay idempotency for offline NFC checkouts: returns the item's open checkout when it
 * is held by this card and started at `occurredAt` (within the tolerance), i.e. an
 * earlier delivery of the same queued action already succeeded. Only an *open* checkout
 * can match, so a later genuine checkout after a return is never mistaken for a replay.
 */
export async function findReplayedNfcCheckout(
  equipmentId: number,
  nfcValue: string,
  occurredAt: string
): Promise<Checkout | undefined> {
  const occ = normalizeOccurredAt(occurredAt);
  const val = nfcValue.trim();
  if (!occ || !val) return undefined;
  await ensureSchema();
  const { rows } = await sql<Checkout>`
    SELECT * FROM checkouts
    WHERE equipment_id = ${equipmentId}
      AND returned_at IS NULL
      AND (LOWER(nfc_value) = LOWER(${val}) OR LOWER(nfc_id) = LOWER(${val}))
      AND ABS(julianday(checked_out_at) - julianday(${occ})) * 86400 <= ${REPLAY_MATCH_TOLERANCE_SECONDS}
    ORDER BY id DESC
    LIMIT 1
  `;
  return rows[0];
}

/**
 * Replay idempotency for offline NFC returns: returns a checkout of this item by this
 * card that was already closed at exactly `occurredAt` (returnCheckout clamps a return
 * time that precedes the checkout time to the checkout time, so that case matches too).
 * When the item has no open checkout at all, a return by this card within the tolerance
 * also matches (the replay would be a no-op anyway).
 */
export async function findReplayedNfcReturn(
  equipmentId: number,
  nfcValue: string,
  occurredAt: string
): Promise<Checkout | undefined> {
  const occ = normalizeOccurredAt(occurredAt);
  const val = nfcValue.trim();
  if (!occ || !val) return undefined;
  await ensureSchema();
  const { rows } = await sql<Checkout>`
    SELECT * FROM checkouts c
    WHERE c.equipment_id = ${equipmentId}
      AND c.returned_at IS NOT NULL
      AND (LOWER(c.nfc_value) = LOWER(${val}) OR LOWER(c.nfc_id) = LOWER(${val}))
      AND (
        julianday(c.returned_at) = julianday(CASE
          WHEN julianday(${occ}) < julianday(c.checked_out_at) THEN c.checked_out_at
          ELSE ${occ}
        END)
        OR (
          NOT EXISTS (
            SELECT 1 FROM checkouts o WHERE o.equipment_id = ${equipmentId} AND o.returned_at IS NULL
          )
          AND ABS(julianday(c.returned_at) - julianday(${occ})) * 86400 <= ${REPLAY_MATCH_TOLERANCE_SECONDS}
        )
      )
    ORDER BY c.id DESC
    LIMIT 1
  `;
  return rows[0];
}

/** Throws if a queued NFC action's recorded member no longer owns the card. */
export function assertCardMember(card: NFCCard, expectedMemberName?: string | null): void {
  if (!expectedMemberName) return;
  if (card.member_name.trim().toLowerCase() !== expectedMemberName.trim().toLowerCase()) {
    throw new Error(
      `This NFC card now belongs to ${card.member_name}, not ${expectedMemberName}. The queued action was not applied.`
    );
  }
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

export async function getAllTags(): Promise<Tag[]> {
  await ensureSchema();
  const { rows } = await sql<Tag>`SELECT * FROM tags ORDER BY name ASC`;
  return rows;
}

export const TAG_NAME_MAX_LENGTH = 50;

/**
 * Canonical tag name: Unicode-normalised, trimmed, internal whitespace collapsed to one space.
 * Throws InvalidTagNameError if the result is empty or longer than TAG_NAME_MAX_LENGTH.
 */
export function normalizeTagName(name: unknown): string {
  const clean = typeof name === "string" ? name.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  if (!clean) throw new InvalidTagNameError("Tag name cannot be empty.");
  if (clean.length > TAG_NAME_MAX_LENGTH) {
    throw new InvalidTagNameError(`Tag name cannot exceed ${TAG_NAME_MAX_LENGTH} characters.`);
  }
  return clean;
}

/** D1 allows at most 100 bound parameters per statement. */
const MAX_IN_PARAMS = 90;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function tagKey(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * All tags keyed by normalised lower-case name (lowest id wins). The tag list is small, and
 * matching in JS avoids SQLite's ASCII-only LOWER() for non-ASCII names.
 */
async function loadTagIndex(): Promise<Map<string, Tag>> {
  const { rows } = await sql<Tag>`SELECT id, name FROM tags ORDER BY id ASC`;
  const index = new Map<string, Tag>();
  for (const t of rows) {
    if (!t.name) continue;
    const key = tagKey(t.name);
    if (!index.has(key)) index.set(key, t);
  }
  return index;
}

/**
 * Resolves tag names to tag rows, reusing an existing tag on a case-insensitive match and
 * creating the rest. Blank names are skipped; duplicates (case-insensitive) collapse to one.
 * Returns tags in first-seen order. Throws InvalidTagNameError for an over-long name.
 */
export async function findOrCreateTags(names: readonly unknown[]): Promise<Tag[]> {
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const raw of names ?? []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const clean = normalizeTagName(raw);
    const key = tagKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push(clean);
  }
  if (wanted.length === 0) return [];

  await ensureSchema();
  let found = await loadTagIndex();
  const missing = wanted.filter((n) => !found.has(tagKey(n)));
  if (missing.length > 0) {
    // ON CONFLICT DO NOTHING: a concurrent request (or a case variant, via the unique
    // LOWER(name) index from migration 0006) may have created the tag meanwhile.
    await batch(missing.map((n) => stmt`INSERT INTO tags (name) VALUES (${n}) ON CONFLICT DO NOTHING`));
    found = await loadTagIndex();
  }
  return wanted.map((n) => {
    const t = found.get(tagKey(n));
    if (!t) throw new Error(`Could not create tag "${n}".`);
    return t;
  });
}

/**
 * Creates a tag, or returns the existing tag whose name matches case-insensitively (after
 * trimming and collapsing whitespace). Throws InvalidTagNameError for an empty/over-long name.
 */
export async function createTag(name: string): Promise<Tag> {
  const clean = normalizeTagName(name);
  const [tag] = await findOrCreateTags([clean]);
  return tag;
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
  const now = Date.now();
  const start = parseDbDate(startTime)?.getTime() ?? new Date(startTime).getTime();
  const end = parseDbDate(endTime)?.getTime() ?? new Date(endTime).getTime();

  if (now < start) return "Upcoming";
  if (now >= start && now <= end) return "Ongoing";
  return "Completed";
}

type EventBaseRow = Omit<
  AppEvent,
  "oics" | "section_ics" | "section_equipment" | "section_deployments" | "section_rehearsals" | "status" | "has_rehearsal"
> & { has_rehearsal: boolean | number | null };

const EVENT_BASE_COLUMNS =
  "ev.id, ev.name, ev.description, ev.start_time, ev.end_time, ev.location, ev.created_by, ev.has_rehearsal, ev.rehearsal_start_time, ev.rehearsal_end_time, ev.created_at, ev.updated_at";

// Member columns embedded in event data. Event data is served to every logged-in user, so
// email, google_id and the RSVP response_token are deliberately NOT selected.
const EVENT_MEMBER_COLUMNS = "u.id, u.name, u.username, u.image, u.role, u.provider, u.created_at";

/**
 * Loads events and all their related rows with a fixed number of queries (6, regardless of how
 * many events) and assembles them. `eventId` restricts everything to one event; otherwise all
 * events are loaded. Shared by getEventById and getAllEvents so both produce identical output.
 */
async function loadAssembledEvents(eventId?: number): Promise<AppEvent[]> {
  const one = eventId !== undefined;
  const where = (col: string) => (one ? `WHERE ${col} = ?` : "");
  const params = one ? [eventId] : [];

  const { rows: eventRows } = await query<EventBaseRow>(
    `SELECT ${EVENT_BASE_COLUMNS} FROM events ev ${where("ev.id")} ORDER BY ev.start_time DESC, ev.id DESC`,
    params
  );
  if (eventRows.length === 0) return [];

  const { rows: oicRows } = await query<EventMember & { event_id: number }>(
    `SELECT eo.event_id, ${EVENT_MEMBER_COLUMNS}
     FROM event_oics eo JOIN users u ON u.id = eo.user_id
     ${where("eo.event_id")}
     ORDER BY u.name ASC, u.id ASC`,
    params
  );

  const { rows: icRows } = await query<EventMember & { event_id: number; section: EventSection }>(
    `SELECT ei.event_id, ${EVENT_MEMBER_COLUMNS}, ei.section
     FROM event_ics ei JOIN users u ON u.id = ei.user_id
     ${where("ei.event_id")}
     ORDER BY u.name ASC, u.id ASC`,
    params
  );

  const { rows: eqRows } = await query<
    EquipmentRawRow & { event_id: number; section: EventSection; used_for_rehearsal: boolean | number }
  >(
    `SELECT
       ee.event_id,
       e.id, e.name, e.description, e.serial_number,
       e.condition, e.location, e.status, e.created_at, e.updated_at,
       ee.section, ee.used_for_rehearsal,
       (SELECT GROUP_CONCAT(t.name) FROM equipment_tags et JOIN tags t ON t.id = et.tag_id WHERE et.equipment_id = e.id) AS tags
     FROM event_equipment ee JOIN equipment e ON e.id = ee.equipment_id
     ${where("ee.event_id")}
     ORDER BY e.name ASC, e.id ASC, ee.section ASC`,
    params
  );

  const { rows: depRows } = await query<
    EventMember & {
      event_id: number;
      section: EventSection;
      attending_rehearsal: boolean | number;
      response_status?: DeploymentResponseStatus;
      responded_at?: string | null;
    }
  >(
    `SELECT ed.event_id, ${EVENT_MEMBER_COLUMNS},
       ed.section, ed.attending_rehearsal, ed.response_status, ed.responded_at
     FROM event_deployments ed JOIN users u ON u.id = ed.user_id
     ${where("ed.event_id")}
     ORDER BY u.name ASC, u.id ASC`,
    params
  );

  const { rows: rehRows } = await query<{ event_id: number; section: EventSection; participating: boolean | number }>(
    `SELECT er.event_id, er.section, er.participating FROM event_section_rehearsals er ${where("er.event_id")}`,
    params
  );

  const byId = new Map<number, AppEvent>();
  const events: AppEvent[] = eventRows.map((ev) => {
    const assembled: AppEvent = {
      ...ev,
      has_rehearsal: Boolean(ev.has_rehearsal),
      oics: [],
      section_ics: { photo: [], video: [], av: [] },
      section_equipment: { photo: [], video: [], av: [] },
      section_deployments: { photo: [], video: [], av: [] },
      section_rehearsals: {
        photo: { participating: false },
        video: { participating: false },
        av: { participating: false },
      },
      status: computeEventStatus(ev.start_time, ev.end_time),
    };
    byId.set(ev.id, assembled);
    return assembled;
  });

  for (const { event_id, ...member } of oicRows) {
    byId.get(event_id)?.oics.push(member);
  }
  for (const { event_id, ...ic } of icRows) {
    const list = byId.get(event_id)?.section_ics[ic.section];
    if (list) list.push(ic as EventMember & { section: EventSection });
  }
  for (const { event_id, ...item } of eqRows) {
    const list = byId.get(event_id)?.section_equipment[item.section];
    if (!list) continue;
    const formatted = formatEquipmentRow(item) as SectionEquipmentItem;
    formatted.used_for_rehearsal = Boolean(item.used_for_rehearsal);
    list.push(formatted);
  }
  for (const { event_id, ...dep } of depRows) {
    const list = byId.get(event_id)?.section_deployments[dep.section];
    if (!list) continue;
    list.push({
      ...dep,
      attending_rehearsal: Boolean(dep.attending_rehearsal),
      response_status: dep.response_status || "pending",
      responded_at: dep.responded_at || null,
    } as SectionDeploymentItem);
  }
  for (const reh of rehRows) {
    const cfg = byId.get(reh.event_id)?.section_rehearsals[reh.section];
    if (cfg) cfg.participating = Boolean(reh.participating);
  }

  return events;
}

export async function getAllEvents(): Promise<AppEvent[]> {
  await ensureSchema();
  return loadAssembledEvents();
}

export async function getEventById(id: number): Promise<AppEvent | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  await ensureSchema();
  const [event] = await loadAssembledEvents(id);
  return event;
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
  // The event and its OIC / IC / rehearsal rows are created atomically. Inside the batch the new
  // event's id is the table's MAX(id) (one transaction; AUTOINCREMENT ids only grow).
  const newEventId = "(SELECT MAX(id) FROM events)";
  const statements: BoundStatement[] = [
    stmt`
      INSERT INTO events (name, description, start_time, end_time, location, created_by, has_rehearsal, rehearsal_start_time, rehearsal_end_time)
      VALUES (${params.name}, ${params.description ?? null}, ${params.start_time}, ${params.end_time}, ${params.location}, ${params.created_by}, ${params.has_rehearsal ?? false}, ${params.rehearsal_start_time ?? null}, ${params.rehearsal_end_time ?? null})
      RETURNING id
    `,
  ];

  for (const uid of params.oic_user_ids ?? []) {
    statements.push(
      rawStmt(`INSERT INTO event_oics (event_id, user_id) VALUES (${newEventId}, ?) ON CONFLICT DO NOTHING`, [uid])
    );
  }

  const sectionMap: Record<EventSection, number[] | undefined> = {
    photo: params.photo_ic_ids,
    video: params.video_ic_ids,
    av: params.av_ic_ids,
  };

  for (const sec of ["photo", "video", "av"] as EventSection[]) {
    for (const uid of sectionMap[sec] ?? []) {
      statements.push(
        rawStmt(`INSERT INTO event_ics (event_id, user_id, section) VALUES (${newEventId}, ?, ?) ON CONFLICT DO NOTHING`, [uid, sec])
      );
    }
    statements.push(
      rawStmt(
        `INSERT INTO event_section_rehearsals (event_id, section, participating) VALUES (${newEventId}, ?, FALSE) ON CONFLICT DO NOTHING`,
        [sec]
      )
    );
  }

  const results = await batch<{ id: number }>(statements);
  const newId = results[0].rows[0].id;

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

  // All changes (event fields, OIC list, section IC lists) are applied atomically, so a failure
  // can't leave the event with its OICs / ICs wiped but not re-inserted.
  const statements: BoundStatement[] = [];

  if (Object.keys(scalars).length > 0) {
    if (scalars.name !== undefined) statements.push(stmt`UPDATE events SET name = ${scalars.name} WHERE id = ${id}`);
    if (scalars.description !== undefined) statements.push(stmt`UPDATE events SET description = ${scalars.description} WHERE id = ${id}`);
    if (scalars.start_time !== undefined) statements.push(stmt`UPDATE events SET start_time = ${scalars.start_time} WHERE id = ${id}`);
    if (scalars.end_time !== undefined) statements.push(stmt`UPDATE events SET end_time = ${scalars.end_time} WHERE id = ${id}`);
    if (scalars.location !== undefined) statements.push(stmt`UPDATE events SET location = ${scalars.location} WHERE id = ${id}`);
    if (scalars.has_rehearsal !== undefined) statements.push(stmt`UPDATE events SET has_rehearsal = ${scalars.has_rehearsal} WHERE id = ${id}`);
    if (scalars.rehearsal_start_time !== undefined) statements.push(stmt`UPDATE events SET rehearsal_start_time = ${scalars.rehearsal_start_time} WHERE id = ${id}`);
    if (scalars.rehearsal_end_time !== undefined) statements.push(stmt`UPDATE events SET rehearsal_end_time = ${scalars.rehearsal_end_time} WHERE id = ${id}`);
    statements.push(stmt`UPDATE events SET updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`);
  }

  if (oic_user_ids !== undefined) {
    statements.push(stmt`DELETE FROM event_oics WHERE event_id = ${id}`);
    for (const uid of oic_user_ids) {
      statements.push(stmt`INSERT INTO event_oics (event_id, user_id) VALUES (${id}, ${uid}) ON CONFLICT DO NOTHING`);
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
      statements.push(stmt`DELETE FROM event_ics WHERE event_id = ${id} AND section = ${sec}`);
      for (const uid of ids) {
        statements.push(stmt`INSERT INTO event_ics (event_id, user_id, section) VALUES (${id}, ${uid}, ${sec}) ON CONFLICT DO NOTHING`);
      }
    }
  }

  await batch(statements);

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
  // Replace atomically: a failed insert must not leave the item detached.
  await batch([
    stmt`DELETE FROM event_equipment WHERE event_id = ${eventId} AND equipment_id = ${equipmentId} AND section = ${section}`,
    stmt`
      INSERT INTO event_equipment (event_id, equipment_id, section, used_for_rehearsal, added_by)
      VALUES (${eventId}, ${equipmentId}, ${section}, ${usedForRehearsal}, ${addedBy})
    `,
  ]);
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
  // Replace atomically: a failed insert must not silently remove the member's deployment.
  await batch([
    stmt`DELETE FROM event_deployments WHERE event_id = ${eventId} AND user_id = ${userId} AND section = ${section}`,
    stmt`
      INSERT INTO event_deployments (event_id, user_id, section, attending_rehearsal, added_by, response_status, response_token)
      VALUES (${eventId}, ${userId}, ${section}, ${attendingRehearsal}, ${addedBy}, 'pending', ${token})
    `,
  ]);
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
  // Invitation links stop working once the event has ended.
  const { rowCount } = await sql`
    UPDATE event_deployments
    SET
      response_status = ${status},
      responded_at = CURRENT_TIMESTAMP
    WHERE response_token = ${token}
      AND EXISTS (
        SELECT 1 FROM events ev
        WHERE ev.id = event_deployments.event_id
          AND julianday('now') <= julianday(ev.end_time)
      )
  `;
  if (!rowCount || rowCount === 0) {
    const exists = await sql`SELECT 1 FROM event_deployments WHERE response_token = ${token} LIMIT 1`;
    if (exists.rows.length > 0) {
      return { success: false, error: "This event has ended, so RSVP is closed." };
    }
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

  const { rows: tokenRows } = await sql<{ response_token: string | null }>`
    SELECT response_token FROM event_deployments
    WHERE event_id = ${eventId} AND user_id = ${userId} AND section = ${section}
  `;
  let token = tokenRows[0]?.response_token;
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
  // Applied atomically so the rehearsal flags can't be left half-reset.
  const statements: BoundStatement[] = [
    stmt`
      INSERT INTO event_section_rehearsals (event_id, section, participating)
      VALUES (${eventId}, ${section}, ${participating})
      ON CONFLICT (event_id, section) DO UPDATE SET participating = EXCLUDED.participating
    `,
  ];

  if (rehearsalEquipmentIds !== undefined) {
    statements.push(stmt`
      UPDATE event_equipment
      SET used_for_rehearsal = FALSE
      WHERE event_id = ${eventId} AND section = ${section}
    `);
    for (const eqId of rehearsalEquipmentIds) {
      statements.push(stmt`
        UPDATE event_equipment
        SET used_for_rehearsal = TRUE
        WHERE event_id = ${eventId} AND equipment_id = ${eqId} AND section = ${section}
      `);
    }
  }

  if (rehearsalUserIds !== undefined) {
    statements.push(stmt`
      UPDATE event_deployments
      SET attending_rehearsal = FALSE
      WHERE event_id = ${eventId} AND section = ${section}
    `);
    for (const uId of rehearsalUserIds) {
      statements.push(stmt`
        UPDATE event_deployments
        SET attending_rehearsal = TRUE
        WHERE event_id = ${eventId} AND user_id = ${uId} AND section = ${section}
      `);
    }
  }

  await batch(statements);
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
  // Backslash-escape LIKE wildcards; the ESCAPE '\' clauses below make SQLite honour it.
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
    WHERE s.title LIKE ${pattern} ESCAPE '\\'
       OR s.content LIKE ${pattern} ESCAPE '\\'
       OR s.category LIKE ${pattern} ESCAPE '\\'
    ORDER BY s.updated_at DESC
  `;
  return rows;
}

// ---------------------------------------------------------------------------
// Automated Overdue & Due-Soon Return Reminders
// ---------------------------------------------------------------------------

/**
 * Kept for backwards compatibility. checkout_reminders is created by the migrations (D1) and by
 * SCHEMA_SQL (better-sqlite3), so this no longer issues any DDL.
 */
export async function ensureRemindersTable(): Promise<void> {
  await ensureSchema();
}

let warnedMissingWindowKey = false;

function isMissingWindowKeyColumn(err: unknown): boolean {
  return err instanceof Error && /window_key/i.test(err.message);
}

/**
 * Records a reminder. `windowKey` identifies the reminder window; (checkout, type, window) is
 * UNIQUE (migration 0006), so recording the same window twice throws a UNIQUE error. Prefer
 * claimCheckoutReminder for the send path.
 */
export async function recordCheckoutReminder(
  checkoutId: number,
  reminderType: ReminderType,
  sentToEmail: string,
  windowKey: string | null = null
): Promise<CheckoutReminder> {
  await ensureRemindersTable();
  const cleanEmail = sentToEmail.trim().toLowerCase();
  const { rows } = await sql<CheckoutReminder>`
    INSERT INTO checkout_reminders (checkout_id, reminder_type, sent_to_email, window_key)
    VALUES (${checkoutId}, ${reminderType}, ${cleanEmail}, ${windowKey})
    RETURNING *
  `;
  return rows[0];
}

/**
 * Race-safe reminder claim: inserts the reminder record for (checkout, type, window) BEFORE the
 * email is sent. Returns the new record, or null when another run already claimed/sent this
 * window. On send failure the caller releases the claim with releaseCheckoutReminder.
 */
export async function claimCheckoutReminder(
  checkoutId: number,
  reminderType: ReminderType,
  sentToEmail: string,
  windowKey: string
): Promise<CheckoutReminder | null> {
  await ensureRemindersTable();
  const cleanEmail = sentToEmail.trim().toLowerCase();
  try {
    const { rows } = await sql<CheckoutReminder>`
      INSERT INTO checkout_reminders (checkout_id, reminder_type, sent_to_email, window_key)
      VALUES (${checkoutId}, ${reminderType}, ${cleanEmail}, ${windowKey})
      ON CONFLICT DO NOTHING
      RETURNING *
    `;
    return rows[0] ?? null;
  } catch (err) {
    if (!isMissingWindowKeyColumn(err)) throw err;
    // Migration 0006 not applied: fall back to a plain (not race-safe) insert.
    if (!warnedMissingWindowKey) {
      warnedMissingWindowKey = true;
      console.error("[DB] checkout_reminders.window_key is missing; apply migration 0006_data_layer_fixes.sql.");
    }
    const { rows } = await sql<CheckoutReminder>`
      INSERT INTO checkout_reminders (checkout_id, reminder_type, sent_to_email)
      VALUES (${checkoutId}, ${reminderType}, ${cleanEmail})
      RETURNING *
    `;
    return rows[0] ?? null;
  }
}

/** Removes a reminder claim whose email could not be sent, so a later run can retry. */
export async function releaseCheckoutReminder(reminderId: number): Promise<void> {
  await sql`DELETE FROM checkout_reminders WHERE id = ${reminderId}`;
}

export async function getCheckoutReminders(checkoutId: number): Promise<CheckoutReminder[]> {
  await ensureRemindersTable();
  const { rows } = await sql<CheckoutReminder>`
    SELECT * FROM checkout_reminders
    WHERE checkout_id = ${checkoutId}
    ORDER BY julianday(sent_at) DESC, id DESC
  `;
  return rows;
}

export interface PendingReturnReminderItem {
  checkout_id: number;
  equipment_id: number;
  equipment_name: string;
  equipment_serial_number: string | null;
  equipment_location: string;
  checked_out_at: string;
  expected_return_at: string;
  notes: string | null;
  checked_out_by: number | null;
  checked_out_by_name: string;
  borrower_name: string;
  /** Email of the account in checked_out_by; null when the checkout has no linked account. */
  borrower_email: string | null;
  /** Checkout made at the NFC station (no user account; never matched by name). */
  is_nfc_checkout: boolean;
  last_due_soon_sent: string | null;
  last_overdue_sent: string | null;
}

/**
 * Open checkouts with a due date, one row per checkout. The recipient is resolved ONLY through
 * checkouts.checked_out_by (the account that made the checkout). NFC-station checkouts have no
 * user link (nfc_cards has no user column) and are never matched to accounts by name.
 */
export async function getPendingReturnReminders(): Promise<PendingReturnReminderItem[]> {
  await ensureRemindersTable();
  const { rows } = await sql<Omit<PendingReturnReminderItem, "is_nfc_checkout"> & { is_nfc_checkout: number | boolean }>`
    SELECT
      c.id AS checkout_id,
      c.equipment_id,
      e.name AS equipment_name,
      e.serial_number AS equipment_serial_number,
      e.location AS equipment_location,
      c.checked_out_at,
      c.expected_return_at,
      c.notes,
      c.checked_out_by,
      c.checked_out_by_name,
      COALESCE(u.name, c.checked_out_by_name) AS borrower_name,
      u.email AS borrower_email,
      CASE WHEN c.nfc_value IS NOT NULL OR c.nfc_id IS NOT NULL THEN 1 ELSE 0 END AS is_nfc_checkout,
      (SELECT r.sent_at FROM checkout_reminders r WHERE r.checkout_id = c.id AND r.reminder_type = 'due_soon' ORDER BY julianday(r.sent_at) DESC LIMIT 1) AS last_due_soon_sent,
      (SELECT r.sent_at FROM checkout_reminders r WHERE r.checkout_id = c.id AND r.reminder_type = 'overdue' ORDER BY julianday(r.sent_at) DESC LIMIT 1) AS last_overdue_sent
    FROM checkouts c
    JOIN equipment e ON e.id = c.equipment_id
    LEFT JOIN users u ON u.id = c.checked_out_by
    WHERE c.returned_at IS NULL AND c.expected_return_at IS NOT NULL
    GROUP BY c.id
    ORDER BY julianday(c.expected_return_at) ASC, c.id ASC
  `;
  return rows.map((r) => ({ ...r, is_nfc_checkout: Boolean(r.is_nfc_checkout) }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function processReturnReminders(options?: {
  origin?: string;
  force?: boolean;
}): Promise<ReminderProcessResult> {
  const pendingRows = await getPendingReturnReminders();
  // At most one reminder per checkout per run, even if the query ever returned duplicates.
  const seen = new Set<number>();
  const pending = pendingRows.filter((p) => (seen.has(p.checkout_id) ? false : (seen.add(p.checkout_id), true)));
  const nowTime = Date.now();

  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let noLinkedAccountCount = 0;
  const remindersResult: ReminderProcessResult["reminders"] = [];

  const skip = (item: PendingReturnReminderItem, type: ReminderType, reason: string, email = item.borrower_email || "") => {
    skippedCount++;
    remindersResult.push({
      checkoutId: item.checkout_id,
      equipmentId: item.equipment_id,
      equipmentName: item.equipment_name,
      recipientName: item.borrower_name,
      recipientEmail: email,
      type,
      status: "skipped",
      reason,
    });
  };

  for (const item of pending) {
    const expected = parseDueDate(item.expected_return_at);
    const expectedTime = expected ? expected.getTime() : NaN;
    if (isNaN(expectedTime)) {
      skip(item, "overdue", "Invalid expected_return_at timestamp");
      continue;
    }

    const diffMs = expectedTime - nowTime;
    let reminderType: ReminderType;
    let windowKey: string;

    if (diffMs < 0) {
      // Past due date => OVERDUE, at most once per 24 hours (one window per overdue day).
      reminderType = "overdue";
      windowKey = `overdue:${item.expected_return_at}:${Math.floor(-diffMs / DAY_MS)}`;
      if (!options?.force && item.last_overdue_sent) {
        const lastSentTime = parseDbDate(item.last_overdue_sent)?.getTime() ?? NaN;
        if (!isNaN(lastSentTime) && nowTime - lastSentTime < DAY_MS) {
          skip(item, "overdue", "Overdue reminder already sent in last 24 hours");
          continue;
        }
      }
    } else if (diffMs <= DAY_MS) {
      // Due within the next 24 hours => DUE SOON (once per due date).
      reminderType = "due_soon";
      windowKey = `due_soon:${item.expected_return_at}`;
      if (!options?.force && item.last_due_soon_sent) {
        skip(item, "due_soon", "Due soon reminder already dispatched");
        continue;
      }
    } else {
      skip(item, "due_soon", "Due date is more than 24 hours away");
      continue;
    }
    if (options?.force) {
      windowKey = `manual:${new Date(nowTime).toISOString()}`;
    }

    if (!item.borrower_email) {
      if (item.checked_out_by === null) {
        // Not attributed to any account (NFC station or a guest name): never guess by name.
        noLinkedAccountCount++;
        skip(
          item,
          reminderType,
          item.is_nfc_checkout
            ? `No email address found: NFC checkout by "${item.checked_out_by_name}" has no linked account`
            : `No email address found: checkout by "${item.checked_out_by_name}" has no linked account`,
          ""
        );
      } else {
        skip(item, reminderType, `No email address found for borrower "${item.borrower_name}"`, "");
      }
      continue;
    }

    // Claim the (checkout, type, window) slot first so a concurrent run can't send it too.
    let claim: CheckoutReminder | null;
    try {
      claim = await claimCheckoutReminder(item.checkout_id, reminderType, item.borrower_email, windowKey);
    } catch (err) {
      errorCount++;
      remindersResult.push({
        checkoutId: item.checkout_id,
        equipmentId: item.equipment_id,
        equipmentName: item.equipment_name,
        recipientName: item.borrower_name,
        recipientEmail: item.borrower_email,
        type: reminderType,
        status: "failed",
        reason: err instanceof Error ? err.message : "Could not record reminder",
      });
      continue;
    }
    if (!claim) {
      skip(item, reminderType, "Reminder for this window was already sent by another run");
      continue;
    }

    try {
      const emailRes = await sendOverdueReminderEmail({
        toEmail: item.borrower_email,
        recipientName: item.borrower_name,
        equipmentId: item.equipment_id,
        equipmentName: item.equipment_name,
        serialNumber: item.equipment_serial_number,
        location: item.equipment_location,
        checkedOutAt: item.checked_out_at,
        expectedReturnAt: item.expected_return_at,
        notes: item.notes,
        isOverdue: reminderType === "overdue",
        origin: options?.origin,
      });

      if (emailRes.success) {
        sentCount++;
        remindersResult.push({
          checkoutId: item.checkout_id,
          equipmentId: item.equipment_id,
          equipmentName: item.equipment_name,
          recipientName: item.borrower_name,
          recipientEmail: item.borrower_email,
          type: reminderType,
          status: "sent",
        });
      } else {
        await releaseCheckoutReminder(claim.id).catch(() => undefined);
        errorCount++;
        remindersResult.push({
          checkoutId: item.checkout_id,
          equipmentId: item.equipment_id,
          equipmentName: item.equipment_name,
          recipientName: item.borrower_name,
          recipientEmail: item.borrower_email,
          type: reminderType,
          status: "failed",
          reason: emailRes.error || "Email transport failure",
        });
      }
    } catch (err: unknown) {
      await releaseCheckoutReminder(claim.id).catch(() => undefined);
      errorCount++;
      remindersResult.push({
        checkoutId: item.checkout_id,
        equipmentId: item.equipment_id,
        equipmentName: item.equipment_name,
        recipientName: item.borrower_name,
        recipientEmail: item.borrower_email,
        type: reminderType,
        status: "failed",
        reason: err instanceof Error ? err.message : "Unexpected reminder dispatch error",
      });
    }
  }

  return {
    totalChecked: pending.length,
    sent: sentCount,
    skipped: skippedCount,
    errors: errorCount,
    noLinkedAccount: noLinkedAccountCount,
    reminders: remindersResult,
  };
}

// ---------------------------------------------------------------------------
// Reservations (Feature 2)
// ---------------------------------------------------------------------------

/** Kept for backwards compatibility; the table comes from migrations / SCHEMA_SQL (no DDL here). */
export async function ensureReservationsTable(): Promise<void> {
  await ensureSchema();
}

/** Parses a reservation timestamp (ISO, or SQLite "YYYY-MM-DD HH:MM:SS" as UTC) to ISO-8601 UTC. */
function parseReservationTime(value: unknown, field: string): { iso: string; ms: number } {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new ReservationValidationError(`${field} must be a date/time string.`);
  }
  const d = parseDbDate(value);
  if (!d) {
    throw new ReservationValidationError(`${field} is not a valid date/time.`);
  }
  return { iso: d.toISOString(), ms: d.getTime() };
}

/** Reservations may start at most this far in the past (clock skew between client and server). */
export const RESERVATION_PAST_SKEW_MS = 5 * 60 * 1000;
/** Longest allowed reservation. */
export const RESERVATION_MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
/** Max length of reservation notes / purpose. */
export const RESERVATION_NOTES_MAX_LENGTH = 1000;

const UNRESERVABLE_CONDITIONS = ["Retired", "Missing", "Broken"] as const;

/** SQL predicate (alias `e`): the item can be reserved (not retired/missing/broken/unavailable). */
const RESERVABLE_EQUIPMENT_SQL =
  "e.condition NOT IN ('Retired', 'Missing', 'Broken') AND e.status NOT LIKE 'Unavailable%'";

async function assertReservableEquipment(equipmentId: number): Promise<{ id: number; name: string; condition: Condition; status: EquipmentStatus }> {
  const { rows } = await sql<{ id: number; name: string; condition: Condition; status: EquipmentStatus }>`
    SELECT id, name, condition, status FROM equipment WHERE id = ${equipmentId}
  `;
  const eq = rows[0];
  if (!eq) throw new ReservationValidationError("Equipment not found.");
  if ((UNRESERVABLE_CONDITIONS as readonly string[]).includes(eq.condition)) {
    throw new ReservationValidationError(`"${eq.name}" cannot be reserved: its condition is ${eq.condition}.`);
  }
  if (eq.status.startsWith("Unavailable")) {
    throw new ReservationValidationError(`"${eq.name}" cannot be reserved: it is ${eq.status}.`);
  }
  return eq;
}

/**
 * Throws ReservationValidationError when the timestamps are invalid or the equipment id is not a
 * positive integer / does not exist.
 */
export async function checkReservationConflict(
  equipmentId: number,
  startTime: string,
  endTime: string,
  excludeReservationId?: number
): Promise<ReservationConflictCheck> {
  await ensureReservationsTable();
  if (!Number.isInteger(equipmentId) || equipmentId <= 0) {
    throw new ReservationValidationError("Invalid equipment ID.");
  }
  startTime = parseReservationTime(startTime, "start_time").iso;
  endTime = parseReservationTime(endTime, "end_time").iso;
  const exists = await sql`SELECT 1 FROM equipment WHERE id = ${equipmentId}`;
  if (exists.rows.length === 0) {
    throw new ReservationValidationError("Equipment not found.");
  }

  // 1. Conflicting active reservations. Timestamps are compared via julianday() so ISO
  // ("...T10:00:00.000Z") and SQLite ("... 10:00:00") formats compare correctly.
  const { rows: conflictingReservations } = await sql<Reservation>`
    SELECT r.*, e.name AS equipment_name, e.serial_number AS equipment_serial_number, e.location AS equipment_location
    FROM reservations r
    JOIN equipment e ON e.id = r.equipment_id
    WHERE r.equipment_id = ${equipmentId}
      AND r.status = 'confirmed'
      AND (${excludeReservationId ?? null} IS NULL OR r.id != ${excludeReservationId ?? null})
      AND julianday(r.start_time) < julianday(${endTime})
      AND julianday(r.end_time) > julianday(${startTime})
    ORDER BY julianday(r.start_time) ASC
  `;

  // 2. Active checkout check (if the reservation starts in the past or now, and item is currently out)
  const activeCheckoutRes = await sql<{
    id: number;
    checked_out_by_name: string;
    expected_return_at: string | null;
  }>`
    SELECT id, checked_out_by_name, expected_return_at
    FROM checkouts
    WHERE equipment_id = ${equipmentId} AND returned_at IS NULL
    LIMIT 1
  `;
  const activeCheckout = activeCheckoutRes.rows[0] ?? null;

  const hasConflict = conflictingReservations.length > 0;

  // 3. Find available alternatives with similar tags if conflict exists
  const alternatives: Equipment[] = [];
  if (hasConflict) {
    const allEq = await getAllEquipment();
    const targetEq = allEq.find((e) => e.id === equipmentId);
    if (targetEq && targetEq.tags.length > 0) {
      for (const candidate of allEq) {
        if (candidate.id === equipmentId) continue;
        if (candidate.status !== "Available" && candidate.status !== "Checked Out") continue;
        const hasCommonTag = candidate.tags.some((t) => targetEq.tags.includes(t));
        if (hasCommonTag) {
          const candConf = await sql`
            SELECT id FROM reservations
            WHERE equipment_id = ${candidate.id}
              AND status = 'confirmed'
              AND julianday(start_time) < julianday(${endTime})
              AND julianday(end_time) > julianday(${startTime})
            LIMIT 1
          `;
          if (candConf.rows.length === 0) {
            alternatives.push(candidate);
            if (alternatives.length >= 4) break;
          }
        }
      }
    }
  }

  return {
    hasConflict,
    conflictingReservations,
    activeCheckout,
    alternatives,
  };
}

function validateReservationText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ReservationValidationError(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > RESERVATION_NOTES_MAX_LENGTH) {
    throw new ReservationValidationError(`${field} cannot exceed ${RESERVATION_NOTES_MAX_LENGTH} characters.`);
  }
  return trimmed || null;
}

/**
 * Creates a confirmed reservation.
 *
 * Throws ReservationValidationError (subclass of Error; map to 400) when: the equipment/user ids
 * are invalid, the equipment doesn't exist or is Retired/Missing/Broken/Unavailable, a timestamp
 * is invalid, start >= end, start is more than 5 minutes in the past, the duration exceeds
 * 30 days, or notes/purpose is not a string or is longer than 1000 characters.
 * Throws a plain Error whose message contains "already reserved" on an overlap (map to 409).
 */
export async function createReservation(params: {
  equipment_id: number;
  reserved_by: number;
  reserved_by_name: string;
  start_time: string;
  end_time: string;
  notes?: string | null;
  /** Optional alias for notes (used when notes is empty). Same validation as notes. */
  purpose?: string | null;
}): Promise<Reservation> {
  await ensureReservationsTable();
  if (!Number.isInteger(params.equipment_id) || params.equipment_id <= 0) {
    throw new ReservationValidationError("Invalid equipment ID.");
  }
  if (!Number.isInteger(params.reserved_by) || params.reserved_by <= 0) {
    throw new ReservationValidationError("Invalid user ID.");
  }
  const reservedByName =
    typeof params.reserved_by_name === "string" ? params.reserved_by_name.trim().slice(0, 200) : "";
  if (!reservedByName) {
    throw new ReservationValidationError("reserved_by_name is required.");
  }
  const notes = validateReservationText(params.notes, "notes") ?? validateReservationText(params.purpose, "purpose");

  const start = parseReservationTime(params.start_time, "start_time");
  const end = parseReservationTime(params.end_time, "end_time");
  if (start.ms >= end.ms) {
    throw new ReservationValidationError("Invalid timeframe: start_time must be strictly before end_time.");
  }
  if (start.ms < Date.now() - RESERVATION_PAST_SKEW_MS) {
    throw new ReservationValidationError("Reservations cannot start in the past.");
  }
  if (end.ms - start.ms > RESERVATION_MAX_DURATION_MS) {
    throw new ReservationValidationError("Reservations cannot be longer than 30 days.");
  }
  // Always store ISO-8601 UTC so every reservation timestamp has the same format.
  const startIso = start.iso;
  const endIso = end.iso;

  await assertReservableEquipment(params.equipment_id);

  const conflictError = (c: Reservation) =>
    new Error(
      `Equipment already reserved between ${formatLongDateTime(c.start_time)} and ${formatLongDateTime(c.end_time)}.`
    );

  const conflict = await checkReservationConflict(params.equipment_id, startIso, endIso);
  if (conflict.hasConflict) {
    throw conflictError(conflict.conflictingReservations[0]);
  }

  // The overlap and availability checks are repeated inside the INSERT itself, so two
  // concurrent requests for overlapping slots can't both pass the checks above and both be
  // inserted, and an item retired meanwhile can't be reserved.
  const { rows } = await query<Reservation>(
    `INSERT INTO reservations (equipment_id, reserved_by, reserved_by_name, start_time, end_time, status, notes)
     SELECT ?, ?, ?, ?, ?, 'confirmed', ?
     WHERE EXISTS (SELECT 1 FROM equipment e WHERE e.id = ? AND ${RESERVABLE_EQUIPMENT_SQL})
       AND NOT EXISTS (
         SELECT 1 FROM reservations r
         WHERE r.equipment_id = ?
           AND r.status = 'confirmed'
           AND julianday(r.start_time) < julianday(?)
           AND julianday(r.end_time) > julianday(?)
       )
     RETURNING *`,
    [
      params.equipment_id,
      params.reserved_by,
      reservedByName,
      startIso,
      endIso,
      notes,
      params.equipment_id,
      params.equipment_id,
      endIso,
      startIso,
    ]
  );

  if (rows.length === 0) {
    await assertReservableEquipment(params.equipment_id);
    const recheck = await checkReservationConflict(params.equipment_id, startIso, endIso);
    if (recheck.conflictingReservations.length > 0) {
      throw conflictError(recheck.conflictingReservations[0]);
    }
    throw new Error("Equipment already reserved for an overlapping timeframe.");
  }

  const newRes = rows[0];
  const eq = await getEquipmentById(params.equipment_id);

  // Send webhook notification (times in the club's time zone, not the Worker's UTC).
  await sendClubWebhook({
    event: "reservation.created",
    title: `📅 New Reservation: ${eq?.name || "Equipment"}`,
    description: `**${reservedByName}** has reserved **${eq?.name || "Equipment"}** from ${formatLongDateTime(startIso)} to ${formatLongDateTime(endIso)}.`,
    fields: [
      { name: "Equipment", value: eq?.name || "N/A" },
      { name: "Location", value: eq?.location || "Media Room" },
      { name: "Reserved By", value: reservedByName },
      { name: "Notes", value: notes || "None" },
    ],
  });

  return {
    ...newRes,
    equipment_name: eq?.name,
    equipment_serial_number: eq?.serial_number,
    equipment_location: eq?.location,
  };
}

export async function getReservations(filter?: {
  equipment_id?: number;
  reserved_by?: number;
  status?: ReservationStatus;
}): Promise<Reservation[]> {
  await ensureReservationsTable();
  try {
    const { rows } = await sql<Reservation>`
      SELECT 
        r.*,
        e.name AS equipment_name,
        e.serial_number AS equipment_serial_number,
        e.location AS equipment_location,
        u.email AS borrower_email
      FROM reservations r
      JOIN equipment e ON e.id = r.equipment_id
      JOIN users u ON u.id = r.reserved_by
      WHERE (${filter?.equipment_id ?? null} IS NULL OR r.equipment_id = ${filter?.equipment_id})
        AND (${filter?.reserved_by ?? null} IS NULL OR r.reserved_by = ${filter?.reserved_by})
        AND (${filter?.status ?? null} IS NULL OR r.status = ${filter?.status})
      ORDER BY r.start_time ASC
    `;
    return rows;
  } catch (err: any) {
    console.warn("Notice: getReservations fallback catch:", err);
    return [];
  }
}

export async function getReservationById(id: number): Promise<Reservation | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  await ensureReservationsTable();
  const { rows } = await sql<Reservation>`
    SELECT 
      r.*,
      e.name AS equipment_name,
      e.serial_number AS equipment_serial_number,
      e.location AS equipment_location,
      u.email AS borrower_email
    FROM reservations r
    JOIN equipment e ON e.id = r.equipment_id
    JOIN users u ON u.id = r.reserved_by
    WHERE r.id = ${id}
  `;
  return rows[0];
}

export async function cancelReservation(
  id: number,
  userId?: number,
  isAdmin?: boolean
): Promise<{ success: boolean; error?: string }> {
  const res = await getReservationById(id);
  if (!res) return { success: false, error: "Reservation not found." };
  // Fail closed: a non-admin must supply a valid user id that owns the reservation
  // (a missing / NaN / 0 id used to skip the ownership check entirely).
  if (!isAdmin) {
    if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0 || res.reserved_by !== userId) {
      return { success: false, error: "Forbidden: You can only cancel your own reservations." };
    }
  }
  if (res.status !== "confirmed") {
    return { success: false, error: `Cannot cancel reservation in ${res.status} status.` };
  }

  // Atomic transition: fails if another request cancelled/fulfilled it meanwhile.
  const transition = await sql`UPDATE reservations SET status = 'cancelled' WHERE id = ${id} AND status = 'confirmed'`;
  if (transition.rowCount !== 1) {
    return { success: false, error: "Reservation is no longer confirmed." };
  }

  await sendClubWebhook({
    event: "reservation.cancelled",
    title: `❌ Reservation Cancelled: ${res.equipment_name || "Equipment"}`,
    description: `Reservation #${id} for **${res.equipment_name}** by **${res.reserved_by_name}** was cancelled.`,
  });

  return { success: true };
}

export async function fulfillReservation(
  id: number
): Promise<{ success: boolean; checkout?: Checkout; error?: string }> {
  const res = await getReservationById(id);
  if (!res) return { success: false, error: "Reservation not found." };
  if (res.status !== "confirmed") {
    return { success: false, error: `Reservation is already ${res.status}.` };
  }

  // Claim the reservation first so two concurrent fulfils can't both create a checkout.
  const transition = await sql`UPDATE reservations SET status = 'fulfilled' WHERE id = ${id} AND status = 'confirmed'`;
  if (transition.rowCount !== 1) {
    return { success: false, error: "Reservation is no longer confirmed." };
  }

  try {
    const checkout = await createCheckout({
      equipment_id: res.equipment_id,
      checked_out_by: res.reserved_by,
      checked_out_by_name: res.reserved_by_name,
      expected_return_at: res.end_time,
      notes: res.notes ? `[Fulfilled Reservation #${id}] ${res.notes}` : `Fulfilled Reservation #${id}`,
    });
    return { success: true, checkout };
  } catch (err) {
    // Checkout failed: put the reservation back so it can be fulfilled later.
    await sql`UPDATE reservations SET status = 'confirmed' WHERE id = ${id} AND status = 'fulfilled'`;
    return { success: false, error: err instanceof Error ? err.message : "Failed to convert reservation to checkout." };
  }
}

// ---------------------------------------------------------------------------
// Handover Protocol (Feature 3)
// ---------------------------------------------------------------------------

/** Kept for backwards compatibility; the table comes from migrations / SCHEMA_SQL (no DDL here). */
export async function ensureHandoverTable(): Promise<void> {
  await ensureSchema();
}

/** "HD-" followed by 6 cryptographically random digits, e.g. "HD-048213". */
function generateRandomHandoverCode(): string {
  const buf = new Uint32Array(1);
  // Rejection sampling keeps every 6-digit value equally likely.
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return `HD-${String(buf[0] % 1_000_000).padStart(6, "0")}`;
}

/**
 * Handovers are only allowed for checkouts made under an admin account, and never for
 * NFC-station checkouts. Returns an error message, or null if the checkout qualifies.
 */
async function getHandoverIneligibility(checkout: Checkout): Promise<string | null> {
  if (checkout.nfc_value || checkout.nfc_id || checkout.checked_out_by === null) {
    return "Handover is not available for equipment checked out through the NFC station.";
  }
  const borrower = await getUserById(checkout.checked_out_by);
  if (borrower?.role !== "admin") {
    return "Handover is only available for equipment checked out under an admin account.";
  }
  return null;
}

export async function createHandoverCode(
  checkoutId: number,
  fromUserId: number
): Promise<HandoverCode> {
  await ensureHandoverTable();
  const chRes = await sql<Checkout>`
    SELECT * FROM checkouts WHERE id = ${checkoutId} AND returned_at IS NULL
  `;
  if (chRes.rows.length === 0) {
    throw new Error("Cannot create handover: Active loan not found.");
  }
  const checkout = chRes.rows[0];
  const ineligible = await getHandoverIneligibility(checkout);
  if (ineligible) throw new Error(ineligible);
  if (checkout.checked_out_by !== fromUserId) {
    const userRes = await getUserById(fromUserId);
    if (userRes?.role !== "admin") {
      throw new Error("Forbidden: You can only handover equipment checked out to you.");
    }
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  let inserted: HandoverCode | undefined;
  // Codes are UNIQUE across all historical rows, so retry on the rare collision.
  for (let attempt = 0; attempt < 8 && !inserted; attempt++) {
    const code = generateRandomHandoverCode();
    const qrPayload = JSON.stringify({
      type: "MEDIAHUB_HANDOVER",
      code,
      checkout_id: checkoutId,
      equipment_id: checkout.equipment_id,
      exp: expiresAt,
    });
    try {
      const { rows } = await sql<HandoverCode>`
        INSERT INTO handover_codes (checkout_id, equipment_id, from_user_id, code, qr_payload, expires_at, status)
        VALUES (${checkoutId}, ${checkout.equipment_id}, ${fromUserId}, ${code}, ${qrPayload}, ${expiresAt}, 'active')
        RETURNING *
      `;
      inserted = rows[0];
    } catch (err) {
      if (!(err instanceof Error) || !/UNIQUE/i.test(err.message)) throw err;
    }
  }
  if (!inserted) {
    throw new Error("Could not generate a unique handover code. Please try again.");
  }

  // Only one code per loan: revoke any earlier active codes now that the new one exists.
  await sql`UPDATE handover_codes SET status = 'revoked' WHERE checkout_id = ${checkoutId} AND status = 'active' AND id != ${inserted.id}`;

  const eq = await getEquipmentById(checkout.equipment_id);
  const fromUser = await getUserById(fromUserId);

  return {
    ...inserted,
    equipment_name: eq?.name,
    equipment_serial_number: eq?.serial_number,
    from_user_name: fromUser?.name ?? checkout.checked_out_by_name,
  };
}

/** Accepts "HD-123456", "hd-123456" or just "123456". */
export function normalizeHandoverCode(code: string): string {
  const clean = code.trim().toUpperCase();
  return /^\d{6}$/.test(clean) ? `HD-${clean}` : clean;
}

export async function getHandoverCodeByCode(code: string): Promise<HandoverCode | undefined> {
  await ensureHandoverTable();
  const cleanCode = normalizeHandoverCode(code);
  const { rows } = await sql<HandoverCode>`
    SELECT
      h.*,
      e.name AS equipment_name,
      e.serial_number AS equipment_serial_number,
      u1.name AS from_user_name,
      u2.name AS claimed_by_name
    FROM handover_codes h
    JOIN equipment e ON e.id = h.equipment_id
    JOIN users u1 ON u1.id = h.from_user_id
    LEFT JOIN users u2 ON u2.id = h.claimed_by
    WHERE UPPER(h.code) = ${cleanCode}
  `;
  return rows[0];
}

export const getHandoverCodeDetails = getHandoverCodeByCode;

export async function generateHandoverCode(params: {
  equipment_id: number;
  from_user_id: number;
}): Promise<HandoverCode> {
  const activeCheckout = await getActiveCheckoutByEquipmentId(params.equipment_id);
  if (!activeCheckout) {
    throw new Error("Cannot handover equipment that is not checked out.");
  }
  return createHandoverCode(activeCheckout.id, params.from_user_id);
}

export async function claimHandoverCode(params: {
  code: string;
  claimed_by_id: number;
  claimed_by_name: string;
  notes?: string | null;
}): Promise<{ success: boolean; checkout?: Checkout; error?: string }> {
  await ensureHandoverTable();
  const handover = await getHandoverCodeByCode(params.code);
  if (!handover) return { success: false, error: "Invalid handover code." };

  if (handover.status !== "active") {
    return { success: false, error: `Handover code is ${handover.status}.` };
  }

  if (new Date() > new Date(handover.expires_at)) {
    await sql`UPDATE handover_codes SET status = 'expired' WHERE id = ${handover.id} AND status = 'active'`;
    return { success: false, error: "Handover code has expired. Please ask the borrower to generate a fresh code." };
  }

  const chRes = await sql<Checkout>`SELECT * FROM checkouts WHERE id = ${handover.checkout_id}`;
  const oldCheckout = chRes.rows[0];
  if (!oldCheckout || oldCheckout.returned_at) {
    await sql`UPDATE handover_codes SET status = 'revoked' WHERE id = ${handover.id} AND status = 'active'`;
    return { success: false, error: "This loan has already ended, so the handover code is no longer valid." };
  }

  if (handover.from_user_id === params.claimed_by_id || oldCheckout.checked_out_by === params.claimed_by_id) {
    return { success: false, error: "Cannot handover equipment to yourself." };
  }

  const ineligible = await getHandoverIneligibility(oldCheckout);
  if (ineligible) {
    await sql`UPDATE handover_codes SET status = 'revoked' WHERE id = ${handover.id} AND status = 'active'`;
    return { success: false, error: ineligible };
  }

  // 1. Atomically consume the code. Only one concurrent claim can win this UPDATE, and
  //    once claimed the code can never be used again.
  const claim = await sql`
    UPDATE handover_codes
    SET status = 'claimed',
        claimed_by = ${params.claimed_by_id},
        claimed_at = datetime('now')
    WHERE id = ${handover.id}
      AND status = 'active'
      AND julianday(expires_at) > julianday('now')
  `;
  if (claim.rowCount === 0) {
    return { success: false, error: "Handover code is no longer valid." };
  }

  // 2. Close the old checkout with a transfer note (only if it is still open).
  const closed = await sql`
    UPDATE checkouts
    SET returned_at = datetime('now'),
        notes = COALESCE(notes || ' | ', '') || 'Handed over to ' || ${params.claimed_by_name}
    WHERE id = ${handover.checkout_id} AND returned_at IS NULL
  `;
  if (closed.rowCount === 0) {
    await sql`UPDATE handover_codes SET status = 'revoked' WHERE id = ${handover.id}`;
    return { success: false, error: "This loan has already ended, so the handover code is no longer valid." };
  }

  // 3. Cancel any other outstanding codes for the loan that was just handed over.
  await sql`UPDATE handover_codes SET status = 'revoked' WHERE checkout_id = ${handover.checkout_id} AND status = 'active'`;

  // 4. Open new checkout for recipient
  const expectedReturn = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const notesText = params.notes
    ? `[Handover from ${handover.from_user_name || "previous borrower"}] ${params.notes}`
    : `Handover from ${handover.from_user_name || "previous borrower"}`;

  let newCheckout: Checkout;
  try {
    const { rows } = await sql<Checkout>`
      INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, expected_return_at, notes, checkout_location)
      VALUES (${handover.equipment_id}, ${params.claimed_by_id}, ${params.claimed_by_name}, ${expectedReturn}, ${notesText}, 'Direct Handover')
      RETURNING *
    `;
    newCheckout = rows[0];
  } catch (err) {
    // Couldn't open the recipient's loan: give the item back to the original borrower so it
    // isn't left "Checked Out" with no open checkout. The code stays consumed.
    await sql`UPDATE checkouts SET returned_at = NULL, notes = ${oldCheckout.notes ?? null} WHERE id = ${handover.checkout_id}`;
    await sql`UPDATE handover_codes SET status = 'revoked' WHERE id = ${handover.id}`;
    throw err;
  }
  // The item stays out on loan, now to the recipient.
  await sql`UPDATE equipment SET status = 'Checked Out', updated_at = CURRENT_TIMESTAMP WHERE id = ${handover.equipment_id}`;


  // 5. Send club webhook alert
  await sendClubWebhook({
    event: "handover.completed",
    title: `🤝 Equipment Handover: ${handover.equipment_name || "Equipment"}`,
    description: `**${handover.from_user_name || "Borrower"}** transferred **${handover.equipment_name}** directly to **${params.claimed_by_name}**.`,
    fields: [
      { name: "Equipment", value: handover.equipment_name || "N/A" },
      { name: "From", value: handover.from_user_name || "N/A" },
      { name: "To", value: params.claimed_by_name },
      { name: "Expected Return", value: formatLongDateTime(expectedReturn) },
    ],
  });

  return { success: true, checkout: newCheckout };
}

// ---------------------------------------------------------------------------
// Physical Inventory Audit Mode (Feature 5)
// ---------------------------------------------------------------------------

/** Kept for backwards compatibility; the tables come from migrations / SCHEMA_SQL (no DDL here). */
export async function ensureAuditTables(): Promise<void> {
  await ensureSchema();
}

export async function startAuditSession(params: {
  name: string;
  started_by: number;
  notes?: string | null;
}): Promise<AuditSession> {
  await ensureAuditTables();

  // Cancel any existing in_progress audit session to prevent overlap
  await sql`UPDATE audit_sessions SET status = 'cancelled' WHERE status = 'in_progress'`;

  // Keep the starter's name on the session so it survives the user being deleted.
  const starter = await getUserById(params.started_by);
  const { rows } = await sql<AuditSession>`
    INSERT INTO audit_sessions (name, started_by, started_by_name, status, notes)
    VALUES (${params.name}, ${params.started_by}, ${starter?.name ?? null}, 'in_progress', ${params.notes ?? null})
    RETURNING *
  `;
  const session = rows[0];

  await sql`
    INSERT INTO audit_records (session_id, equipment_id, status)
    SELECT ${session.id}, id, 'missing' FROM equipment
    WHERE condition != 'Retired' AND status != 'Unavailable (Retired)'
    ON CONFLICT DO NOTHING
  `;

  await recountAuditSession(session.id);
  const updated = (await sql<AuditSession>`SELECT * FROM audit_sessions WHERE id = ${session.id}`).rows[0];

  return updated ?? session;
}

/** Recomputes a session's counters from its audit_records in one statement (race-safe). */
async function recountAuditSession(sessionId: number): Promise<void> {
  await sql`
    UPDATE audit_sessions
    SET
      total_items = (SELECT COUNT(*) FROM audit_records WHERE session_id = ${sessionId}),
      found_count = (SELECT COUNT(*) FROM audit_records WHERE session_id = ${sessionId} AND status = 'exists'),
      missing_count = (SELECT COUNT(*) FROM audit_records WHERE session_id = ${sessionId} AND status = 'missing')
    WHERE id = ${sessionId}
  `;
}

export async function getActiveAuditSession(): Promise<AuditSession | null> {
  await ensureAuditTables();
  try {
    const { rows } = await sql<AuditSession>`
      SELECT a.*, COALESCE(u.name, a.started_by_name) AS started_by_name
      FROM audit_sessions a
      LEFT JOIN users u ON u.id = a.started_by
      WHERE a.status = 'in_progress'
      ORDER BY a.started_at DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (err: any) {
    console.warn("Notice: getActiveAuditSession fallback catch:", err);
    return null;
  }
}

export async function recordAuditScan(params: {
  session_id: number;
  equipment_identifier: string;
  scanned_by: number;
  method: "nfc" | "qr" | "manual";
}): Promise<{ success: boolean; record?: AuditRecord; error?: string; alreadyScanned?: boolean }> {
  await ensureAuditTables();
  const rawId = params.equipment_identifier.trim();
  if (!rawId) return { success: false, error: "Empty equipment identifier." };

  const sessionCheck = await sql<{ status: AuditSessionStatus }>`
    SELECT status FROM audit_sessions WHERE id = ${params.session_id}
  `;
  if (sessionCheck.rows.length === 0) {
    return { success: false, error: "Audit session not found." };
  }
  if (sessionCheck.rows[0].status !== "in_progress") {
    return { success: false, error: `Audit session is ${sessionCheck.rows[0].status}; scans are no longer accepted.` };
  }

  let eq: { id: number; name: string; serial_number: string | null; location: string; condition: Condition; status: EquipmentStatus } | undefined;
  if (/^\d+$/.test(rawId)) {
    const detail = await getEquipmentById(Number(rawId));
    if (detail) eq = detail;
  }
  if (!eq) {
    const bySerial = await sql<{ id: number; name: string; serial_number: string | null; location: string; condition: Condition; status: EquipmentStatus }>`SELECT id, name, serial_number, location, condition, status FROM equipment WHERE LOWER(serial_number) = LOWER(${rawId}) LIMIT 1`;
    eq = bySerial.rows[0];
  }
  if (!eq) {
    const byName = await sql<{ id: number; name: string; serial_number: string | null; location: string; condition: Condition; status: EquipmentStatus }>`SELECT id, name, serial_number, location, condition, status FROM equipment WHERE LOWER(name) = LOWER(${rawId}) LIMIT 1`;
    eq = byName.rows[0];
  }
  if (!eq) {
    return { success: false, error: `Equipment "${rawId}" not found in inventory.` };
  }

  // Single upsert: marks the item found only while the session is still in progress, and
  // only if it wasn't already found (changes = 0 in both of those cases).
  const upsert = await sql`
    INSERT INTO audit_records (session_id, equipment_id, status, scanned_at, scanned_by, method)
    SELECT ${params.session_id}, ${eq.id}, 'exists', CURRENT_TIMESTAMP, ${params.scanned_by}, ${params.method}
    WHERE EXISTS (SELECT 1 FROM audit_sessions WHERE id = ${params.session_id} AND status = 'in_progress')
    ON CONFLICT(session_id, equipment_id) DO UPDATE SET
      status = 'exists',
      scanned_at = excluded.scanned_at,
      scanned_by = excluded.scanned_by,
      method = excluded.method
    WHERE audit_records.status <> 'exists'
  `;

  if (upsert.rowCount === 0) {
    const existing = (
      await sql<AuditRecord>`SELECT * FROM audit_records WHERE session_id = ${params.session_id} AND equipment_id = ${eq.id}`
    ).rows[0];
    if (existing?.status === "exists") {
      return {
        success: true,
        alreadyScanned: true,
        record: {
          ...existing,
          equipment_name: eq.name,
          equipment_serial_number: eq.serial_number,
          equipment_location: eq.location,
        },
      };
    }
    // The session was completed/cancelled between the check above and the upsert.
    return { success: false, error: "Audit session is no longer in progress; scans are no longer accepted." };
  }

  // Recompute counters from the records instead of incrementing, so concurrent scans
  // can never drift the totals.
  await recountAuditSession(params.session_id);

  const updatedRec = (await sql<AuditRecord>`
    SELECT a.*, u.name AS scanned_by_name
    FROM audit_records a
    LEFT JOIN users u ON u.id = a.scanned_by
    WHERE a.session_id = ${params.session_id} AND a.equipment_id = ${eq.id}
  `).rows[0];

  return {
    success: true,
    record: {
      ...updatedRec,
      equipment_name: eq.name,
      equipment_serial_number: eq.serial_number,
      equipment_location: eq.location,
      equipment_condition: eq.condition,
      equipment_status: eq.status,
    },
  };
}

export async function completeAuditSession(
  sessionId: number,
  options?: { markMissingAsCatalogMissing?: boolean }
): Promise<{ success: boolean; session?: AuditSession; error?: string }> {
  await ensureAuditTables();
  const sessionRes = await sql<AuditSession>`SELECT * FROM audit_sessions WHERE id = ${sessionId}`;
  if (sessionRes.rows.length === 0) return { success: false, error: "Audit session not found." };
  const session = sessionRes.rows[0];
  if (session.status !== "in_progress") {
    return { success: false, error: `Audit session is already ${session.status}.` };
  }

  // Atomic transition: only one of several concurrent completes can win, so the
  // "mark missing" side effects below are applied at most once.
  await recountAuditSession(sessionId);
  const nowStr = new Date().toISOString();
  const transition = await sql`
    UPDATE audit_sessions
    SET status = 'completed', completed_at = ${nowStr}
    WHERE id = ${sessionId} AND status = 'in_progress'
  `;
  if (transition.rowCount !== 1) {
    return { success: false, error: "Audit session is no longer in progress." };
  }

  if (options?.markMissingAsCatalogMissing) {
    // Items that are currently checked out are accounted for, so they are not marked missing.
    const missingItems = await sql<{ equipment_id: number }>`
      SELECT ar.equipment_id FROM audit_records ar
      WHERE ar.session_id = ${sessionId} AND ar.status = 'missing'
        AND NOT EXISTS (
          SELECT 1 FROM checkouts c WHERE c.equipment_id = ar.equipment_id AND c.returned_at IS NULL
        )
    `;
    for (const item of missingItems.rows) {
      await updateEquipment(item.equipment_id, {
        condition: "Missing",
        status: "Unavailable (Missing)",
      });
    }
  }

  const updatedSession = (await sql<AuditSession>`SELECT * FROM audit_sessions WHERE id = ${sessionId}`).rows[0];

  await sendClubWebhook({
    event: "audit.completed",
    title: `📋 Inventory Roll Call Completed: ${session.name}`,
    description: `Audit finished: **${updatedSession.found_count} verified (exists)**, **${updatedSession.missing_count} missing** out of ${updatedSession.total_items} total items.`,
    fields: [
      { name: "Total Items", value: String(updatedSession.total_items) },
      { name: "Verified / Exists", value: `✅ ${updatedSession.found_count}` },
      { name: "Missing", value: `❌ ${updatedSession.missing_count}` },
    ],
  });

  return { success: true, session: updatedSession };
}

export async function getAuditSessionDetails(sessionId: number): Promise<{
  session: AuditSession;
  records: AuditRecord[];
} | null> {
  await ensureAuditTables();
  const sessionRes = await sql<AuditSession>`
    SELECT a.*, COALESCE(u.name, a.started_by_name) AS started_by_name
    FROM audit_sessions a
    LEFT JOIN users u ON u.id = a.started_by
    WHERE a.id = ${sessionId}
  `;
  if (sessionRes.rows.length === 0) return null;

  const recordsRes = await sql<AuditRecord>`
    SELECT 
      ar.*,
      e.name AS equipment_name,
      e.serial_number AS equipment_serial_number,
      e.location AS equipment_location,
      e.condition AS equipment_condition,
      e.status AS equipment_status,
      u.name AS scanned_by_name
    FROM audit_records ar
    JOIN equipment e ON e.id = ar.equipment_id
    LEFT JOIN users u ON u.id = ar.scanned_by
    WHERE ar.session_id = ${sessionId}
    ORDER BY ar.status ASC, ar.scanned_at DESC, e.name ASC
  `;

  return {
    session: sessionRes.rows[0],
    records: recordsRes.rows,
  };
}

// ---------------------------------------------------------------------------
// Storage Map (Feature 8)
// ---------------------------------------------------------------------------
// Storage Map (Feature 8 & Drag-and-Drop Designer)
// ---------------------------------------------------------------------------

export const STORAGE_MAP_MAX_CABINETS = 50;
export const STORAGE_MAP_MAX_SHELVES = 50;
export const STORAGE_MAP_NAME_MAX_LENGTH = 60;
export const STORAGE_MAP_DESCRIPTION_MAX_LENGTH = 200;

function slugId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cabinet";
}

function cleanMapText(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFC").replace(/\s+/g, " ").trim() : "";
}

/**
 * Validates and normalises a cabinets configuration. Throws StorageMapConfigError when it is not
 * an array of at most 50 `{ name, shelves }` objects where name is a non-empty string of at most
 * 60 characters and shelves is an array of at most 50 non-empty strings of at most 60
 * characters. Cabinet names (and shelf names within a cabinet) must be unique case-insensitively.
 * Names are trimmed with whitespace collapsed; ids default to a slug of the name.
 */
export function normalizeStorageMapConfig(input: unknown): StorageMapConfigCabinet[] {
  if (!Array.isArray(input)) {
    throw new StorageMapConfigError("Cabinets configuration must be an array.");
  }
  if (input.length > STORAGE_MAP_MAX_CABINETS) {
    throw new StorageMapConfigError(`A storage map can have at most ${STORAGE_MAP_MAX_CABINETS} cabinets.`);
  }
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  return input.map((raw, i) => {
    const label = `Cabinet ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new StorageMapConfigError(`${label} must be an object with a name and shelves.`);
    }
    const cab = raw as Record<string, unknown>;
    const name = cleanMapText(cab.name);
    if (!name) throw new StorageMapConfigError(`${label} needs a name.`);
    if (name.length > STORAGE_MAP_NAME_MAX_LENGTH) {
      throw new StorageMapConfigError(`Cabinet name "${name.slice(0, 20)}…" exceeds ${STORAGE_MAP_NAME_MAX_LENGTH} characters.`);
    }
    if (seenNames.has(name.toLowerCase())) {
      throw new StorageMapConfigError(`Duplicate cabinet name "${name}".`);
    }
    seenNames.add(name.toLowerCase());

    if (!Array.isArray(cab.shelves)) {
      throw new StorageMapConfigError(`Cabinet "${name}" must have a shelves array.`);
    }
    if (cab.shelves.length > STORAGE_MAP_MAX_SHELVES) {
      throw new StorageMapConfigError(`Cabinet "${name}" can have at most ${STORAGE_MAP_MAX_SHELVES} shelves.`);
    }
    const seenShelves = new Set<string>();
    const shelves = cab.shelves.map((s, j) => {
      if (typeof s !== "string") {
        throw new StorageMapConfigError(`Shelf ${j + 1} of cabinet "${name}" must be a string.`);
      }
      const shelf = cleanMapText(s);
      if (!shelf) throw new StorageMapConfigError(`Shelf ${j + 1} of cabinet "${name}" needs a name.`);
      if (shelf.length > STORAGE_MAP_NAME_MAX_LENGTH) {
        throw new StorageMapConfigError(
          `Shelf name "${shelf.slice(0, 20)}…" in cabinet "${name}" exceeds ${STORAGE_MAP_NAME_MAX_LENGTH} characters.`
        );
      }
      if (seenShelves.has(shelf.toLowerCase())) {
        throw new StorageMapConfigError(`Duplicate shelf "${shelf}" in cabinet "${name}".`);
      }
      seenShelves.add(shelf.toLowerCase());
      return shelf;
    });

    if (cab.description !== undefined && cab.description !== null && typeof cab.description !== "string") {
      throw new StorageMapConfigError(`Description of cabinet "${name}" must be a string.`);
    }
    const description = cleanMapText(cab.description).slice(0, STORAGE_MAP_DESCRIPTION_MAX_LENGTH);

    let id = typeof cab.id === "string" ? cab.id.trim().slice(0, 100) : "";
    if (!id || seenIds.has(id)) {
      const base = slugId(name);
      id = base;
      for (let n = 2; seenIds.has(id); n++) id = `${base}-${n}`;
    }
    seenIds.add(id);

    const out: StorageMapConfigCabinet = { id, name, shelves };
    if (description) out.description = description;
    return out;
  });
}

/**
 * Lenient version for data already stored: skips malformed cabinets/shelves (and duplicates or
 * anything beyond the limits) instead of throwing.
 */
function sanitizeStoredStorageMapConfig(input: unknown): StorageMapConfigCabinet[] {
  if (!Array.isArray(input)) return [];
  const result: StorageMapConfigCabinet[] = [];
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  for (const raw of input) {
    if (result.length >= STORAGE_MAP_MAX_CABINETS) break;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const cab = raw as Record<string, unknown>;
    const name = cleanMapText(cab.name).slice(0, STORAGE_MAP_NAME_MAX_LENGTH);
    if (!name || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    const shelves: string[] = [];
    const seenShelves = new Set<string>();
    for (const s of Array.isArray(cab.shelves) ? cab.shelves : []) {
      if (shelves.length >= STORAGE_MAP_MAX_SHELVES) break;
      const shelf = cleanMapText(s).slice(0, STORAGE_MAP_NAME_MAX_LENGTH);
      if (!shelf || seenShelves.has(shelf.toLowerCase())) continue;
      seenShelves.add(shelf.toLowerCase());
      shelves.push(shelf);
    }

    let id = typeof cab.id === "string" ? cab.id.trim().slice(0, 100) : "";
    if (!id || seenIds.has(id)) {
      const base = slugId(name);
      id = base;
      for (let n = 2; seenIds.has(id); n++) id = `${base}-${n}`;
    }
    seenIds.add(id);

    const description = cleanMapText(cab.description).slice(0, STORAGE_MAP_DESCRIPTION_MAX_LENGTH);
    const out: StorageMapConfigCabinet = { id, name, shelves };
    if (description) out.description = description;
    result.push(out);
  }
  return result;
}

/**
 * Returns the saved cabinets layout, or null when none is saved. Stored data that is malformed
 * (bad JSON, bad entries) is sanitised: bad entries are skipped, never thrown.
 */
export async function getStorageMapConfig(): Promise<StorageMapConfigCabinet[] | null> {
  await ensureSchema();
  let raw: string | undefined;
  try {
    const { rows } = await sql<{ value: string }>`
      SELECT value FROM storage_map_layout WHERE key = 'cabinets' LIMIT 1
    `;
    raw = rows[0]?.value;
  } catch (err) {
    console.error("[DB] Could not read storage_map_layout:", err);
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[DB] storage_map_layout 'cabinets' value is not valid JSON; ignoring it.");
    return null;
  }
  return sanitizeStoredStorageMapConfig(parsed);
}

/**
 * Validates, normalises and saves the cabinets layout (an empty array resets to defaults).
 * Throws StorageMapConfigError (subclass of Error; map to 400) for an invalid configuration.
 */
export async function saveStorageMapConfig(cabinets: StorageMapConfigCabinet[]): Promise<StorageMapConfigCabinet[]> {
  const normalized = normalizeStorageMapConfig(cabinets);
  await ensureSchema();
  const val = JSON.stringify(normalized);
  await sql`
    INSERT INTO storage_map_layout (key, value)
    VALUES ('cabinets', ${val})
    ON CONFLICT (key) DO UPDATE SET value = ${val}, updated_at = CURRENT_TIMESTAMP
  `;
  return normalized;
}

export async function getStorageMapData(): Promise<StorageCabinet[]> {
  await ensureSchema();
  const allEquipment = await getAllEquipment();
  const customConfig = await getStorageMapConfig();

  const cabinetsMap = new Map<string, { description?: string; shelvesMap: Map<string, Equipment[]> }>();

  // getStorageMapConfig already drops malformed entries; stay defensive anyway.
  if (customConfig && customConfig.length > 0) {
    for (const cab of customConfig) {
      if (!cab || typeof cab.name !== "string" || !cab.name || cabinetsMap.has(cab.name)) continue;
      const shelvesMap = new Map<string, Equipment[]>();
      for (const s of Array.isArray(cab.shelves) ? cab.shelves : []) {
        if (typeof s === "string" && s) shelvesMap.set(s, []);
      }
      cabinetsMap.set(cab.name, { description: cab.description, shelvesMap });
    }
  }
  if (cabinetsMap.size === 0) {
    const defaultCabinets = [
      "Cabinet 1 (Cameras & Video)",
      "Cabinet 2 (Lenses & Glass)",
      "Audio Rack",
      "Lighting & Grip Bay",
      "Cable & Accessories Bay",
    ];
    for (const c of defaultCabinets) {
      cabinetsMap.set(c, { shelvesMap: new Map([["Shelf A", []], ["Shelf B", []]]) });
    }
  }

  function resolveCabinetAndShelf(locRaw: string): { cabinet: string; shelf: string } {
    const loc = (locRaw || "General Storage").trim();

    // 1. Direct match with "Cabinet - Shelf" format
    if (loc.includes(" - ")) {
      const parts = loc.split(" - ");
      const cabName = parts[0].trim();
      const shelfName = parts.slice(1).join(" - ").trim();

      for (const existingCab of cabinetsMap.keys()) {
        if (existingCab.toLowerCase() === cabName.toLowerCase()) {
          return { cabinet: existingCab, shelf: shelfName || "Shelf A" };
        }
      }
      return { cabinet: cabName, shelf: shelfName || "Shelf A" };
    }

    // 2. Keyword matching for known defaults
    const lower = loc.toLowerCase();
    if (lower.includes("cabinet 1")) {
      const shelf = lower.includes("shelf b") ? "Shelf B" : lower.includes("shelf c") ? "Shelf C" : "Shelf A";
      return { cabinet: "Cabinet 1 (Cameras & Video)", shelf };
    }
    if (lower.includes("cabinet 2")) {
      const shelf = lower.includes("shelf b") ? "Shelf B" : lower.includes("shelf c") ? "Shelf C" : "Shelf A";
      return { cabinet: "Cabinet 2 (Lenses & Glass)", shelf };
    }
    if (lower.includes("lens") || lower.includes("locker")) {
      const shelf = lower.includes("shelf b") ? "Shelf B" : "Shelf A";
      return { cabinet: "Lens Locker", shelf };
    }
    if (lower.includes("audio") || lower.includes("mic") || lower.includes("sound")) {
      const shelf = lower.includes("wireless") ? "Wireless Audio" : lower.includes("cable") ? "Cables & Mixers" : "Microphones";
      return { cabinet: "Audio Rack", shelf };
    }
    if (lower.includes("tripod") || lower.includes("stand") || lower.includes("grip")) {
      return { cabinet: "Lighting & Grip Bay", shelf: "Tripods & Stands" };
    }
    if (lower.includes("cable") || lower.includes("box") || lower.includes("bin") || lower.includes("tub")) {
      return { cabinet: "Cable & Accessories Bay", shelf: "Tubs & Bins" };
    }

    // 3. Fallback
    const firstCab = cabinetsMap.keys().next().value || "Media Room Storage";
    return { cabinet: firstCab, shelf: "Main Shelf" };
  }

  for (const item of allEquipment) {
    const { cabinet, shelf } = resolveCabinetAndShelf(item.location);
    if (!cabinetsMap.has(cabinet)) {
      cabinetsMap.set(cabinet, { shelvesMap: new Map() });
    }
    const cab = cabinetsMap.get(cabinet)!;
    if (!cab.shelvesMap.has(shelf)) {
      cab.shelvesMap.set(shelf, []);
    }
    cab.shelvesMap.get(shelf)!.push(item);
  }

  const result: StorageCabinet[] = [];
  for (const [cabName, { shelvesMap, description }] of cabinetsMap.entries()) {
    const shelves: StorageShelf[] = [];
    let cabTotal = 0;
    let cabAvail = 0;
    let cabChecked = 0;
    let cabOther = 0;

    for (const [shelfName, items] of shelvesMap.entries()) {
      shelves.push({
        id: `${cabName}-${shelfName}`.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        name: shelfName,
        items,
      });
      cabTotal += items.length;
      for (const i of items) {
        if (i.status === "Available") cabAvail++;
        else if (i.status === "Checked Out") cabChecked++;
        else cabOther++;
      }
    }

    result.push({
      id: cabName.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      name: cabName,
      description,
      shelves,
      totalItems: cabTotal,
      availableCount: cabAvail,
      checkedOutCount: cabChecked,
      otherCount: cabOther,
    });
  }

  return result;
}



