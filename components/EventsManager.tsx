"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  MapPin,
  Clock,
  Plus,
  Trash2,
  Package,
  Users,
  ShieldAlert,
  UserCheck,
  Edit,
  Sliders,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Mail,
  X,
} from "lucide-react";
import { CreateEventModal } from "./CreateEventModal";
import { EditEventModal } from "./EditEventModal";
import { SectionEquipmentModal } from "./SectionEquipmentModal";
import { SectionDeploymentModal } from "./SectionDeploymentModal";
import { SectionRehearsalModal } from "./SectionRehearsalModal";
import type { AppEvent, Role, EventSection } from "@/lib/types";

interface EventsManagerProps {
  initialEvents: AppEvent[];
  role: Role;
  currentUserId: number | null;
}

export function EventsManager({ initialEvents, role, currentUserId }: EventsManagerProps) {
  const [events, setEvents] = useState<AppEvent[]>(initialEvents);
  const [activeTab, setActiveTab] = useState<"All" | "Ongoing" | "Upcoming" | "Completed">("All");

  const [createOpen, setCreateOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<AppEvent | null>(null);

  // Section management states
  const [equipmentModalTarget, setEquipmentModalTarget] = useState<{ eventId: number; section: EventSection } | null>(null);
  const [deploymentModalTarget, setDeploymentModalTarget] = useState<{ eventId: number; section: EventSection } | null>(null);
  const [rehearsalModalTarget, setRehearsalModalTarget] = useState<{ event: AppEvent; section: EventSection } | null>(null);

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

  async function handleRemoveEquipment(eventId: number, section: EventSection, equipmentId: number) {
    try {
      const res = await fetch(`/api/events/${eventId}/section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_equipment", section, equipment_id: equipmentId }),
      });
      if (res.ok) refresh();
    } catch {
      // Ignore
    }
  }

  async function handleRemoveDeployment(eventId: number, section: EventSection, userId: number) {
    try {
      const res = await fetch(`/api/events/${eventId}/section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_deployment", section, user_id: userId }),
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
    <div className="px-4 py-4 md:px-6 md:py-8 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            Events
          </h2>
          <p className="text-muted-foreground text-sm">
            Manage OICs, Section ICs (Photo, Video, AV), section equipment, deployments, and rehearsal schedules
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
        <div className="space-y-6">
          {filteredEvents.map((ev) => {
            const isOic = currentUserId ? ev.oics.some((u) => u.id === currentUserId) : false;
            const canEditDetails = isAdmin || isOic;

            const sectionCanManage: Record<EventSection, boolean> = {
              photo: isAdmin || isOic || (currentUserId ? ev.section_ics.photo.some((u) => u.id === currentUserId) : false),
              video: isAdmin || isOic || (currentUserId ? ev.section_ics.video.some((u) => u.id === currentUserId) : false),
              av: isAdmin || isOic || (currentUserId ? ev.section_ics.av.some((u) => u.id === currentUserId) : false),
            };

            return (
              <div
                key={ev.id}
                className={`border rounded-xl p-5 bg-card text-card-foreground shadow-sm transition-all space-y-4 ${
                  ev.status === "Ongoing" ? "ring-2 ring-emerald-500/50 bg-emerald-50/10" : ""
                }`}
              >
                {/* Header row */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold">{ev.name}</h3>
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

                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 text-primary" />
                        {ev.location}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        {new Date(ev.start_time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} –{" "}
                        {new Date(ev.end_time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                      {ev.has_rehearsal && (
                        <span className="flex items-center gap-1 font-medium text-purple-700 dark:text-purple-300">
                          <Sliders className="h-3.5 w-3.5" />
                          Rehearsal: {new Date(ev.rehearsal_start_time!).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {canEditDetails && (
                      <Button variant="outline" size="sm" onClick={() => setEditEvent(ev)}>
                        <Edit className="h-3.5 w-3.5 mr-1" />
                        Edit Event Details
                      </Button>
                    )}
                    {isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteEvent(ev.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>

                {ev.description && <p className="text-sm text-muted-foreground">{ev.description}</p>}

                {/* OICs list */}
                <div className="flex items-center gap-2 text-xs bg-purple-50/20 p-2.5 rounded-lg border border-purple-200/40">
                  <ShieldAlert className="h-4 w-4 text-purple-600 shrink-0" />
                  <span className="font-semibold text-purple-900 dark:text-purple-200 shrink-0">Overall In-Charges (OICs):</span>
                  <div className="flex flex-wrap gap-1">
                    {ev.oics.length === 0 ? (
                      <span className="italic text-muted-foreground">None assigned</span>
                    ) : (
                      ev.oics.map((u) => (
                        <Badge key={u.id} variant="secondary" className="text-xs bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300">
                          {u.name}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                {/* 3 Section Columns: Photo, Video, AV */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
                  {(["photo", "video", "av"] as EventSection[]).map((sec) => {
                    const secName = sec.toUpperCase();
                    const secIcs = ev.section_ics[sec] || [];
                    const secEqs = ev.section_equipment[sec] || [];
                    const secDeps = ev.section_deployments[sec] || [];
                    const rehConfig = ev.section_rehearsals[sec];
                    const isAllowedToEditSec = sectionCanManage[sec];

                    const accentClass =
                      sec === "photo"
                        ? "border-blue-200 bg-blue-50/10 dark:border-blue-900"
                        : sec === "video"
                        ? "border-emerald-200 bg-emerald-50/10 dark:border-emerald-900"
                        : "border-amber-200 bg-amber-50/10 dark:border-amber-900";

                    return (
                      <div key={sec} className={`border rounded-xl p-3.5 space-y-3 ${accentClass}`}>
                        {/* Section Header */}
                        <div className="flex items-center justify-between border-b pb-2">
                          <h4 className="font-bold text-sm flex items-center gap-1.5">
                            <UserCheck className="h-4 w-4 text-primary" />
                            {secName} Section
                          </h4>

                          {ev.has_rehearsal && isAllowedToEditSec && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[11px] px-2 text-purple-700 dark:text-purple-300 hover:bg-purple-100/50"
                              onClick={() => setRehearsalModalTarget({ event: ev, section: sec })}
                            >
                              <Sliders className="h-3 w-3 mr-1" />
                              Rehearsal Options
                            </Button>
                          )}
                        </div>

                        {/* Rehearsal Participation Badge */}
                        {ev.has_rehearsal && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-muted-foreground font-medium">Rehearsal:</span>
                            {rehConfig?.participating ? (
                              <Badge className="bg-emerald-600 text-white text-[10px] flex items-center gap-1">
                                <CheckCircle className="h-3 w-3" /> Attending
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <XCircle className="h-3 w-3" /> Not Attending
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Section ICs */}
                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground mb-1">{secName} ICs ({secIcs.length})</p>
                          <div className="flex flex-wrap gap-1">
                            {secIcs.length === 0 ? (
                              <span className="text-xs text-muted-foreground italic">No ICs assigned</span>
                            ) : (
                              secIcs.map((ic) => (
                                <Badge key={ic.id} variant="secondary" className="text-[11px]">
                                  {ic.name}
                                </Badge>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Section Equipment */}
                        <div className="space-y-1.5 pt-2 border-t">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                              <Package className="h-3 w-3" />
                              {secName} Equipment ({secEqs.length})
                            </span>
                            {isAllowedToEditSec && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[11px] px-1.5 text-primary"
                                onClick={() => setEquipmentModalTarget({ eventId: ev.id, section: sec })}
                              >
                                + Add/Edit
                              </Button>
                            )}
                          </div>

                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {secEqs.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">No equipment added</p>
                            ) : (
                              secEqs.map((eq) => (
                                <div key={eq.id} className="flex items-center justify-between bg-muted/40 px-2 py-1 rounded text-xs">
                                  <div className="flex items-center gap-1.5 truncate mr-1">
                                    <span className="font-medium truncate">{eq.name}</span>
                                    {eq.used_for_rehearsal && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-purple-400 text-purple-700 dark:text-purple-300">
                                        Rehearsal
                                      </Badge>
                                    )}
                                  </div>
                                  {isAllowedToEditSec && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveEquipment(ev.id, sec, eq.id)}
                                      className="text-destructive hover:text-destructive/80 p-0.5"
                                      title="Remove equipment"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Section Deployments */}
                        <div className="space-y-1.5 pt-2 border-t">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {secName} Deployments ({secDeps.length})
                            </span>
                            {isAllowedToEditSec && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[11px] px-1.5 text-primary"
                                onClick={() => setDeploymentModalTarget({ eventId: ev.id, section: sec })}
                              >
                                + Deploy Members
                              </Button>
                            )}
                          </div>

                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {secDeps.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">No members deployed</p>
                            ) : (
                              secDeps.map((dep) => {
                                const isConfirmed = dep.response_status === "confirmed";
                                const isDeclined = dep.response_status === "declined";
                                const isPending = !dep.response_status || dep.response_status === "pending";

                                return (
                                  <div key={dep.id} className="flex items-center justify-between bg-muted/40 px-2 py-1 rounded text-xs gap-1">
                                    <div className="flex items-center gap-1.5 truncate mr-1">
                                      <span className="font-medium truncate">{dep.name}</span>
                                      {dep.attending_rehearsal && (
                                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-purple-400 text-purple-700 dark:text-purple-300">
                                          Rehearsal
                                        </Badge>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                      {isConfirmed && (
                                        <Badge className="bg-emerald-600/90 text-white text-[9px] px-1 py-0 h-4 gap-0.5">
                                          <CheckCircle2 className="h-2.5 w-2.5" />
                                          Free
                                        </Badge>
                                      )}
                                      {isDeclined && (
                                        <Badge className="bg-red-600/90 text-white text-[9px] px-1 py-0 h-4 gap-0.5">
                                          <XCircle className="h-2.5 w-2.5" />
                                          Not Free
                                        </Badge>
                                      )}
                                      {isPending && (
                                        <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/30 text-[9px] px-1 py-0 h-4 gap-0.5">
                                          <Clock className="h-2.5 w-2.5" />
                                          Pending
                                        </Badge>
                                      )}

                                      {isAllowedToEditSec && (
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveDeployment(ev.id, sec, dep.id)}
                                          className="text-destructive hover:text-destructive/80 p-0.5"
                                          title="Remove member"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <CreateEventModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={refresh} />

      <EditEventModal
        event={editEvent}
        open={editEvent !== null}
        isAdmin={isAdmin}
        onClose={() => setEditEvent(null)}
        onUpdated={refresh}
      />

      <SectionEquipmentModal
        eventId={equipmentModalTarget?.eventId ?? null}
        section={equipmentModalTarget?.section ?? null}
        currentlyAttachedEqIds={
          equipmentModalTarget
            ? events
                .find((e) => e.id === equipmentModalTarget.eventId)
                ?.section_equipment[equipmentModalTarget.section]?.map((eq) => eq.id) || []
            : []
        }
        open={equipmentModalTarget !== null}
        onClose={() => setEquipmentModalTarget(null)}
        onUpdated={refresh}
      />

      <SectionDeploymentModal
        eventId={deploymentModalTarget?.eventId ?? null}
        section={deploymentModalTarget?.section ?? null}
        currentlyDeployedUserIds={
          deploymentModalTarget
            ? events
                .find((e) => e.id === deploymentModalTarget.eventId)
                ?.section_deployments[deploymentModalTarget.section]?.map((d) => d.id) || []
            : []
        }
        open={deploymentModalTarget !== null}
        onClose={() => setDeploymentModalTarget(null)}
        onUpdated={refresh}
      />

      <SectionRehearsalModal
        event={rehearsalModalTarget?.event ?? null}
        section={rehearsalModalTarget?.section ?? null}
        open={rehearsalModalTarget !== null}
        onClose={() => setRehearsalModalTarget(null)}
        onUpdated={refresh}
      />
    </div>
  );
}
