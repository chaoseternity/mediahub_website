"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Plus, Package } from "lucide-react";
import { AddEquipmentModal } from "@/components/AddEquipmentModal";
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
  const [items, setItems] = useState<Equipment[]>(initialData);

  async function refresh() {
    const res = await fetch("/api/equipment");
    const data: Equipment[] = await res.json();
    setItems(data);
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 max-w-screen-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" />
            Equipment
          </h2>
          <p className="text-muted-foreground text-sm">{items.length} items total</p>
        </div>
        {role === "admin" && (
          <Button onClick={() => setAddOpen(true)} className="sm:w-auto">
            <Plus className="h-4 w-4 mr-1.5" />
            Add Equipment
          </Button>
        )}
      </div>

      <EquipmentGrid
        initialData={items}
        role={role}
        userName={userName}
      />

      {role === "admin" && (
        <AddEquipmentModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={refresh}
        />
      )}
    </div>
  );
}
