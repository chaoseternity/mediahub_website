import { auth } from "@/lib/auth";
import { getUserByUsername, getUserProfileData } from "@/lib/db";
import { redirect } from "next/navigation";
import { ProfileClient } from "@/components/ProfileClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, UserX } from "lucide-react";
import Link from "next/link";

interface ProfilePageProps {
  searchParams: Promise<{ id?: string; username?: string }>;
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const currentUserId = Number(session.user.id);
  const currentUserRole = session.user.role;
  const isAdmin = currentUserRole === "admin";

  const params = await searchParams;
  let targetUserId = currentUserId;

  if (params.id) {
    const parsed = parseInt(params.id, 10);
    if (!isNaN(parsed) && parsed > 0) {
      targetUserId = parsed;
    }
  } else if (params.username) {
    const user = await getUserByUsername(params.username);
    if (user) {
      targetUserId = user.id;
    } else {
      return (
        <div className="px-4 py-12 max-w-md mx-auto text-center space-y-4">
          <Card className="border-dashed">
            <CardContent className="py-8 space-y-3">
              <UserX className="h-10 w-10 text-muted-foreground mx-auto opacity-50" />
              <h2 className="text-lg font-semibold">User Not Found</h2>
              <p className="text-sm text-muted-foreground">
                No user exists matching &ldquo;{params.username}&rdquo;.
              </p>
              <Link href="/dashboard/profile">
                <Button size="sm" variant="outline">
                  Go to My Profile
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      );
    }
  }

  // RBAC Access Control:
  // A viewer and verified should only be able to access their own profile page only.
  // An admin can access all profile pages of all users.
  const isSelf = targetUserId === currentUserId;
  if (!isAdmin && !isSelf) {
    return (
      <div className="px-4 py-12 max-w-md mx-auto text-center space-y-4">
        <Card className="border-red-200 dark:border-red-900 bg-red-50/20">
          <CardContent className="py-8 space-y-3">
            <ShieldAlert className="h-10 w-10 text-red-500 mx-auto" />
            <h2 className="text-lg font-bold text-red-900 dark:text-red-300">
              Access Restricted
            </h2>
            <p className="text-xs text-muted-foreground">
              You are only permitted to view your own profile. Only Administrators can view other members&apos; profiles.
            </p>
            <div className="pt-2">
              <Link href="/dashboard/profile">
                <Button size="sm">Go to My Profile</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const profileData = await getUserProfileData(targetUserId);
  if (!profileData) {
    return (
      <div className="px-4 py-12 max-w-md mx-auto text-center space-y-4">
        <Card>
          <CardContent className="py-8 space-y-3">
            <UserX className="h-10 w-10 text-muted-foreground mx-auto opacity-50" />
            <h2 className="text-lg font-semibold">Profile Not Found</h2>
            <p className="text-sm text-muted-foreground">
              Unable to load the requested profile.
            </p>
            <Link href="/dashboard/profile">
              <Button size="sm" variant="outline">
                Back to My Profile
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ProfileClient
      initialData={profileData}
      viewerRole={session.user.role}
      viewerId={session.user.id}
      isSelf={isSelf}
    />
  );
}
