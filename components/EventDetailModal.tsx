"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  MapPin,
  Clock,
  Users,
  ShieldAlert,
  UserCheck,
  Package,
  X,
  FileText,
} from "lucide-react";
import type { AppEvent } from "@/lib/types";

interface EventDetailModalProps {
  eventId: number | null;
  open: boolean;
  onClose: () => void;
}

const SGT = "Asia/Singapore";

function parseUTC(s: string): Date {
  if (!s.includes("T") && !s.endsWith("Z") && !s.includes("+")) {
    return new Date(s.replace(" ", "T") + "Z");
  }
  return new Date(s);
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = parseUTC(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleString("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: SGT,
      });
}

export function EventDetailModal({ eventId, open, onClose }: EventDetailModalProps) {
  const [event, setEvent] = useState<AppEvent | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && eventId) {
      setLoading(true);
      fetch(`/api/events/${eventId}`)
        .then((res) => res.json())
        .then((data: AppEvent) => {
          setEvent(data);
        })
        .catch((err) => console.error("Failed to load event details", err))
        .finally(() => setLoading(false));
    } else {
      setEvent(null);
    }
  }, [open, eventId]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Calendar className="h-5 w-5 text-primary" />
            {event?.name ?? "Event Details"}
            {event && (
              <Badge
                className={
                  event.status === "Ongoing"
                    ? "bg-emerald-600 text-white"
                    : event.status === "Upcoming"
                    ? "bg-blue-600 text-white"
                    : "bg-muted text-muted-foreground"
                }
              >
                {event.status}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Loading event details…
          </div>
        ) : !event ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Event not found.
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {/* Event Summary Box */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl border bg-muted/20 text-xs">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <span className="text-muted-foreground block text-[11px]">Location</span>
                  <span className="font-semibold">{event.location}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <span className="text-muted-foreground block text-[11px]">Event Timing</span>
                  <span className="font-semibold">
                    {fmtDateTime(event.start_time)} – {fmtDateTime(event.end_time)}
                  </span>
                </div>
              </div>

              {event.has_rehearsal && (
                <div className="flex items-center gap-2 sm:col-span-2 border-t pt-2 mt-1">
                  <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Rehearsal Schedule</span>
                    <span className="font-medium text-amber-700 dark:text-amber-300">
                      {fmtDateTime(event.rehearsal_start_time)} – {fmtDateTime(event.rehearsal_end_time)}
                    </span>
                  </div>
                </div>
              )}

              {event.description && (
                <div className="flex items-start gap-2 sm:col-span-2 border-t pt-2 mt-1">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Description</span>
                    <p className="text-xs">{event.description}</p>
                  </div>
                </div>
              )}
            </div>

            {/* OIC & Section ICs */}
            <div className="space-y-3 border-t pt-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                In-Charges & Leadership
              </h4>

              {/* OICs */}
              <div className="space-y-1">
                <span className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Overall In-Charges (OICs):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {event.oics.length === 0 ? (
                    <span className="text-xs text-muted-foreground">None assigned</span>
                  ) : (
                    event.oics.map((u) => (
                      <Badge key={u.id} variant="secondary" className="text-xs py-0.5 px-2 bg-purple-100 text-purple-900 dark:bg-purple-900/30 dark:text-purple-200">
                        {u.name}
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              {/* Section ICs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <div className="p-2.5 rounded-lg border bg-blue-50/20 space-y-1">
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1">
                    <UserCheck className="h-3.5 w-3.5" /> Photo ICs
                  </span>
                  <div className="text-xs space-y-0.5">
                    {event.section_ics.photo.length === 0 ? (
                      <span className="text-muted-foreground text-[11px]">None</span>
                    ) : (
                      event.section_ics.photo.map((u) => <div key={u.id} className="font-medium">{u.name}</div>)
                    )}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border bg-emerald-50/20 space-y-1">
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                    <UserCheck className="h-3.5 w-3.5" /> Video ICs
                  </span>
                  <div className="text-xs space-y-0.5">
                    {event.section_ics.video.length === 0 ? (
                      <span className="text-muted-foreground text-[11px]">None</span>
                    ) : (
                      event.section_ics.video.map((u) => <div key={u.id} className="font-medium">{u.name}</div>)
                    )}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border bg-amber-50/20 space-y-1">
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1">
                    <UserCheck className="h-3.5 w-3.5" /> AV ICs
                  </span>
                  <div className="text-xs space-y-0.5">
                    {event.section_ics.av.length === 0 ? (
                      <span className="text-muted-foreground text-[11px]">None</span>
                    ) : (
                      event.section_ics.av.map((u) => <div key={u.id} className="font-medium">{u.name}</div>)
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Assigned Section Equipment & Deployments */}
            <div className="space-y-3 border-t pt-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5" />
                Section Equipment & Deployments
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(["photo", "video", "av"] as const).map((sec) => {
                  const eqList = event.section_equipment[sec];
                  const depList = event.section_deployments[sec];
                  return (
                    <div key={sec} className="border rounded-lg p-3 space-y-2 bg-card">
                      <h5 className="font-bold text-xs uppercase tracking-wide text-primary">
                        {sec} Section
                      </h5>

                      <div>
                        <span className="text-[11px] font-semibold text-muted-foreground block mb-1">
                          Equipment ({eqList.length})
                        </span>
                        {eqList.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">No equipment assigned</p>
                        ) : (
                          <div className="space-y-1">
                            {eqList.map((eq) => (
                              <div key={eq.id} className="text-xs bg-muted/40 px-2 py-1 rounded flex items-center justify-between">
                                <span className="font-medium truncate">{eq.name}</span>
                                {eq.serial_number && (
                                  <span className="font-mono text-[10px] text-muted-foreground ml-1">{eq.serial_number}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="border-t pt-2">
                        <span className="text-[11px] font-semibold text-muted-foreground block mb-1">
                          Deployed Members ({depList.length})
                        </span>
                        {depList.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">No members deployed</p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {depList.map((m) => (
                              <Badge key={m.id} variant="outline" className="text-[10px] py-0">
                                {m.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
