import { auth } from "@/lib/auth";
import { getAllEquipment } from "@/lib/db";
import { QRScannerClient } from "@/components/QRScannerClient";

export default async function ScanPage() {
  const [session, equipment] = await Promise.all([auth(), getAllEquipment()]);

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 max-w-screen-xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl md:text-2xl font-bold">Scan QR Code</h2>
        <p className="text-muted-foreground text-sm">
          Point the camera at an equipment QR code to view its details.
        </p>
      </div>
      <QRScannerClient
        equipment={equipment}
        role={session!.user.role}
        userName={session!.user.name ?? ""}
      />
    </div>
  );
}
