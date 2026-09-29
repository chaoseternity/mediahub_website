"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Equipment } from "@/lib/types";
import { readErrorMessage, networkErrorMessage } from "@/lib/fetch-error";

interface AddEquipmentToEventModalProps {
  eventId: number | null;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export function AddEquipmentToEventModal({ eventId, open, onClose, onAdded }: AddEquipmentToEventModalProps) {
  const [allEquipment, setAllEquipment] = useState<Equipment[]>([]);
  const [selectedEqId, setSelectedEqId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && eventId) {
      setSelectedEqId(null);
      setError(null);
      const controller = new AbortController();
      fetch("/api/equipment", { signal: controller.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(await readErrorMessage(r, "Failed to load equipment"));
          return r.json() as Promise<unknown>;
        })
        .then((data) => {
          if (controller.signal.aborted) return;
          setAllEquipment(Array.isArray(data) ? (data as Equipment[]) : []);
          if (!Array.isArray(data)) setError("Failed to load equipment: unexpected response");
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setAllEquipment([]);
          setError(networkErrorMessage(err, "Failed to load equipment — check your connection."));
        });
      return () => controller.abort();
    }
  }, [open, eventId]);

  async function handleAdd() {
    if (!eventId || !selectedEqId) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/events/${eventId}/equipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipment_id: selectedEqId }),
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to add equipment to event"));
      }

      onAdded();
      onClose();
    } catch (err: unknown) {
      setError(networkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Attach Equipment to Event</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <p className="text-xs text-muted-foreground">Select an equipment item to assign to this event:</p>

          <div className="max-h-60 overflow-y-auto border rounded-md divide-y bg-muted/20">
            {allEquipment.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No equipment available</p>
            ) : (
              allEquipment.map((eq) => (
                <button
                  type="button"
                  key={eq.id}
                  onClick={() => setSelectedEqId(eq.id)}
                  className={`w-full text-left p-2.5 flex items-center justify-between hover:bg-accent transition-colors ${
                    selectedEqId === eq.id ? "bg-primary/10 border-l-4 border-primary" : ""
                  }`}
                >
                  <div>
                    <p className="font-medium text-sm">{eq.name}</p>
                    <p className="text-xs text-muted-foreground">{eq.location} • Status: {eq.status}</p>
                  </div>
                  {eq.tags && eq.tags.length > 0 && (
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      {eq.tags.join(", ")}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleAdd} disabled={!selectedEqId || submitting}>
            {submitting ? "Attaching…" : "Attach Equipment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
