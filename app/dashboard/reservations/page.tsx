import { auth } from "@/lib/auth";
import { getAllEquipment, getReservations, getUserByEmail } from "@/lib/db";
import { redirect } from "next/navigation";
import { ReservationsClient } from "./ReservationsClient";

export default async function ReservationsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [equipmentList, reservations, currentUser] = await Promise.all([
    getAllEquipment(),
    getReservations(),
    getUserByEmail(session.user.email!),
  ]);

  return (
    <ReservationsClient
      initialReservations={reservations}
      equipmentList={equipmentList}
      role={session.user.role}
      currentUserId={currentUser?.id ?? null}
      currentUserName={session.user.name ?? ""}
    />
  );
}
