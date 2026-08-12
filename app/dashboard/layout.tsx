import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!session.user.username) redirect("/setup-username");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        userName={session.user.username ?? session.user.name ?? ""}
        role={session.user.role}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MobileNav
          userName={session.user.username ?? session.user.name ?? ""}
          role={session.user.role}
        />
        <main className="flex-1 overflow-y-auto bg-muted/30">
          {children}
        </main>
      </div>
    </div>
  );
}
