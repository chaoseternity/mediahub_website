import { auth } from "@/lib/auth";
import { getAllEvents, getUserByEmail } from "@/lib/db";
import { EventsManager } from "@/components/EventsManager";
import { redirect } from "next/navigation";

export default async function EventsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [events, currentUser] = await Promise.all([
    getAllEvents(),
    getUserByEmail(session.user.email!),
  ]);

  return (
    <EventsManager
      initialEvents={events}
      role={session.user.role}
      currentUserId={currentUser?.id ?? null}
    />
  );
}
