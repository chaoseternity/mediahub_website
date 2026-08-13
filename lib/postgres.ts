import { sql } from "@vercel/postgres";

let initialized = false;

export async function ensureSchema(): Promise<void> {
  if (initialized) return;

  try {
    await sql`
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
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS equipment (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        serial_number TEXT,
        purchase_date TEXT,
        condition TEXT NOT NULL DEFAULT 'Good' CHECK(condition IN ('New','Good','Fair','Poor')),
        quantity INT NOT NULL DEFAULT 1,
        location TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available','Checked Out','Under Maintenance','Retired')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS equipment_tags (
        equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        tag_id INT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (equipment_id, tag_id)
      );
    `;

    await sql`
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
    `;

    initialized = true;
  } catch (err) {
    console.error("Error ensuring Postgres schema:", err);
  }
}
