"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { AppEvent, EventSection } from "@/lib/types";

interface SectionRehearsalModalProps {
  event: AppEvent | null;
  section: EventSection | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

export function SectionRehearsalModal({
  event,
  section,
  open,
  onClose,
  onUpdated,
}: SectionRehearsalModalProps) {
  const [participating, setParticipating] = useState(false);
  const [selectedEqIds, setSelectedEqIds] = useState<number[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && event && section) {
      const rehConfig = event.section_rehearsals[section];
      setParticipating(rehConfig?.participating ?? false);

      const sectionEqs = event.section_equipment[section] || [];
      setSelectedEqIds(sectionEqs.filter((e) => e.used_for_rehearsal).map((e) => e.id));

      const sectionDeps = event.section_deployments[section] || [];
      setSelectedUserIds(sectionDeps.filter((d) => d.attending_rehearsal).map((d) => d.id));

      setError(null);
    }
  }, [open, event, section]);

  if (!event || !section) return null;

  const sectionEqs = event.section_equipment[section] || [];
  const sectionDeps = event.section_deployments[section] || [];

  function toggleId(list: number[], id: number) {
    return list.includes(id) ? list.filter((i) => i !== id) : [...list, id];
  }

  async function handleSave() {
    if (!event || !section) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/events/${event.id}/section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_rehearsal",
          section,
          participating,
          rehearsal_equipment_ids: participating ? selectedEqIds : [],
          rehearsal_user_ids: participating ? selectedUserIds : [],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save rehearsal options");
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
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="capitalize">{section} Section Rehearsal Options</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 flex-1 overflow-y-auto">
          {error && <p className="text-xs text-destructive font-medium bg-destructive/10 p-2 rounded-md">{error}</p>}

          <label className="flex items-center gap-2 p-3 border rounded-lg bg-muted/20 cursor-pointer font-medium text-sm">
            <input
              type="checkbox"
              checked={participating}
              onChange={(e) => setParticipating(e.target.checked)}
              className="rounded border-input text-primary h-4 w-4"
            />
            <span>Our {section.toUpperCase()} section is going for the rehearsal</span>
          </label>

          {participating && (
            <>
              {/* Select Equipment needed for Rehearsal */}
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs font-semibold">Equipment Needed for Rehearsal</Label>
                <p className="text-[11px] text-muted-foreground">Select which attached equipment items will be used for rehearsal:</p>

                <div className="max-h-36 overflow-y-auto border rounded-md p-1.5 space-y-1 bg-muted/10">
                  {sectionEqs.length === 0 ? (
                    <p className="p-2 text-xs text-muted-foreground italic">No equipment attached to this section yet</p>
                  ) : (
                    sectionEqs.map((eq) => (
                      <label key={eq.id} className="flex items-center gap-2 text-xs p-1 hover:bg-accent rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEqIds.includes(eq.id)}
                          onChange={() => setSelectedEqIds(toggleId(selectedEqIds, eq.id))}
                          className="rounded border-input text-primary"
                        />
                        <span className="font-medium">{eq.name}</span>
                        <span className="text-[10px] text-muted-foreground">({eq.location})</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Select Deployed Members attending Rehearsal */}
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs font-semibold">Deployed Members Attending Rehearsal</Label>
                <p className="text-[11px] text-muted-foreground">Select which deployed crew members need to come for rehearsal:</p>

                <div className="max-h-36 overflow-y-auto border rounded-md p-1.5 space-y-1 bg-muted/10">
                  {sectionDeps.length === 0 ? (
                    <p className="p-2 text-xs text-muted-foreground italic">No members deployed for this section yet</p>
                  ) : (
                    sectionDeps.map((dep) => (
                      <label key={dep.id} className="flex items-center gap-2 text-xs p-1 hover:bg-accent rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(dep.id)}
                          onChange={() => setSelectedUserIds(toggleId(selectedUserIds, dep.id))}
                          className="rounded border-input text-primary"
                        />
                        <span className="font-medium">{dep.name}</span>
                        <span className="text-[10px] text-muted-foreground">({dep.email})</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="pt-2 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving…" : "Save Rehearsal Options"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
