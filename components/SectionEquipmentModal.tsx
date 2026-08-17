"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Check } from "lucide-react";
import type { Equipment, EventSection } from "@/lib/types";

interface SectionEquipmentModalProps {
  eventId: number | null;
  section: EventSection | null;
  currentlyAttachedEqIds: number[];
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

export function SectionEquipmentModal({
  eventId,
  section,
  currentlyAttachedEqIds,
  open,
  onClose,
  onUpdated,
}: SectionEquipmentModalProps) {
  const [allEquipment, setAllEquipment] = useState<Equipment[]>([]);
  const [search, setSearch] = useState("");
  const [selectedEqIds, setSelectedEqIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && eventId && section) {
      setSearch("");
      setSelectedEqIds([...currentlyAttachedEqIds]);
      setError(null);

      fetch("/api/equipment")
        .then((r) => r.json())
        .then((data: Equipment[]) => setAllEquipment(data))
        .catch(() => setAllEquipment([]));
    }
  }, [open, eventId, section, currentlyAttachedEqIds]);

  const filteredEquipment = allEquipment.filter(
    (eq) =>
      eq.name.toLowerCase().includes(search.toLowerCase()) ||
      eq.location.toLowerCase().includes(search.toLowerCase()) ||
      (eq.tags && eq.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())))
  );

  // Toggle selection: clicking a selected equipment unselects it!
  function toggleEquipment(id: number) {
    setSelectedEqIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    if (!eventId || !section) return;
    setSubmitting(true);
    setError(null);

    try {
      // Find additions and removals compared to initial currentlyAttachedEqIds
      const toAdd = selectedEqIds.filter((id) => !currentlyAttachedEqIds.includes(id));
      const toRemove = currentlyAttachedEqIds.filter((id) => !selectedEqIds.includes(id));

      for (const eqId of toAdd) {
        const res = await fetch(`/api/events/${eventId}/section`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add_equipment",
            section,
            equipment_id: eqId,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Failed to attach equipment to section");
        }
      }

      for (const eqId of toRemove) {
        const res = await fetch(`/api/events/${eventId}/section`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "remove_equipment",
            section,
            equipment_id: eqId,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Failed to remove equipment from section");
        }
      }

      onUpdated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col w-[95vw]">
        <DialogHeader>
          <DialogTitle className="capitalize">Select {section} Equipment</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 flex-1 overflow-hidden flex flex-col">
          {error && <p className="text-xs text-destructive font-medium bg-destructive/10 p-2 rounded-md">{error}</p>}

          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search equipment by name, location, or tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 text-xs h-8"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Click an equipment item to toggle selection. Click selected items to unselect.
          </p>

          <div className="flex-1 overflow-y-auto border rounded-md divide-y bg-muted/10">
            {filteredEquipment.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No equipment found matching search</p>
            ) : (
              filteredEquipment.map((eq) => {
                const isSelected = selectedEqIds.includes(eq.id);

                return (
                  <div
                    key={eq.id}
                    onClick={() => toggleEquipment(eq.id)}
                    className={`p-2.5 flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/10 border-l-4 border-primary font-medium"
                        : "hover:bg-accent"
                    }`}
                  >
                    <div>
                      <p className="text-xs font-semibold">{eq.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {eq.location} • Status: {eq.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {eq.tags && eq.tags.length > 0 && (
                        <span className="text-[9px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                          {eq.tags.join(", ")}
                        </span>
                      )}
                      <div
                        className={`h-4 w-4 rounded border flex items-center justify-center ${
                          isSelected ? "bg-primary text-primary-foreground border-primary" : "border-input"
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter className="pt-2 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving…" : "Save Selection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
