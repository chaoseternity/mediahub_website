/**
 * Promotes or demotes a user's role directly in the database.
 *
 * Usage:
 *   npm run set-role -- --email=you@gmail.com --role=admin
 *   npm run set-role -- --email=you@gmail.com --role=viewer
 *
 * The user must have signed in at least once (so their row exists in the DB).
 */

import { getUserByEmail, updateUserRole } from "../lib/db";

function parseArgs(): { email: string; role: "admin" | "verified" | "viewer" } {
  const args = process.argv.slice(2);
  const get = (flag: string) =>
    args.find((a) => a.startsWith(`--${flag}=`))?.split("=")[1];

  const email = get("email");
  const role = get("role");

  if (!email) {
    console.error("Error: --email is required");
    process.exit(1);
  }
  if (role !== "admin" && role !== "verified" && role !== "viewer") {
    console.error('Error: --role must be "admin", "verified", or "viewer"');
    process.exit(1);
  }

  return { email, role };
}

const { email, role } = parseArgs();

(async () => {
  const user = await getUserByEmail(email);
  if (!user) {
    console.error(
      `Error: no user found with email "${email}". They must sign in at least once first.`
    );
    process.exit(1);
  }

  await updateUserRole(user.id, role);
  console.log(`✓ ${email} is now "${role}" (was "${user.role}")`);
})();
