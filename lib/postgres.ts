import { sql } from "@vercel/postgres";
import { getTestDb } from "./test-db";

let initialized = false;

async function runSafe(queryFn: () => Promise<unknown>, description: string): Promise<void> {
  try {
    await queryFn();
  } catch (err) {
    console.warn(`Postgres schema notice (${description}):`, err);
  }
}

export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  if (getTestDb()) return;

  try {
    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          google_id TEXT,
          image TEXT,
          role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin','verified','viewer')),
          provider TEXT,
          username TEXT UNIQUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `,
      "CREATE TABLE users"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS tags (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE
        );
      `,
      "CREATE TABLE tags"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS equipment (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          serial_number TEXT,
          condition TEXT NOT NULL DEFAULT 'Working' CHECK(condition IN ('Working','Impaired','Broken','Missing','Retired')),
          quantity INT NOT NULL DEFAULT 1,
          location TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available','Checked Out','In Event','In Event (Rehearsal)','Unavailable (In Repairs)','Unavailable (Broken)','Unavailable (Missing)','Unavailable (Retired)')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `,
      "CREATE TABLE equipment"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS equipment_tags (
          equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
          tag_id INT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (equipment_id, tag_id)
        );
      `,
      "CREATE TABLE equipment_tags"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS checkouts (
          id SERIAL PRIMARY KEY,
          equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
          checked_out_by INT REFERENCES users(id),
          checked_out_by_name TEXT NOT NULL,
          checked_out_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          expected_return_at TEXT,
          returned_at TIMESTAMP WITH TIME ZONE,
          notes TEXT,
          checkout_location TEXT
        );
      `,
      "CREATE TABLE checkouts"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS events (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          start_time TIMESTAMP WITH TIME ZONE NOT NULL,
          end_time TIMESTAMP WITH TIME ZONE NOT NULL,
          location TEXT NOT NULL,
          created_by INT REFERENCES users(id) ON DELETE SET NULL,
          has_rehearsal BOOLEAN DEFAULT FALSE,
          rehearsal_start_time TIMESTAMP WITH TIME ZONE,
          rehearsal_end_time TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `,
      "CREATE TABLE events"
    );

    await runSafe(
      () => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS has_rehearsal BOOLEAN DEFAULT FALSE;`,
      "ALTER events has_rehearsal"
    );
    await runSafe(
      () => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS rehearsal_start_time TIMESTAMP WITH TIME ZONE;`,
      "ALTER events rehearsal_start_time"
    );
    await runSafe(
      () => sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS rehearsal_end_time TIMESTAMP WITH TIME ZONE;`,
      "ALTER events rehearsal_end_time"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS event_oics (
          event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (event_id, user_id)
        );
      `,
      "CREATE TABLE event_oics"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS event_ics (
          event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          section TEXT NOT NULL DEFAULT 'photo' CHECK(section IN ('photo','video','av')),
          PRIMARY KEY (event_id, user_id, section)
        );
      `,
      "CREATE TABLE event_ics"
    );
    await runSafe(
      () => sql`ALTER TABLE event_ics ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'photo';`,
      "ALTER event_ics section"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS event_equipment (
          event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
          section TEXT NOT NULL DEFAULT 'photo' CHECK(section IN ('photo','video','av')),
          used_for_rehearsal BOOLEAN DEFAULT FALSE,
          added_by INT REFERENCES users(id) ON DELETE SET NULL,
          added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (event_id, equipment_id, section)
        );
      `,
      "CREATE TABLE event_equipment"
    );
    await runSafe(
      () => sql`ALTER TABLE event_equipment ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'photo';`,
      "ALTER event_equipment section"
    );
    await runSafe(
      () => sql`ALTER TABLE event_equipment ADD COLUMN IF NOT EXISTS used_for_rehearsal BOOLEAN DEFAULT FALSE;`,
      "ALTER event_equipment used_for_rehearsal"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS event_deployments (
          event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          section TEXT NOT NULL DEFAULT 'photo' CHECK(section IN ('photo','video','av')),
          attending_rehearsal BOOLEAN DEFAULT FALSE,
          added_by INT REFERENCES users(id) ON DELETE SET NULL,
          added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          response_status TEXT NOT NULL DEFAULT 'pending' CHECK(response_status IN ('pending', 'confirmed', 'declined')),
          response_token TEXT,
          responded_at TIMESTAMP WITH TIME ZONE,
          PRIMARY KEY (event_id, user_id, section)
        );
      `,
      "CREATE TABLE event_deployments"
    );

    await runSafe(
      () => sql`ALTER TABLE event_deployments ADD COLUMN IF NOT EXISTS response_status TEXT NOT NULL DEFAULT 'pending';`,
      "ALTER event_deployments response_status"
    );
    await runSafe(
      () => sql`ALTER TABLE event_deployments ADD COLUMN IF NOT EXISTS response_token TEXT;`,
      "ALTER event_deployments response_token"
    );
    await runSafe(
      () => sql`ALTER TABLE event_deployments ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP WITH TIME ZONE;`,
      "ALTER event_deployments responded_at"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS event_section_rehearsals (
          event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          section TEXT NOT NULL CHECK(section IN ('photo','video','av')),
          participating BOOLEAN DEFAULT FALSE,
          PRIMARY KEY (event_id, section)
        );
      `,
      "CREATE TABLE event_section_rehearsals"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS sop_documents (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'General',
          content TEXT NOT NULL,
          file_name TEXT,
          file_type TEXT,
          file_size INT,
          uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `,
      "CREATE TABLE sop_documents"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS nfc_cards (
          id SERIAL PRIMARY KEY,
          nfc_value TEXT NOT NULL UNIQUE,
          member_name TEXT NOT NULL,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `,
      "CREATE TABLE nfc_cards"
    );
    await runSafe(
      () => sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_nfc_cards_value ON nfc_cards(LOWER(nfc_value));`,
      "CREATE INDEX idx_nfc_cards_value"
    );
    await runSafe(
      () => sql`ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS nfc_value TEXT;`,
      "ALTER checkouts nfc_value"
    );
    await runSafe(
      () => sql`ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS nfc_id TEXT;`,
      "ALTER checkouts nfc_id"
    );
    await runSafe(
      () => sql`ALTER TABLE equipment DROP COLUMN IF EXISTS purchase_date;`,
      "ALTER equipment drop purchase_date"
    );
    await runSafe(
      () => sql`UPDATE equipment SET condition = 'Working' WHERE condition IN ('New', 'Good');`,
      "UPDATE equipment condition New/Good -> Working"
    );
    await runSafe(
      () => sql`UPDATE equipment SET condition = 'Impaired' WHERE condition = 'Fair';`,
      "UPDATE equipment condition Fair -> Impaired"
    );
    await runSafe(
      () => sql`UPDATE equipment SET condition = 'Broken' WHERE condition = 'Poor';`,
      "UPDATE equipment condition Poor -> Broken"
    );
    await runSafe(
      () => sql`UPDATE equipment SET condition = 'Broken' WHERE condition = 'In repairs';`,
      "UPDATE equipment condition In repairs -> Broken"
    );
    await runSafe(
      () => sql`UPDATE equipment SET status = 'In Repairs' WHERE status IN ('Under Maintenance', 'Retired');`,
      "UPDATE equipment status Under Maintenance/Retired -> In Repairs"
    );
    await runSafe(
      () => sql`ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_condition_check;`,
      "DROP CONSTRAINT equipment_condition_check"
    );
    await runSafe(
      () => sql`ALTER TABLE equipment ADD CONSTRAINT equipment_condition_check CHECK(condition IN ('Working', 'Impaired', 'Broken', 'Missing', 'Retired'));`,
      "ADD CONSTRAINT equipment_condition_check"
    );
    await runSafe(
      () => sql`ALTER TABLE equipment ALTER COLUMN condition SET DEFAULT 'Working';`,
      "ALTER COLUMN condition SET DEFAULT Working"
    );
    await runSafe(
      () => sql`UPDATE equipment SET status = 'Unavailable (In Repairs)' WHERE status = 'In Repairs';`,
      "UPDATE equipment status In Repairs -> Unavailable (In Repairs)"
    );
    await runSafe(
      () => sql`UPDATE equipment SET status = 'Unavailable (Broken)' WHERE condition = 'Broken';`,
      "UPDATE equipment status for Broken condition -> Unavailable (Broken)"
    );
    await runSafe(
      () => sql`UPDATE equipment SET status = 'Unavailable (Missing)' WHERE condition = 'Missing';`,
      "UPDATE equipment status for Missing condition -> Unavailable (Missing)"
    );
    await runSafe(
      () => sql`UPDATE equipment SET condition = 'Missing' WHERE status = 'Unavailable (Missing)';`,
      "UPDATE equipment condition for Unavailable (Missing) status -> Missing"
    );
    await runSafe(
      () => sql`UPDATE equipment SET status = 'Unavailable (Retired)' WHERE condition = 'Retired';`,
      "UPDATE equipment status for Retired condition -> Unavailable (Retired)"
    );
    await runSafe(
      () => sql`UPDATE equipment SET condition = 'Retired' WHERE status = 'Unavailable (Retired)';`,
      "UPDATE equipment condition for Unavailable (Retired) status -> Retired"
    );
    await runSafe(
      () => sql`ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_status_check;`,
      "DROP CONSTRAINT equipment_status_check"
    );
    await runSafe(
      () => sql`ALTER TABLE equipment ADD CONSTRAINT equipment_status_check CHECK(status IN ('Available', 'Checked Out', 'In Event', 'In Event (Rehearsal)', 'Unavailable (In Repairs)', 'Unavailable (Broken)', 'Unavailable (Missing)', 'Unavailable (Retired)'));`,
      "ADD CONSTRAINT equipment_status_check"
    );
    await runSafe(
      () => sql`ALTER TABLE equipment ALTER COLUMN status SET DEFAULT 'Available';`,
      "ALTER COLUMN status SET DEFAULT Available"
    );

    await runSafe(
      () => sql`
        CREATE TABLE IF NOT EXISTS checkout_reminders (
          id SERIAL PRIMARY KEY,
          checkout_id INT NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
          reminder_type TEXT NOT NULL CHECK(reminder_type IN ('due_soon', 'overdue')),
          sent_to_email TEXT NOT NULL,
          sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `,
      "CREATE TABLE checkout_reminders"
    );

    initialized = true;
  } catch (err) {
    console.error("Error ensuring Postgres schema:", err);
  }
}
