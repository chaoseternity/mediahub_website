import { sql } from "@vercel/postgres";

let initialized = false;

async function runSafe(queryFn: () => Promise<any>, description: string): Promise<void> {
  try {
    await queryFn();
  } catch (err) {
    console.warn(`Postgres schema notice (${description}):`, err);
  }
}

export async function ensureSchema(): Promise<void> {
  if (initialized) return;

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
          purchase_date TEXT,
          condition TEXT NOT NULL DEFAULT 'Good' CHECK(condition IN ('New','Good','Fair','Poor')),
          quantity INT NOT NULL DEFAULT 1,
          location TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available','Checked Out','In Event','In Event (Rehearsal)','Under Maintenance','Retired')),
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
          PRIMARY KEY (event_id, user_id, section)
        );
      `,
      "CREATE TABLE event_deployments"
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

    initialized = true;
  } catch (err) {
    console.error("Error ensuring Postgres schema:", err);
  }
}
