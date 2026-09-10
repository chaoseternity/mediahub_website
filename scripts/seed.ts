/**
 * Seed script — generates seed SQL for Cloudflare D1.
 *
 * Usage (local wrangler dev):
 *   npm run seed
 *   wrangler d1 execute inventory-tracker-db --local --file=data/seed.sql
 *
 * Usage (remote / production):
 *   npm run seed
 *   wrangler d1 execute inventory-tracker-db --remote --file=data/seed.sql
 *
 * Creates:
 *   - 6 laptops, 10 video SD cards, 15 photo SD cards
 *   - 8 checkout records (mix of active and returned)
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// IDs (deterministic — inserts always run in order after a full clear)
// ---------------------------------------------------------------------------
const TAG_LAPTOP   = 1; // "Laptop"
const TAG_VIDEO_SD = 2; // "SD Card (Video)"
const TAG_PHOTO_SD = 3; // "SD Card (Photo)"

// Equipment IDs: 1-6 laptops, 7-16 video SD, 17-31 photo SD
const laptopIds   = Array.from({ length: 6  }, (_, i) => i + 1);
const videoSdIds  = Array.from({ length: 10 }, (_, i) => i + 7);
const photoSdIds  = Array.from({ length: 15 }, (_, i) => i + 17);

// ---------------------------------------------------------------------------
// Equipment definitions (same data as before)
// ---------------------------------------------------------------------------
const laptops = [
  { name: "Kamera",       description: "Primary filming laptop used for on-site recording and live preview",      serial: "LP-KAM-001", date: "2022-08-10", cond: "Working",  status: "Available"          },
  { name: "DJ",           description: "Used for DJ sets, music playback and live sound mixing",                   serial: "LP-DJ-001",  date: "2021-11-05", cond: "Working",  status: "Checked Out"       },
  { name: "Clapper",      description: "Used for production management, scripts and clapperboard software",        serial: "LP-CLA-001", date: "2023-01-20", cond: "Working",  status: "Available"          },
  { name: "Bulbasaur",    description: "General-purpose laptop for presentations and event support",               serial: "LP-BUL-001", date: "2020-06-15", cond: "Impaired", status: "Checked Out"       },
  { name: "Middle Earth", description: "High-performance editing laptop for post-production video work",           serial: "LP-MID-001", date: "2023-09-01", cond: "Working",  status: "Available"          },
  { name: "Strawberry",   description: "Backup laptop; used when primary units are unavailable",                   serial: "LP-STR-001", date: "2019-03-22", cond: "Impaired", status: "Under Maintenance"  },
];

const videoSdCards = Array.from({ length: 10 }, (_, i) => ({
  name: `SD-V-${i + 1}`,
  description: "128 GB UHS-I U3 V30 card rated for 4K video recording",
  serial: `SD-V-${String(i + 1).padStart(2, "0")}`,
  date: "2023-05-01",
  cond: i < 7 ? "Working" : "Impaired",
  status: i === 2 || i === 5 ? "Checked Out" : "Available",
}));

const photoSdCards = Array.from({ length: 15 }, (_, i) => ({
  name: `SD-P-${i + 1}`,
  description: "64 GB UHS-I U3 card for photography use",
  serial: `SD-P-${String(i + 1).padStart(2, "0")}`,
  date: "2022-11-15",
  cond: i < 10 ? "Working" : "Impaired",
  status: i === 0 || i === 3 || i === 7 ? "Checked Out" : "Available",
}));

function esc(s: string | null): string {
  if (s === null) return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

const lines: string[] = [];
const sql = (line: string) => lines.push(line);

// ---------------------------------------------------------------------------
// Clear existing data
// ---------------------------------------------------------------------------
sql("DELETE FROM checkouts;");
sql("DELETE FROM equipment_tags;");
sql("DELETE FROM equipment;");
sql("DELETE FROM tags;");
sql("");

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------
sql("-- Tags");
sql(`INSERT INTO tags (id, name) VALUES (${TAG_LAPTOP},   'Laptop');`);
sql(`INSERT INTO tags (id, name) VALUES (${TAG_VIDEO_SD}, 'SD Card (Video)');`);
sql(`INSERT INTO tags (id, name) VALUES (${TAG_PHOTO_SD}, 'SD Card (Photo)');`);
sql("");

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------
sql("-- Equipment");
const allEquipment = [...laptops, ...videoSdCards, ...photoSdCards];
allEquipment.forEach((item, i) => {
  sql(
    `INSERT INTO equipment (id, name, description, serial_number, condition, quantity, location, status) VALUES (${i + 1}, ${esc(item.name)}, ${esc(item.description)}, ${esc(item.serial)}, ${esc(item.cond)}, 1, ${esc("Media Room")}, ${esc(item.status)});`
  );
});
sql("");

// ---------------------------------------------------------------------------
// Equipment → Tag associations
// ---------------------------------------------------------------------------
sql("-- Equipment tags");
laptopIds.forEach((id) => sql(`INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (${id}, ${TAG_LAPTOP});`));
videoSdIds.forEach((id) => sql(`INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (${id}, ${TAG_VIDEO_SD});`));
photoSdIds.forEach((id) => sql(`INSERT INTO equipment_tags (equipment_id, tag_id) VALUES (${id}, ${TAG_PHOTO_SD});`));
sql("");

// ---------------------------------------------------------------------------
// Checkouts
// ---------------------------------------------------------------------------
const nameToId = (name: string) => allEquipment.findIndex((e) => e.name === name) + 1;
const checkouts = [
  { eqId: nameToId("DJ"),        by: null, byName: "AV Member", at: "2026-03-17 14:00:00", ret: "2026-03-19 18:00:00", returned: null,                  notes: "Borrowed for school concert on 19 Mar" },
  { eqId: nameToId("Bulbasaur"), by: null, byName: "AV Member", at: "2026-03-18 09:00:00", ret: "2026-03-18 22:00:00", returned: null,                  notes: "Needed for CCA open house live stream" },
  { eqId: nameToId("SD-V-3"),   by: null, byName: "AV Member", at: "2026-03-18 08:30:00", ret: "2026-03-18 18:00:00", returned: null,                  notes: "Filming school open house" },
  { eqId: nameToId("SD-V-6"),   by: null, byName: "AV Admin",  at: "2026-03-17 10:00:00", ret: "2026-03-20 10:00:00", returned: null,                  notes: "Documentary project footage" },
  { eqId: nameToId("SD-P-1"),   by: null, byName: "AV Member", at: "2026-03-18 07:45:00", ret: "2026-03-18 20:00:00", returned: null,                  notes: "Open house photography" },
  { eqId: nameToId("SD-P-4"),   by: null, byName: "AV Member", at: "2026-03-18 07:45:00", ret: "2026-03-18 20:00:00", returned: null,                  notes: "Open house photography (backup card)" },
  { eqId: nameToId("SD-P-8"),   by: null, byName: "AV Admin",  at: "2026-03-15 13:00:00", ret: "2026-03-16 18:00:00", returned: null,                  notes: "Sports day coverage" },
  { eqId: nameToId("Kamera"),   by: null, byName: "AV Member", at: "2026-03-10 09:00:00", ret: "2026-03-10 18:00:00", returned: "2026-03-10 17:30:00", notes: "Used for Drama Night preview filming" },
];

sql("-- Checkouts");
checkouts.forEach((c) => {
  sql(
    `INSERT INTO checkouts (equipment_id, checked_out_by, checked_out_by_name, checked_out_at, expected_return_at, returned_at, notes) VALUES (${c.eqId}, ${c.by}, ${esc(c.byName)}, ${esc(c.at)}, ${esc(c.ret)}, ${esc(c.returned)}, ${esc(c.notes)});`
  );
});

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
const outDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, "seed.sql");
fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");

console.log(`✓ Generated ${outPath}`);
console.log(`\nApply locally:   wrangler d1 execute inventory-tracker-db --local --file=data/seed.sql`);
console.log(`Apply remotely:  wrangler d1 execute inventory-tracker-db --remote --file=data/seed.sql`);
