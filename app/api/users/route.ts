import { auth } from "@/lib/auth";
import { getAllUsers } from "@/lib/db";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/users
 * - admin: full user records (used by the admin user-management UI)
 * - any other authenticated user (verified or viewer — viewers can be event OICs /
 *   section ICs): a minimal member directory with only id, name, username and image,
 *   so they can pick members for deployment without seeing email / google_id / role.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let users: Awaited<ReturnType<typeof getAllUsers>>;
  try {
    users = await getAllUsers();
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to load users");
  }
  if (session.user.role === "admin") {
    return NextResponse.json(users);
  }

  const directory = users.map((u) => ({
    id: u.id,
    name: u.name,
    username: u.username,
    image: u.image,
  }));
  return NextResponse.json(directory);
}
