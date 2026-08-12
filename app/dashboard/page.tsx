import { auth } from "@/lib/auth";
import { getAllEquipment } from "@/lib/db";
import { redirect } from "next/navigation";
import { DashboardClient } from "./DashboardClient";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const equipment = await getAllEquipment();

  return (
    <DashboardClient
      initialData={equipment}
      role={session.user.role}
      userName={session.user.username ?? session.user.name ?? ""}
    />
  );
}
