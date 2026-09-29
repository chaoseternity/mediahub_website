"use client";

import { useRef, useState } from "react";
import {
  Boxes,
  MapPin,
  Layers,
  Search,
  Plus,
  Trash2,
  Settings2,
  GripVertical,
  Check,
  RotateCcw,
  Sparkles,
  Lock,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EquipmentModal } from "@/components/EquipmentModal";
import type { StorageCabinet, StorageMapConfigCabinet, Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { readErrorMessage, networkErrorMessage } from "@/lib/fetch-error";

interface DraggedEquipment {
  id: number;
  name: string;
  fromCabinetName: string;
  fromShelfName: string;
}

/** Deep-copy a layout so edits never mutate props (initialConfig) or previous state. */
function cloneConfig(config: StorageMapConfigCabinet[]): StorageMapConfigCabinet[] {
  return config.map((c) => ({ ...c, shelves: [...c.shelves] }));
}

function configFromCabinets(cabinets: StorageCabinet[]): StorageMapConfigCabinet[] {
  return cabinets.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description || "",
    shelves: c.shelves.map((s) => s.name),
  }));
}

/** Client-side checks mirroring the server's layout validation, for a friendlier message. */
function validateConfig(config: StorageMapConfigCabinet[]): string | null {
  const cabNames = new Set<string>();
  for (const cab of config) {
    const name = cab.name.trim();
    if (!name) return "Every zone needs a name.";
    const key = name.toLowerCase();
    if (cabNames.has(key)) return `Zone names must be unique ("${name}" is used twice).`;
    cabNames.add(key);
    const shelfNames = new Set<string>();
    for (const shelf of cab.shelves) {
      const s = shelf.trim();
      if (!s) return `Zone "${name}" has a shelf with no name.`;
      if (shelfNames.has(s.toLowerCase())) return `Zone "${name}" has two shelves named "${s}".`;
      shelfNames.add(s.toLowerCase());
    }
  }
  return null;
}

interface StorageMapClientProps {
  initialData: StorageCabinet[];
  initialConfig?: StorageMapConfigCabinet[] | null;
  role: Role;
  userName: string;
}

export function StorageMapClient({
  initialData,
  initialConfig,
  role,
  userName,
}: StorageMapClientProps) {
  const isAdmin = role === "admin";
  const [cabinets, setCabinets] = useState<StorageCabinet[]>(initialData);
  const [selectedCabinetId, setSelectedCabinetId] = useState<string>(
    cabinets[0]?.id || ""
  );
  const [search, setSearch] = useState("");
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Drag and drop state
  const [draggedEquipment, setDraggedEquipment] = useState<DraggedEquipment | null>(null);
  const [dragOverShelfId, setDragOverShelfId] = useState<string | null>(null);
  const [dragOverCabinetId, setDragOverCabinetId] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const [pendingMoves, setPendingMoves] = useState(0);
  const isSavingMove = pendingMoves > 0;
  // Every move/refresh response carries the full cabinet list; only the newest request's
  // response may be applied, so an older, slower response can't undo a newer move.
  const cabinetsSeqRef = useRef(0);

  // Custom Layout Dialog state
  const [designerOpen, setDesignerOpen] = useState(false);
  const [configCabinets, setConfigCabinets] = useState<StorageMapConfigCabinet[]>(() => {
    if (initialConfig && initialConfig.length > 0) return cloneConfig(initialConfig);
    return configFromCabinets(cabinets);
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [newCabinetName, setNewCabinetName] = useState("");
  const [newShelfNames, setNewShelfNames] = useState<Record<string, string>>({});

  const activeCabinet = cabinets.find((c) => c.id === selectedCabinetId) || cabinets[0];

  function getStatusDot(status: string) {
    switch (status) {
      case "Available":
        return "bg-green-500 shadow-green-500/50";
      case "Checked Out":
        return "bg-blue-500 shadow-blue-500/50";
      case "Maintenance":
      case "Unavailable (In Repairs)":
        return "bg-amber-500 shadow-amber-500/50";
      case "Missing":
      case "Unavailable (Missing)":
      case "Unavailable (Broken)":
      case "Unavailable (Retired)":
        return "bg-red-500 shadow-red-500/50";
      default:
        return "bg-slate-400";
    }
  }

  function showNotice(message: string) {
    setMoveNotice(message);
    setTimeout(() => setMoveNotice((cur) => (cur === message ? null : cur)), 3500);
  }

  /** Re-fetch the map (e.g. after a failed move) — sequenced like moves. */
  async function reloadCabinets() {
    const seq = ++cabinetsSeqRef.current;
    try {
      const res = await fetch("/api/storage-map");
      if (!res.ok) return;
      const data = (await res.json()) as { cabinets?: unknown };
      if (seq === cabinetsSeqRef.current && Array.isArray(data.cabinets)) {
        setCabinets(data.cabinets as StorageCabinet[]);
      }
    } catch {
      /* keep the current view */
    }
  }

  // --- Move Handler (drag & drop and the tap-friendly "Move to…" menu; Admin Only) ---
  async function handleMoveEquipment(
    item: DraggedEquipment,
    targetCabinetName: string,
    targetShelfName: string
  ) {
    if (!isAdmin) return;
    // Dropping back onto the shelf it came from is a no-op.
    if (item.fromCabinetName === targetCabinetName && item.fromShelfName === targetShelfName) return;

    const seq = ++cabinetsSeqRef.current;
    setPendingMoves((n) => n + 1);

    try {
      const res = await fetch("/api/storage-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move_item",
          equipment_id: item.id,
          cabinet: targetCabinetName,
          shelf: targetShelfName,
        }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to move equipment"));
      }

      const data = (await res.json()) as { cabinets?: unknown };
      // Ignore stale responses: a newer move/refresh has been issued since this one.
      if (seq === cabinetsSeqRef.current && Array.isArray(data.cabinets)) {
        setCabinets(data.cabinets as StorageCabinet[]);
      }
      showNotice(`Relocated "${item.name}" to "${targetCabinetName} - ${targetShelfName}"`);
    } catch (err: unknown) {
      alert(`Error relocating equipment: ${networkErrorMessage(err)}`);
      // If this was the latest request, re-sync so the view reflects the server.
      if (seq === cabinetsSeqRef.current) void reloadCabinets();
    } finally {
      setPendingMoves((n) => Math.max(0, n - 1));
      // Only clear drag state if it still belongs to this drag — a second drag may have
      // started while this request was in flight.
      setDraggedEquipment((cur) => (cur === item ? null : cur));
      setDragOverShelfId(null);
      setDragOverCabinetId(null);
    }
  }

  // --- Save Custom Layout Configuration ---
  async function handleSaveConfig() {
    if (!isAdmin) return;
    const trimmed = configCabinets.map((c) => ({
      ...c,
      name: c.name.trim(),
      shelves: c.shelves.map((s) => s.trim()),
    }));
    const invalid = validateConfig(trimmed);
    if (invalid) {
      setConfigError(invalid);
      return;
    }
    setConfigError(null);
    setIsSavingConfig(true);

    try {
      const res = await fetch("/api/storage-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_config",
          cabinets: trimmed,
        }),
      });

      if (!res.ok) {
        // e.g. 400 validation errors — shown inline in the designer, which stays open.
        setConfigError(await readErrorMessage(res, "Failed to save configuration"));
        return;
      }

      const data = (await res.json()) as { cabinets?: unknown };
      if (Array.isArray(data.cabinets)) {
        const fresh = data.cabinets as StorageCabinet[];
        cabinetsSeqRef.current++; // supersede any in-flight move responses
        setCabinets(fresh);
        if (fresh.length > 0 && !fresh.some((c) => c.id === selectedCabinetId)) {
          setSelectedCabinetId(fresh[0].id);
        }
      }
      setDesignerOpen(false);
      showNotice("Storage layout updated and saved successfully!");
    } catch (err: unknown) {
      setConfigError(`Error saving layout: ${networkErrorMessage(err)}`);
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function handleResetToDefaults() {
    if (!confirm("Reset storage layout to automatic default zones?")) return;
    setIsSavingConfig(true);
    setConfigError(null);
    try {
      const res = await fetch("/api/storage-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_config" }),
      });
      if (!res.ok) {
        setConfigError(await readErrorMessage(res, "Failed to reset layout"));
        return;
      }
      const data = (await res.json()) as { cabinets?: unknown };
      if (Array.isArray(data.cabinets)) {
        const fresh = data.cabinets as StorageCabinet[];
        cabinetsSeqRef.current++;
        setCabinets(fresh);
        setConfigCabinets(configFromCabinets(fresh));
      }
      setDesignerOpen(false);
    } catch (err: unknown) {
      setConfigError(`Reset failed: ${networkErrorMessage(err)}`);
    } finally {
      setIsSavingConfig(false);
    }
  }

  // --- Immutable layout-designer updates ---
  function renameCabinet(cabIdx: number, name: string) {
    setConfigCabinets((prev) => prev.map((c, i) => (i === cabIdx ? { ...c, name } : c)));
  }

  function removeShelf(cabIdx: number, shelfIdx: number) {
    setConfigCabinets((prev) =>
      prev.map((c, i) =>
        i === cabIdx ? { ...c, shelves: c.shelves.filter((_, sIdx) => sIdx !== shelfIdx) } : c
      )
    );
  }

  function addShelf(cabIdx: number, draftKey: string) {
    const name = (newShelfNames[draftKey] || "").trim();
    if (!name) return;
    const cab = configCabinets[cabIdx];
    if (cab && cab.shelves.some((s) => s.trim().toLowerCase() === name.toLowerCase())) {
      setConfigError(`"${cab.name}" already has a shelf named "${name}".`);
      return;
    }
    setConfigError(null);
    setConfigCabinets((prev) =>
      prev.map((c, i) => (i === cabIdx ? { ...c, shelves: [...c.shelves, name] } : c))
    );
    setNewShelfNames((prev) => ({ ...prev, [draftKey]: "" }));
  }

  // Presets
  function applyPreset(type: "studio" | "mobile" | "lockers") {
    if (type === "studio") {
      setConfigCabinets([
        { id: "cab-cam", name: "Cabinet 1 (Cameras & Video)", shelves: ["Shelf A (Main Bodies)", "Shelf B (Cages & Batteries)", "Shelf C (Accessories)"] },
        { id: "cab-lens", name: "Cabinet 2 (Lenses & Glass)", shelves: ["Shelf A (Cinema Primes)", "Shelf B (Zooms & Wide)", "Shelf C (Filters & Adapters)"] },
        { id: "cab-audio", name: "Audio Rack", shelves: ["Wireless Systems", "Shotgun & Lavalier", "Field Recorders & Mixers"] },
        { id: "cab-lighting", name: "Lighting & Grip Bay", shelves: ["LED Panels & COBs", "Light Modifiers", "C-Stands & Booms"] },
        { id: "cab-cable", name: "Cable & Accessories Bay", shelves: ["SDI & HDMI Runs", "XLR & Audio Lines", "Power & D-Tap"] },
      ]);
    } else if (type === "mobile") {
      setConfigCabinets([
        { id: "case-a", name: "Flight Case A (Cameras)", shelves: ["Tier 1 (Main Bodies)", "Tier 2 (Monitors)"] },
        { id: "case-b", name: "Flight Case B (Optics)", shelves: ["Lens Cutouts", "Filters & Cases"] },
        { id: "case-c", name: "Flight Case C (Audio)", shelves: ["Wireless Kits", "Boom Mics"] },
        { id: "grip-cart", name: "Mobile Grip Cart", shelves: ["Top Tray", "Middle Rack", "Bottom Base"] },
      ]);
    } else if (type === "lockers") {
      const lockerCabs: StorageMapConfigCabinet[] = [];
      for (let i = 1; i <= 6; i++) {
        lockerCabs.push({
          id: `locker-${i}`,
          name: `Locker ${i}`,
          shelves: ["Upper Shelf", "Lower Shelf"],
        });
      }
      setConfigCabinets(lockerCabs);
    }
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full space-y-6">
      {/* Move Notice Toast */}
      {moveNotice && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-primary text-primary-foreground px-4 py-3 rounded-xl shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-200">
          <Check className="h-4 w-4 shrink-0" />
          <span className="text-xs sm:text-sm font-medium">{moveNotice}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" />
            Visual Storage & Shelf Map
          </h2>
          <p className="text-muted-foreground text-sm">
            Interactive elevation layout of equipment rooms, lockers, shelves, and storage zones.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isAdmin ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConfigCabinets(configFromCabinets(cabinets));
                setConfigError(null);
                setDesignerOpen(true);
              }}
              className="gap-2 bg-background hover:bg-muted font-medium text-xs shadow-xs"
            >
              <Settings2 className="h-4 w-4 text-primary" />
              Customize Storage Layout
            </Button>
          ) : (
            <Badge variant="outline" className="text-xs py-1 px-2.5 gap-1.5 text-muted-foreground bg-muted/30">
              <Lock className="h-3 w-3" />
              Viewer Mode (Admin required to rearrange)
            </Badge>
          )}

          <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground border-l pl-3 ml-1">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-500 inline-block" /> Available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-500 inline-block" /> Checked Out
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" /> In Repairs
            </span>
          </div>
        </div>
      </div>

      {/* Admin Drag and Drop Guidance Banner */}
      {isAdmin && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 sm:p-4 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <span>
              <strong>Admin Drag & Drop Mode Active:</strong> Drag any equipment card to another shelf or sidebar zone to instantly reassign its storage location. On a phone, use the &ldquo;Move to…&rdquo; menu on each card.
            </span>
          </div>
          {isSavingMove && (
            <Badge variant="secondary" className="animate-pulse shrink-0">
              Updating Location...
            </Badge>
          )}
        </div>
      )}

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter equipment by name or serial number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 text-xs sm:text-sm bg-background"
        />
      </div>

      {cabinets.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <Boxes className="h-10 w-10 mx-auto opacity-30 text-muted-foreground" />
            <p className="font-medium text-foreground">No storage zones configured</p>
            <p className="text-xs max-w-sm mx-auto">
              Click &ldquo;Customize Storage Layout&rdquo; above to set up cabinets and shelves, or assign locations to equipment.
            </p>
            {isAdmin && (
              <Button size="sm" onClick={() => setDesignerOpen(true)} className="gap-2 mt-2">
                <Plus className="h-4 w-4" /> Set Up Initial Layout
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
          {/* Cabinet / Zone Selector Sidebar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Storage Zones & Lockers
              </h3>
              <span className="text-[11px] text-muted-foreground">{cabinets.length} zones</span>
            </div>

            <div className="space-y-1.5">
              {cabinets.map((cab) => {
                const isSelected = cab.id === activeCabinet?.id;
                const isTargetCabinet = dragOverCabinetId === cab.id;
                const totalGear = cab.shelves.reduce((acc, s) => acc + s.items.length, 0);

                return (
                  <button
                    key={cab.id}
                    onClick={() => setSelectedCabinetId(cab.id)}
                    onDragOver={(e) => {
                      if (!isAdmin || !draggedEquipment) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverCabinetId(cab.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverCabinetId === cab.id) setDragOverCabinetId(null);
                    }}
                    onDrop={(e) => {
                      if (!isAdmin || !draggedEquipment) return;
                      e.preventDefault();
                      setDragOverCabinetId(null);
                      const targetShelf = cab.shelves[0]?.name || "Main Shelf";
                      void handleMoveEquipment(draggedEquipment, cab.name, targetShelf);
                    }}
                    className={cn(
                      "w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-3 relative cursor-pointer",
                      isSelected
                        ? "bg-primary/10 border-primary text-primary font-semibold shadow-xs"
                        : "bg-card hover:bg-muted/40 text-foreground",
                      isTargetCabinet && "ring-2 ring-primary bg-primary/20 scale-[1.02]"
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
                      {totalGear}
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
                      {activeCabinet?.description || "Visual elevation of shelves and equipment occupancy."}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {activeCabinet?.shelves.length} Tiers
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 sm:p-6 space-y-6">
                {activeCabinet?.shelves.map((shelf, idx) => {
                  const filteredItems = shelf.items.filter((item) => {
                    if (!search.trim()) return true;
                    const query = search.toLowerCase();
                    return (
                      item.name.toLowerCase().includes(query) ||
                      (item.serial_number && item.serial_number.toLowerCase().includes(query)) ||
                      item.tags.some((t) => t.toLowerCase().includes(query))
                    );
                  });

                  const isShelfDragOver = dragOverShelfId === shelf.id;

                  return (
                    <div key={shelf.id} className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground px-1">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">
                            Tier {idx + 1}
                          </span>
                          <span className="text-foreground font-semibold">{shelf.name}</span>
                        </span>
                        <span>{shelf.items.length} items present</span>
                      </div>

                      {/* Shelf Platform Wireframe & Drop Zone */}
                      <div
                        onDragOver={(e) => {
                          if (!isAdmin || !draggedEquipment) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverShelfId(shelf.id);
                        }}
                        onDragLeave={() => {
                          if (dragOverShelfId === shelf.id) setDragOverShelfId(null);
                        }}
                        onDrop={(e) => {
                          if (!isAdmin || !draggedEquipment) return;
                          e.preventDefault();
                          setDragOverShelfId(null);
                          void handleMoveEquipment(draggedEquipment, activeCabinet.name, shelf.name);
                        }}
                        className={cn(
                          "p-3 rounded-xl min-h-[96px] flex flex-wrap gap-2.5 items-center relative transition-all border-2",
                          isShelfDragOver
                            ? "border-primary bg-primary/10 border-solid scale-[1.01] shadow-md"
                            : "border-dashed border-border bg-muted/15"
                        )}
                      >
                        {isShelfDragOver && (
                          <div className="absolute inset-0 bg-primary/10 rounded-xl flex items-center justify-center pointer-events-none z-10">
                            <span className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-full shadow-sm flex items-center gap-1.5">
                              <ArrowRight className="h-3.5 w-3.5" /> Drop to move to {shelf.name}
                            </span>
                          </div>
                        )}

                        {filteredItems.length === 0 ? (
                          <div className="w-full text-center py-4 text-xs text-muted-foreground italic">
                            {search ? "No matching equipment on this shelf" : "Empty Shelf Slot — drag equipment here to store"}
                          </div>
                        ) : (
                          filteredItems.map((item) => {
                            const isBeingDragged = draggedEquipment?.id === item.id;

                            return (
                              <div
                                key={item.id}
                                draggable={isAdmin}
                                onDragStart={(e) => {
                                  if (!isAdmin) return;
                                  setDraggedEquipment({
                                    id: item.id,
                                    name: item.name,
                                    fromCabinetName: activeCabinet.name,
                                    fromShelfName: shelf.name,
                                  });
                                  e.dataTransfer.setData(
                                    "text/plain",
                                    JSON.stringify({
                                      id: item.id,
                                      cabinet: activeCabinet.name,
                                      shelf: shelf.name,
                                    })
                                  );
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onDragEnd={() => {
                                  setDraggedEquipment(null);
                                  setDragOverShelfId(null);
                                  setDragOverCabinetId(null);
                                }}
                                onClick={() => {
                                  setSelectedEquipmentId(item.id);
                                  setModalOpen(true);
                                }}
                                className={cn(
                                  "group relative bg-card hover:bg-muted/80 border rounded-lg p-2.5 text-left transition-all shadow-2xs hover:shadow-md flex items-center gap-2 max-w-xs min-w-[170px] select-none",
                                  isAdmin ? "cursor-grab active:cursor-grabbing hover:border-primary/50" : "cursor-pointer",
                                  isBeingDragged && "opacity-40 border-primary border-dashed"
                                )}
                              >
                                {isAdmin && (
                                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                                )}
                                <span
                                  className={cn("h-2.5 w-2.5 rounded-full shrink-0 shadow-xs", getStatusDot(item.status))}
                                  title={item.status}
                                />
                                <div className="min-w-0 flex-1 space-y-0.5">
                                  <p className="text-xs font-semibold truncate group-hover:text-primary transition-colors">
                                    {item.name}
                                  </p>
                                  <p className="text-[10px] font-mono text-muted-foreground truncate">
                                    {item.serial_number || `#${item.id}`}
                                  </p>
                                  {isAdmin && (
                                    // Tap-friendly alternative to HTML5 drag & drop (which
                                    // doesn't work on touch devices).
                                    <select
                                      aria-label={`Move ${item.name} to another shelf`}
                                      value=""
                                      disabled={isSavingMove}
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        const [ci, si] = e.target.value.split(":").map(Number);
                                        const targetCab = cabinets[ci];
                                        const targetShelf = targetCab?.shelves[si];
                                        if (!targetCab || !targetShelf) return;
                                        void handleMoveEquipment(
                                          {
                                            id: item.id,
                                            name: item.name,
                                            fromCabinetName: activeCabinet.name,
                                            fromShelfName: shelf.name,
                                          },
                                          targetCab.name,
                                          targetShelf.name
                                        );
                                      }}
                                      className="mt-1 w-full max-w-[160px] rounded border border-input bg-background px-1 py-0.5 text-[10px] text-muted-foreground"
                                    >
                                      <option value="">Move to…</option>
                                      {cabinets.map((cab, ci) => (
                                        <optgroup key={cab.id} label={cab.name}>
                                          {cab.shelves.map((s, si) => (
                                            <option
                                              key={s.id}
                                              value={`${ci}:${si}`}
                                              disabled={cab.name === activeCabinet.name && s.name === shelf.name}
                                            >
                                              {s.name}
                                            </option>
                                          ))}
                                        </optgroup>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Admin Custom Layout Designer Modal */}
      {isAdmin && (
        <Dialog open={designerOpen} onOpenChange={setDesignerOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-primary" />
                Customize Storage Map Layout
              </DialogTitle>
              <DialogDescription>
                Design custom cabinets, lockers, and shelves. Only Admins can modify this layout.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-2">
              {configError && (
                <p
                  role="alert"
                  className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-2.5"
                >
                  {configError}
                </p>
              )}
              {/* Preset Buttons */}
              <div className="bg-muted/30 p-3 rounded-xl border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> Quick Setup Presets
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetToDefaults}
                    className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" /> Reset
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset("studio")}
                    className="text-xs h-7"
                  >
                    Media Studio (5 Zones)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset("mobile")}
                    className="text-xs h-7"
                  >
                    Mobile Production Cases
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => applyPreset("lockers")}
                    className="text-xs h-7"
                  >
                    Locker Grid (1-6)
                  </Button>
                </div>
              </div>

              {/* Cabinets List */}
              <div className="space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Storage Zones & Shelves Configuration
                </h4>

                {configCabinets.map((cab, cabIdx) => {
                  const draftKey = cab.id || String(cabIdx);
                  const seenShelves = new Map<string, number>();
                  return (
                  <Card key={cab.id || cabIdx} className="border p-4 space-y-3 bg-card">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 space-y-1">
                        <Input
                          value={cab.name}
                          onChange={(e) => renameCabinet(cabIdx, e.target.value)}
                          placeholder="Zone / Cabinet Name"
                          className="text-sm font-semibold h-8"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setConfigCabinets((prev) => prev.filter((_, idx) => idx !== cabIdx));
                        }}
                        className="text-destructive hover:bg-destructive/10"
                        title="Delete Zone"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Shelves for this cabinet */}
                    <div className="space-y-2 pl-2 border-l-2 border-primary/20">
                      <div className="flex flex-wrap gap-2 items-center">
                        {cab.shelves.map((shelf, shelfIdx) => {
                          // Stable key from cabinet + shelf name (disambiguated if duplicated).
                          const n = seenShelves.get(shelf) ?? 0;
                          seenShelves.set(shelf, n + 1);
                          return (
                          <div
                            key={`${draftKey}::${shelf}${n ? `::${n}` : ""}`}
                            className="bg-muted px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 border"
                          >
                            <span>{shelf}</span>
                            <button
                              type="button"
                              onClick={() => removeShelf(cabIdx, shelfIdx)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={`Remove shelf ${shelf}`}
                            >
                              &times;
                            </button>
                          </div>
                          );
                        })}
                      </div>

                      {/* Add Shelf Input */}
                      <div className="flex items-center gap-2 pt-1">
                        <Input
                          placeholder="Add new shelf (e.g. Shelf C, Drawer 1)"
                          value={newShelfNames[draftKey] || ""}
                          onChange={(e) =>
                            setNewShelfNames((prev) => ({ ...prev, [draftKey]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addShelf(cabIdx, draftKey);
                            }
                          }}
                          className="text-xs h-7 flex-1"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => addShelf(cabIdx, draftKey)}
                          className="h-7 text-xs px-2.5"
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add Shelf
                        </Button>
                      </div>
                    </div>
                  </Card>
                  );
                })}

                {/* Add New Cabinet Section */}
                <div className="flex items-center gap-2 pt-2">
                  <Input
                    placeholder="New Zone Name (e.g. Charging Station, Pelican Rack)"
                    value={newCabinetName}
                    onChange={(e) => setNewCabinetName(e.target.value)}
                    className="text-xs sm:text-sm h-8"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const name = newCabinetName.trim();
                      if (!name) return;
                      setConfigCabinets((prev) => [
                        ...prev,
                        {
                          id: `zone-${Date.now()}`,
                          name,
                          shelves: ["Shelf A", "Shelf B"],
                        },
                      ]);
                      setNewCabinetName("");
                    }}
                    className="h-8 text-xs shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Zone
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter className="mt-4 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDesignerOpen(false)}
                disabled={isSavingConfig}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveConfig}
                disabled={isSavingConfig}
                className="gap-2"
              >
                {isSavingConfig ? "Saving Layout..." : "Save Layout"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Equipment Detail Modal */}
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
          onUpdated={() => {
            void reloadCabinets();
          }}
        />
      )}
    </div>
  );
}
