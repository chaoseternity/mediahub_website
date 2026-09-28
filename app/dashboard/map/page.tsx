import { auth } from "@/lib/auth";
import { getStorageMapData, getStorageMapConfig } from "@/lib/db";
import { redirect } from "next/navigation";
import { StorageMapClient } from "./StorageMapClient";

export default async function StorageMapPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [data, config] = await Promise.all([
    getStorageMapData(),
    getStorageMapConfig(),
  ]);

  return (
    <StorageMapClient
      initialData={data}
      initialConfig={config}
      role={session.user.role}
      userName={session.user.name ?? ""}
    />
  );
}
