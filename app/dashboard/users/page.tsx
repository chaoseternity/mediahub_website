import { auth } from "@/lib/auth";
import { getAllUsers } from "@/lib/db";
import { redirect } from "next/navigation";
import { UsersManager } from "@/components/UsersManager";

export default async function UsersPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  const users = await getAllUsers();

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full">
      <div className="mb-6">
        <h2 className="text-xl md:text-2xl font-bold">Users</h2>
        <p className="text-muted-foreground text-sm">
          Manage user roles. Changes take effect immediately.
        </p>
      </div>
      <UsersManager users={users} currentUserId={session.user.id} />
    </div>
  );
}
