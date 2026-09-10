"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, Package, Download, Upload } from "lucide-react";
import { AddEquipmentModal } from "@/components/AddEquipmentModal";
import { UploadEquipmentModal } from "@/components/UploadEquipmentModal";
import { generateEquipmentExcel } from "@/lib/excel";
import type { Equipment, Role } from "@/lib/types";

const EquipmentGrid = dynamic(
  () => import("@/components/EquipmentGrid").then((m) => m.EquipmentGrid),
  { ssr: false }
);

interface DashboardClientProps {
  initialData: Equipment[];
  role: Role;
  userName: string;
}

export function DashboardClient({ initialData, role, userName }: DashboardClientProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [items, setItems] = useState<Equipment[]>(initialData);
  const router = useRouter();

  async function refresh() {
    try {
      const res = await fetch("/api/equipment");
      if (res.ok) {
        const data: Equipment[] = await res.json();
        setItems(data);
      }
    } catch (err) {
      console.error("Failed to refresh equipment list:", err);
    }
    router.refresh();
  }

  function handleDownload() {
    try {
      setIsDownloading(true);
      const buffer = generateEquipmentExcel(items);
      const blob = new Blob([buffer as Uint8Array<ArrayBuffer>], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().split("T")[0];
      a.download = `MediaHub_Equipment_${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to generate Excel file.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" />
            Equipment
          </h2>
          <p className="text-muted-foreground text-sm">{items.length} items total</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={isDownloading || items.length === 0}
            className="sm:w-auto gap-1.5"
            title="Download equipment data as Excel"
          >
            <Download className="h-4 w-4" />
            Download
          </Button>

          {role === "admin" && (
            <>
              <Button
                variant="outline"
                onClick={() => setUploadOpen(true)}
                className="sm:w-auto gap-1.5"
                title="Upload equipment Excel spreadsheet"
              >
                <Upload className="h-4 w-4" />
                Upload
              </Button>
              <Button onClick={() => setAddOpen(true)} className="sm:w-auto gap-1.5">
                <Plus className="h-4 w-4" />
                Add Equipment
              </Button>
            </>
          )}
        </div>
      </div>

      <EquipmentGrid
        initialData={items}
        role={role}
        userName={userName}
        onRefresh={refresh}
      />

      {role === "admin" && (
        <>
          <AddEquipmentModal
            open={addOpen}
            onClose={() => setAddOpen(false)}
            onCreated={refresh}
          />
          <UploadEquipmentModal
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            onSuccess={refresh}
            existingEquipment={items}
          />
        </>
      )}
    </div>
  );
}
