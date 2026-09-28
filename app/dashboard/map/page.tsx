import { auth } from "@/lib/auth";
import { getStorageMapData } from "@/lib/db";
import { redirect } from "next/navigation";
import { StorageMapClient } from "./StorageMapClient";

export default async function StorageMapPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const data = await getStorageMapData();

  return (
    <StorageMapClient
      initialData={data}
      role={session.user.role}
      userName={session.user.name ?? ""}
    />
  );
}
