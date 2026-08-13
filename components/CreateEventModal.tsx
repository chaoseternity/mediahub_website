"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { User } from "@/lib/types";

interface CreateEventModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateEventModal({ open, onClose, onCreated }: CreateEventModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [selectedIcIds, setSelectedIcIds] = useState<number[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setLocation("");
      setStartTime("");
      setEndTime("");
      setSelectedIcIds([]);
      setError(null);
      fetch("/api/users")
        .then((r) => r.json())
        .then((data: User[]) => setAllUsers(data))
        .catch(() => setAllUsers([]));
    }
  }, [open]);

  function toggleIc(userId: number) {
    setSelectedIcIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !location || !startTime || !endTime) {
      setError("Please fill out all required fields.");
      return;
    }

    if (new Date(endTime) <= new Date(startTime)) {
      setError("End time must be after start time.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          location,
          start_time: new Date(startTime).toISOString(),
          end_time: new Date(endTime).toISOString(),
          ic_user_ids: selectedIcIds,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message ?? data.error ?? "Failed to create event");
      }

      onCreated();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Event</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="event-name">Event Name *</Label>
            <Input
              id="event-name"
              placeholder="e.g. Annual School Concert"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-location">Location *</Label>
            <Input
              id="event-location"
              placeholder="e.g. Main Auditorium"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="start-time">Start Time & Date *</Label>
              <Input
                id="start-time"
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-time">End Time & Date *</Label>
              <Input
                id="end-time"
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-description">Description</Label>
            <Input
              id="event-description"
              placeholder="Brief details about the event…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2 pt-2">
            <Label>Assign In-Charges (ICs)</Label>
            <p className="text-xs text-muted-foreground">Select users responsible for managing equipment in this event:</p>
            <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1 bg-muted/20">
              {allUsers.length === 0 ? (
                <p className="text-xs text-muted-foreground">No users available</p>
              ) : (
                allUsers.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm p-1.5 hover:bg-accent rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIcIds.includes(u.id)}
                      onChange={() => toggleIc(u.id)}
                      className="rounded border-input text-primary"
                    />
                    <span className="font-medium">{u.name}</span>
                    <span className="text-xs text-muted-foreground">({u.email})</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create Event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
