import { auth } from "@/lib/auth";
import { getActiveAuditSession, getAllEquipment } from "@/lib/db";
import { redirect } from "next/navigation";
import { AuditClient } from "./AuditClient";

export default async function AuditPage() {
  const session = await auth();
  if (!session) redirect("/login");

  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  const [activeSession, equipment] = await Promise.all([
    getActiveAuditSession(),
    getAllEquipment(),
  ]);

  return (
    <AuditClient
      initialSession={activeSession}
      equipmentList={equipment}
      role={session.user.role}
      userName={session.user.name ?? ""}
    />
  );
}
