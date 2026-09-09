import { auth } from "@/lib/auth";
import { getAllEquipment, getAllUsers } from "@/lib/db";
import { NFCStationClient } from "@/components/NFCStationClient";

export const metadata = {
  title: "NFC Station | MediaHub",
  description: "NFC card member checkout and return workstation",
};

export default async function NFCPage() {
  const [session, equipment, users] = await Promise.all([
    auth(),
    getAllEquipment(),
    getAllUsers(),
  ]);

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full">
      <NFCStationClient
        allEquipment={equipment}
        allUsers={users}
        currentRole={session?.user?.role ?? "viewer"}
        currentUserName={session?.user?.name ?? ""}
      />
    </div>
  );
}
