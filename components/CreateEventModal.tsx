"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, UserCheck, ShieldAlert } from "lucide-react";
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

  const [hasRehearsal, setHasRehearsal] = useState(false);
  const [rehearsalStartTime, setRehearsalStartTime] = useState("");
  const [rehearsalEndTime, setRehearsalEndTime] = useState("");

  const [userSearch, setUserSearch] = useState("");
  const [allUsers, setAllUsers] = useState<User[]>([]);

  const [selectedOicIds, setSelectedOicIds] = useState<number[]>([]);
  const [selectedPhotoIcIds, setSelectedPhotoIcIds] = useState<number[]>([]);
  const [selectedVideoIcIds, setSelectedVideoIcIds] = useState<number[]>([]);
  const [selectedAvIcIds, setSelectedAvIcIds] = useState<number[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setLocation("");
      setStartTime("");
      setEndTime("");
      setHasRehearsal(false);
      setRehearsalStartTime("");
      setRehearsalEndTime("");
      setUserSearch("");
      setSelectedOicIds([]);
      setSelectedPhotoIcIds([]);
      setSelectedVideoIcIds([]);
      setSelectedAvIcIds([]);
      setError(null);

      fetch("/api/users")
        .then((r) => r.json())
        .then((data: User[]) => setAllUsers(data))
        .catch(() => setAllUsers([]));
    }
  }, [open]);

  const filteredUsers = allUsers.filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.username && u.username.toLowerCase().includes(userSearch.toLowerCase()))
  );

  function toggleId(list: number[], id: number) {
    return list.includes(id) ? list.filter((i) => i !== id) : [...list, id];
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

    if (hasRehearsal) {
      if (!rehearsalStartTime || !rehearsalEndTime) {
        setError("Please specify rehearsal start and end times.");
        return;
      }
      if (new Date(rehearsalEndTime) <= new Date(rehearsalStartTime)) {
        setError("Rehearsal end time must be after rehearsal start time.");
        return;
      }
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
          has_rehearsal: hasRehearsal,
          rehearsal_start_time: hasRehearsal ? new Date(rehearsalStartTime).toISOString() : undefined,
          rehearsal_end_time: hasRehearsal ? new Date(rehearsalEndTime).toISOString() : undefined,
          oic_user_ids: selectedOicIds,
          photo_ic_ids: selectedPhotoIcIds,
          video_ic_ids: selectedVideoIcIds,
          av_ic_ids: selectedAvIcIds,
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Create New Event</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-2">
          {error && <p className="text-sm text-destructive font-medium bg-destructive/10 p-2.5 rounded-md">{error}</p>}

          {/* Event Details */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold border-b pb-1">1. Event Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="event-name">Event Name *</Label>
                <Input
                  id="event-name"
                  placeholder="e.g. Annual Media Festival"
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

              <div className="space-y-1.5">
                <Label htmlFor="event-description">Description</Label>
                <Input
                  id="event-description"
                  placeholder="Brief details…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="start-time">Event Start Date & Time *</Label>
                <Input
                  id="start-time"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="end-time">Event End Date & Time *</Label>
                <Input
                  id="end-time"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          {/* Rehearsal Config */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">2. Rehearsal Schedule</h3>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasRehearsal}
                  onChange={(e) => setHasRehearsal(e.target.checked)}
                  className="rounded border-input text-primary"
                />
                This event has a rehearsal
              </label>
            </div>

            {hasRehearsal && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-muted/20 p-3 rounded-lg border">
                <div className="space-y-1.5">
                  <Label htmlFor="reh-start">Rehearsal Start *</Label>
                  <Input
                    id="reh-start"
                    type="datetime-local"
                    value={rehearsalStartTime}
                    onChange={(e) => setRehearsalStartTime(e.target.value)}
                    required={hasRehearsal}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reh-end">Rehearsal End *</Label>
                  <Input
                    id="reh-end"
                    type="datetime-local"
                    value={rehearsalEndTime}
                    onChange={(e) => setRehearsalEndTime(e.target.value)}
                    required={hasRehearsal}
                  />
                </div>
              </div>
            )}
          </div>

          {/* User Search & Assignments */}
          <div className="space-y-4 pt-2 border-t">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold">3. OIC & Section IC Assignments</h3>
              <div className="relative w-64">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search users by name/email…"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>

            {/* OIC Section */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" />
                Overall In-Charges (OICs)
              </Label>
              <div className="max-h-36 overflow-y-auto border rounded-md p-2 space-y-1 bg-purple-50/10">
                {filteredUsers.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-xs p-1 hover:bg-accent rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedOicIds.includes(u.id)}
                      onChange={() => setSelectedOicIds(toggleId(selectedOicIds, u.id))}
                      className="rounded border-input text-primary"
                    />
                    <span className="font-medium">{u.name}</span>
                    <span className="text-[10px] text-muted-foreground">({u.email})</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 3 Section ICs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Photo ICs */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5" />
                  Photo ICs
                </Label>
                <div className="max-h-36 overflow-y-auto border rounded-md p-1.5 space-y-1 bg-muted/10">
                  {filteredUsers.map((u) => (
                    <label key={u.id} className="flex items-center gap-1.5 text-xs p-1 hover:bg-accent rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPhotoIcIds.includes(u.id)}
                        onChange={() => setSelectedPhotoIcIds(toggleId(selectedPhotoIcIds, u.id))}
                        className="rounded border-input text-primary"
                      />
                      <span className="truncate">{u.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Video ICs */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5" />
                  Video ICs
                </Label>
                <div className="max-h-36 overflow-y-auto border rounded-md p-1.5 space-y-1 bg-muted/10">
                  {filteredUsers.map((u) => (
                    <label key={u.id} className="flex items-center gap-1.5 text-xs p-1 hover:bg-accent rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedVideoIcIds.includes(u.id)}
                        onChange={() => setSelectedVideoIcIds(toggleId(selectedVideoIcIds, u.id))}
                        className="rounded border-input text-primary"
                      />
                      <span className="truncate">{u.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* AV ICs */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5" />
                  AV ICs
                </Label>
                <div className="max-h-36 overflow-y-auto border rounded-md p-1.5 space-y-1 bg-muted/10">
                  {filteredUsers.map((u) => (
                    <label key={u.id} className="flex items-center gap-1.5 text-xs p-1 hover:bg-accent rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedAvIcIds.includes(u.id)}
                        onChange={() => setSelectedAvIcIds(toggleId(selectedAvIcIds, u.id))}
                        className="rounded border-input text-primary"
                      />
                      <span className="truncate">{u.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2 border-t">
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
