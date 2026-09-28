"use client";

import { useState } from "react";
import {
  Boxes,
  MapPin,
  Package,
  Layers,
  Search,
  CheckCircle2,
  Clock,
  Wrench,
  XCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EquipmentModal } from "@/components/EquipmentModal";
import type { StorageCabinet, Role, Equipment } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StorageMapClientProps {
  initialData: StorageCabinet[];
  role: Role;
  userName: string;
}

export function StorageMapClient({ initialData, role, userName }: StorageMapClientProps) {
  const [cabinets, setCabinets] = useState<StorageCabinet[]>(initialData);
  const [selectedCabinetId, setSelectedCabinetId] = useState<string>(
    cabinets[0]?.id || ""
  );
  const [search, setSearch] = useState("");
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const activeCabinet = cabinets.find((c) => c.id === selectedCabinetId) || cabinets[0];

  function getStatusDot(status: string) {
    switch (status) {
      case "Available":
        return "bg-green-500";
      case "Checked Out":
        return "bg-blue-500";
      case "Maintenance":
        return "bg-amber-500";
      case "Missing":
      case "Decommissioned":
        return "bg-red-500";
      default:
        return "bg-slate-400";
    }
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" />
            Visual Storage & Shelf Map
          </h2>
          <p className="text-muted-foreground text-sm">
            Interactive visual layout of equipment rooms, lockers, shelves, and storage zones.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500 inline-block" /> Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-500 inline-block" /> Checked Out
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" /> Maintenance
          </span>
        </div>
      </div>

      {cabinets.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <Boxes className="h-10 w-10 mx-auto opacity-30 text-muted-foreground" />
            <p className="font-medium text-foreground">No storage locations assigned</p>
            <p className="text-xs">
              Assign locations (e.g. &ldquo;Locker A - Shelf 1&rdquo;) to equipment to populate the visual map.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
          {/* Cabinet / Zone Selector Sidebar */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
              Storage Zones & Lockers
            </h3>
            <div className="space-y-1.5">
              {cabinets.map((cab) => {
                const isSelected = cab.id === activeCabinet?.id;
                const totalGear = cab.shelves.reduce((acc, s) => acc + s.items.length, 0);

                return (
                  <button
                    key={cab.id}
                    onClick={() => setSelectedCabinetId(cab.id)}
                    className={cn(
                      "w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-3",
                      isSelected
                        ? "bg-primary/10 border-primary text-primary font-semibold shadow-xs"
                        : "bg-card hover:bg-muted/40 text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={cn(
                          "p-2 rounded-lg shrink-0",
                          isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                        )}
                      >
                        <MapPin className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm truncate">{cab.name}</p>
                        <p className="text-[11px] text-muted-foreground font-normal">
                          {cab.shelves.length} Shelves / Tiers
                        </p>
                      </div>
                    </div>
                    <Badge variant={isSelected ? "default" : "secondary"} className="text-xs shrink-0">
                      {totalGear} items
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Cabinet Shelf Visualizer */}
          <div className="lg:col-span-3 space-y-4">
            <Card className="border shadow-xs">
              <CardHeader className="pb-3 border-b bg-muted/10">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Layers className="h-5 w-5 text-primary" />
                      {activeCabinet?.name}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Elevation view showing storage shelves and current occupancy.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {activeCabinet?.shelves.length} Tiers
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 sm:p-6 space-y-6">
                {activeCabinet?.shelves.map((shelf, idx) => (
                  <div key={shelf.id} className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium text-muted-foreground px-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">
                          Tier {idx + 1}
                        </span>
                        {shelf.name}
                      </span>
                      <span>{shelf.items.length} items present</span>
                    </div>

                    {/* Shelf Platform Wireframe */}
                    <div className="p-3 bg-muted/20 border-2 border-dashed border-border rounded-xl min-h-[90px] flex flex-wrap gap-2.5 items-center relative">
                      {shelf.items.length === 0 ? (
                        <div className="w-full text-center py-3 text-xs text-muted-foreground italic">
                          Empty Shelf Slot
                        </div>
                      ) : (
                        shelf.items.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              setSelectedEquipmentId(item.id);
                              setModalOpen(true);
                            }}
                            className="group relative bg-background hover:bg-muted border rounded-lg p-2.5 text-left transition-all shadow-xs hover:shadow-md flex items-center gap-2.5 max-w-xs min-w-[160px] cursor-pointer"
                          >
                            <span
                              className={cn(
                                "h-2.5 w-2.5 rounded-full shrink-0",
                                getStatusDot(item.status)
                              )}
                              title={item.status}
                            />
                            <div className="min-w-0 space-y-0.5">
                              <p className="text-xs font-semibold truncate group-hover:text-primary transition-colors">
                                {item.name}
                              </p>
                              <p className="text-[10px] font-mono text-muted-foreground truncate">
                                {item.serial_number || `#${item.id}`}
                              </p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {selectedEquipmentId && (
        <EquipmentModal
          equipmentId={selectedEquipmentId}
          open={modalOpen}
          role={role}
          userName={userName}
          onClose={() => {
            setModalOpen(false);
            setSelectedEquipmentId(null);
          }}
          onUpdated={() => {}}
        />
      )}
    </div>
  );
}
