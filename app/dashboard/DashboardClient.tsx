"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
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
    <div className="px-4 py-4 md:px-6 md:py-8 max-w-screen-xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl md:text-2xl font-bold">Equipment</h2>
          <p className="text-muted-foreground text-sm">{items.length} items total</p>
        </div>
      </div>

      <EquipmentGrid
        initialData={items}
        role={role}
        onAddNew={role === "admin" ? () => setAddOpen(true) : undefined}
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

