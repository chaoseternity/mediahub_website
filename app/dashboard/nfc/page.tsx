import { auth } from "@/lib/auth";
import { getAllEquipment, getAllNfcCards } from "@/lib/db";
import { NFCStationClient } from "@/components/NFCStationClient";

export const metadata = {
  title: "NFC Station | MediaHub",
  description: "NFC card member checkout and return workstation",
};

export default async function NFCPage() {
  const [session, equipment, nfcCards] = await Promise.all([
    auth(),
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
