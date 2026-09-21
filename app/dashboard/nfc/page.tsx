import { auth } from "@/lib/auth";
import { getAllEquipment, getAllNfcCards } from "@/lib/db";
import { redirect } from "next/navigation";
import { NFCStationClient } from "@/components/NFCStationClient";

export const metadata = {
  title: "Media Club NFC Station | MediaHub",
  description: "Official Media Club NFC card member checkout and return workstation",
};

export default async function NFCPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role === "viewer") redirect("/dashboard");

  const [equipment, nfcCards] = await Promise.all([
    getAllEquipment(),
    getAllNfcCards(),
  ]);

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full">
      <NFCStationClient
        allEquipment={equipment}
        initialCards={nfcCards}
        currentRole={session?.user?.role ?? "viewer"}
        currentUserName={session?.user?.name ?? ""}
      />
    </div>
  );
}
