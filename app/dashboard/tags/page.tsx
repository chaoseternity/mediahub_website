import { auth } from "@/lib/auth";
import { getAllTags, getAllEquipment } from "@/lib/db";
import { TagsManager } from "@/components/TagsManager";

export default async function TagsPage() {
  const session = await auth();
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
