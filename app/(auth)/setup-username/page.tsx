import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SetupUsernameForm } from "@/components/SetupUsernameForm";

export default async function SetupUsernamePage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.username) redirect("/dashboard");

  return <SetupUsernameForm />;
}
