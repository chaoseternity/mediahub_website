import { auth } from "@/lib/auth";
import { getAllTags, getAllEquipment } from "@/lib/db";
import { redirect } from "next/navigation";
import { TagsManager } from "@/components/TagsManager";

export default async function TagsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  const [tags, equipment] = await Promise.all([
    getAllTags(),
    getAllEquipment(),
  ]);

  return (
    <TagsManager
      initialTags={tags}
      initialEquipment={equipment}
      role={session!.user.role}
    />
  );
}
