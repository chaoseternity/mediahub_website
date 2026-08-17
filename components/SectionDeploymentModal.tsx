"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Check } from "lucide-react";
import type { User, EventSection } from "@/lib/types";

interface SectionDeploymentModalProps {
  eventId: number | null;
  section: EventSection | null;
  currentlyDeployedUserIds: number[];
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

export function SectionDeploymentModal({
  eventId,
  section,
  currentlyDeployedUserIds,
  open,
  onClose,
  onUpdated,
}: SectionDeploymentModalProps) {
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && eventId && section) {
      setSearch("");
      setSelectedUserIds([...currentlyDeployedUserIds]);
      setError(null);

      fetch("/api/users")
        .then((r) => r.json())
        .then((data: User[]) => setAllUsers(data))
        .catch(() => setAllUsers([]));
    }
  }, [open, eventId, section, currentlyDeployedUserIds]);

  const filteredUsers = allUsers.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  function toggleUser(id: number) {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    if (!eventId || !section) return;
    setSubmitting(true);
    setError(null);

    try {
      const toAdd = selectedUserIds.filter((id) => !currentlyDeployedUserIds.includes(id));
      const toRemove = currentlyDeployedUserIds.filter((id) => !selectedUserIds.includes(id));

      for (const uid of toAdd) {
        const res = await fetch(`/api/events/${eventId}/section`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add_deployment",
            section,
            user_id: uid,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Failed to add member deployment");
        }
      }

      for (const uid of toRemove) {
        const res = await fetch(`/api/events/${eventId}/section`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "remove_deployment",
            section,
            user_id: uid,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Failed to remove member deployment");
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
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col w-[95vw]">
        <DialogHeader>
          <DialogTitle className="capitalize">Deploy {section} Members</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 flex-1 overflow-hidden flex flex-col">
          {error && <p className="text-xs text-destructive font-medium bg-destructive/10 p-2 rounded-md">{error}</p>}

          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search users by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 text-xs h-8"
            />
          </div>

          <p className="text-xs text-muted-foreground">Select users to deploy for the {section} section.</p>

          <div className="flex-1 overflow-y-auto border rounded-md divide-y bg-muted/10">
            {filteredUsers.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No users found matching search</p>
            ) : (
              filteredUsers.map((u) => {
                const isSelected = selectedUserIds.includes(u.id);

                return (
                  <div
                    key={u.id}
                    onClick={() => toggleUser(u.id)}
                    className={`p-2.5 flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected ? "bg-primary/10 border-l-4 border-primary font-medium" : "hover:bg-accent"
                    }`}
                  >
                    <div>
                      <p className="text-xs font-semibold">{u.name}</p>
                      <p className="text-[10px] text-muted-foreground">{u.email}</p>
                    </div>
                    <div
                      className={`h-4 w-4 rounded border flex items-center justify-center ${
                        isSelected ? "bg-primary text-primary-foreground border-primary" : "border-input"
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
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
            {submitting ? "Saving…" : "Save Deployments"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
