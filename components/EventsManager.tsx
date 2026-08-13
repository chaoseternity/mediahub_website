"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin, Clock, Users, Plus, Trash2, Package } from "lucide-react";
import { CreateEventModal } from "./CreateEventModal";
import { AddEquipmentToEventModal } from "./AddEquipmentToEventModal";
import type { AppEvent, Role, User } from "@/lib/types";

interface EventsManagerProps {
  initialEvents: AppEvent[];
  role: Role;
  currentUserId: number | null;
}

export function EventsManager({ initialEvents, role, currentUserId }: EventsManagerProps) {
  const [events, setEvents] = useState<AppEvent[]>(initialEvents);
  const [activeTab, setActiveTab] = useState<"All" | "Ongoing" | "Upcoming" | "Completed">("All");
  const [createOpen, setCreateOpen] = useState(false);
  const [attachEventId, setAttachEventId] = useState<number | null>(null);

  const isAdmin = role === "admin";

  async function refresh() {
    const res = await fetch("/api/events");
    const data: AppEvent[] = await res.json();
    setEvents(data);
  }

  async function handleDeleteEvent(id: number) {
    if (!confirm("Are you sure you want to delete this event?")) return;
    try {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
      if (res.ok) refresh();
    } catch {
      // Ignore
    }
  }

  async function handleDetachEquipment(eventId: number, equipmentId: number) {
    try {
      const res = await fetch(`/api/events/${eventId}/equipment`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipment_id: equipmentId }),
      });
      if (res.ok) refresh();
    } catch {
      // Ignore
    }
  }

  const filteredEvents = events.filter((ev) => {
    if (activeTab === "All") return true;
    return ev.status === activeTab;
  });

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 max-w-screen-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            Events
          </h2>
          <p className="text-muted-foreground text-sm">
            Manage upcoming, ongoing, and past events & assign equipment ICs
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)} className="sm:w-auto">
            <Plus className="h-4 w-4 mr-1.5" />
            Create Event
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        {(["All", "Ongoing", "Upcoming", "Completed"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Events List */}
      {filteredEvents.length === 0 ? (
        <div className="text-center py-12 border rounded-xl bg-muted/10">
          <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="text-muted-foreground text-sm font-medium">No events found in this category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredEvents.map((ev) => {
            const isUserIc = currentUserId ? ev.ics.some((ic) => ic.id === currentUserId) : false;
            const canManageEquipment = isAdmin || isUserIc;

            return (
              <div
                key={ev.id}
                className={`border rounded-xl p-5 bg-card text-card-foreground shadow-sm transition-all flex flex-col justify-between ${
                  ev.status === "Ongoing" ? "ring-2 ring-emerald-500/50 bg-emerald-50/10" : ""
                }`}
              >
                <div>
                  {/* Event status & title */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-lg font-semibold">{ev.name}</h3>
                    <Badge
                      className={
                        ev.status === "Ongoing"
                          ? "bg-emerald-600 text-white animate-pulse"
                          : ev.status === "Upcoming"
                          ? "bg-blue-600 text-white"
                          : "bg-muted text-muted-foreground"
                      }
                    >
                      {ev.status}
                    </Badge>
                  </div>

                  {ev.description && (
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{ev.description}</p>
                  )}

                  {/* Details info */}
                  <div className="space-y-2 text-sm text-muted-foreground mb-4">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 shrink-0 text-primary" />
                      <span>{ev.location}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 shrink-0 text-primary" />
                      <span>
                        {new Date(ev.start_time).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}{" "}
                        –{" "}
                        {new Date(ev.end_time).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Assigned ICs */}
                  <div className="mb-4 pt-3 border-t">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2">
                      <Users className="h-3.5 w-3.5" />
                      In-Charges (ICs) ({ev.ics.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ev.ics.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">No ICs assigned</span>
                      ) : (
                        ev.ics.map((ic) => (
                          <Badge key={ic.id} variant="secondary" className="text-xs font-normal">
                            {ic.name}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Attached Equipment */}
                  <div className="mb-4 pt-3 border-t">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                        <Package className="h-3.5 w-3.5" />
                        Attached Equipment ({ev.equipment.length})
                      </div>
                      {canManageEquipment && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2 text-primary"
                          onClick={() => setAttachEventId(ev.id)}
                        >
                          + Add Equipment
                        </Button>
                      )}
                    </div>

                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      {ev.equipment.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">No equipment attached yet</p>
                      ) : (
                        ev.equipment.map((eq) => (
                          <div
                            key={eq.id}
                            className="flex items-center justify-between bg-muted/40 px-2.5 py-1.5 rounded-md text-xs"
                          >
                            <span className="font-medium truncate mr-2">{eq.name}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] text-muted-foreground">{eq.location}</span>
                              {canManageEquipment && (
                                <button
                                  type="button"
                                  onClick={() => handleDetachEquipment(ev.id, eq.id)}
                                  className="text-destructive hover:text-destructive/80 p-0.5"
                                  title="Detach equipment"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer action for Admin */}
                {isAdmin && (
                  <div className="pt-3 border-t flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => handleDeleteEvent(ev.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Delete Event
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Event Modal */}
      <CreateEventModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={refresh}
      />

      {/* Attach Equipment Modal */}
      <AddEquipmentToEventModal
        eventId={attachEventId}
        open={attachEventId !== null}
        onClose={() => setAttachEventId(null)}
        onAdded={refresh}
      />
    </div>
  );
}

function X({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
