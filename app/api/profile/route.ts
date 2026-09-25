import { auth } from "@/lib/auth";
import { getUserByEmail, getUserByUsername, getUserProfileData } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentUserId = currentUser.id;
  const currentUserRole = currentUser.role;
  const isAdmin = currentUserRole === "admin";

  const { searchParams } = new URL(req.url);
  const targetIdParam = searchParams.get("id");
  const targetUsernameParam = searchParams.get("username");

  let targetUserId = currentUserId;

  if (targetIdParam) {
    const parsedId = parseInt(targetIdParam, 10);
    if (isNaN(parsedId) || parsedId <= 0) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }
    targetUserId = parsedId;
  } else if (targetUsernameParam) {
    const targetUser = await getUserByUsername(targetUsernameParam);
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    targetUserId = targetUser.id;
  }

  // Access control:
  // Non-admins can only access their own profile.
  if (!isAdmin && targetUserId !== currentUserId) {
    return NextResponse.json(
      { error: "Forbidden: You are only permitted to view your own profile." },
      { status: 403 }
    );
  }

  const profileData = await getUserProfileData(targetUserId);
  if (!profileData) {
    return NextResponse.json({ error: "User profile not found" }, { status: 404 });
  }

  return NextResponse.json(profileData);
}
