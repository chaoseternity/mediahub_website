"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  User as UserIcon,
  Mail,
  Calendar,
  Package,
  History,
  Shield,
  CreditCard,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Edit2,
  MapPin,
  ChevronRight,
  CheckCircle,
  XCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, roleBadgeClass } from "@/lib/utils";
import type { Role, UserProfileData, UserProfileCheckout, UserProfileEvent } from "@/lib/types";
import { EventDetailModal } from "@/components/EventDetailModal";

interface ProfileClientProps {
  initialData: UserProfileData;
  viewerRole: Role;
  viewerId: string;
  isSelf: boolean;
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString("en-SG", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-SG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return s;
  }
}

export function ProfileClient({
  initialData,
  viewerRole,
  viewerId,
  isSelf,
}: ProfileClientProps) {
  const router = useRouter();
  const [data, setData] = useState<UserProfileData>(initialData);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [eventDetailOpen, setEventDetailOpen] = useState(false);
  const [returningId, setReturningId] = useState<number | null>(null);
  const [eventFilter, setEventFilter] = useState<"all" | "upcoming" | "past">("all");

  // Edit username modal state
  const [editUsernameOpen, setEditUsernameOpen] = useState(false);
  const [newUsername, setNewUsername] = useState(data.user.username ?? data.user.name ?? "");
  const [updatingUsername, setUpdatingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const user = data.user;
  const isAdmin = viewerRole === "admin";
  const canReturnEquipment = isAdmin || viewerRole === "verified" || isSelf;

  async function handleReturn(checkout: UserProfileCheckout) {
    if (!confirm(`Mark "${checkout.equipment_name}" as returned?`)) return;
    setReturningId(checkout.equipment_id);
    try {
      const res = await fetch(`/api/equipment/${checkout.equipment_id}/return`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json();
        alert(json.error ?? "Failed to mark equipment as returned.");
        return;
      }
      // Move from active to past in local state
      const now = new Date().toISOString();
      const updatedActive = data.activeEquipment.filter((e) => e.id !== checkout.id);
      const updatedPast = [{ ...checkout, returned_at: now }, ...data.pastEquipment];
      setData({
        ...data,
        activeEquipment: updatedActive,
        pastEquipment: updatedPast,
        stats: {
          ...data.stats,
          activePossessionsCount: updatedActive.length,
          totalCheckoutsCount: updatedActive.length + updatedPast.length,
        },
      });
      router.refresh();
    } catch {
      alert("An unexpected error occurred while returning equipment.");
    } finally {
      setReturningId(null);
    }
  }

  async function handleSaveUsername(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newUsername.trim();
    if (!trimmed) {
      setUsernameError("Please enter your name.");
      return;
    }
    setUpdatingUsername(true);
    setUsernameError(null);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      if (!res.ok) {
        const json = await res.json();
        setUsernameError(json?.error?.formErrors?.[0] ?? json.error ?? "Failed to update name");
        return;
      }
      setData({
        ...data,
        user: { ...data.user, username: trimmed },
      });
      setEditUsernameOpen(false);
      router.refresh();
    } catch {
      setUsernameError("Something went wrong. Please try again.");
    } finally {
      setUpdatingUsername(false);
    }
  }

  const filteredEvents = data.events.filter((ev) => {
    if (eventFilter === "upcoming") return ev.status !== "Completed";
    if (eventFilter === "past") return ev.status === "Completed";
    return true;
  });

  const initials = (user.name || user.username || "U")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full max-w-6xl mx-auto space-y-6">
      {/* ── Admin notification banner when viewing another profile ── */}
      {!isSelf && isAdmin && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 px-4 py-2.5 rounded-lg text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="truncate">
              Viewing profile for <strong>{user.name}</strong> as an Administrator.
            </span>
          </div>
          <Link href="/dashboard/users" className="shrink-0 text-xs font-semibold underline hover:opacity-80">
            Back to Users
          </Link>
        </div>
      )}

      {/* ── Hero Profile Header ── */}
      <Card className="overflow-hidden border shadow-xs">
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {/* Avatar circle */}
              <div className="h-16 w-16 md:h-20 md:w-20 rounded-full bg-primary/10 border-2 border-primary/20 text-primary flex items-center justify-center font-bold text-xl md:text-2xl shrink-0 shadow-inner">
                {initials}
              </div>

              {/* Name & Identity */}
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground truncate">
                    {user.name}
                  </h1>
                  <Badge className={cn(roleBadgeClass[user.role], "capitalize shrink-0")}>
                    {user.role}
                  </Badge>
                </div>

                {user.username && user.username !== user.name && (
                  <p className="text-sm font-medium text-muted-foreground truncate">
                    @{user.username}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-0.5">
                  <span className="flex items-center gap-1 truncate">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    {user.email}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    Member since {fmtDate(user.created_at)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0">
              {isSelf && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNewUsername(data.user.username ?? data.user.name ?? "");
                    setUsernameError(null);
                    setEditUsernameOpen(true);
                  }}
                  className="gap-1.5 text-xs"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  Edit Name
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Key Metrics Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Card className="border shadow-2xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-medium truncate">In Possession</p>
              <p className="text-xl md:text-2xl font-bold tracking-tight">
                {data.stats.activePossessionsCount}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-2xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 shrink-0">
              <History className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-medium truncate">Total Checkouts</p>
              <p className="text-xl md:text-2xl font-bold tracking-tight">
                {data.stats.totalCheckoutsCount}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-2xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-medium truncate">Active & Upcoming</p>
              <p className="text-xl md:text-2xl font-bold tracking-tight">
                {data.stats.upcomingEventsCount}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-2xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-slate-500/10 text-slate-600 dark:text-slate-400 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-medium truncate">Completed Events</p>
              <p className="text-xl md:text-2xl font-bold tracking-tight">
                {data.stats.completedEventsCount}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Main Tabbed Content ── */}
      <Tabs defaultValue="equipment" className="space-y-4">
        <TabsList className="grid grid-cols-3 max-w-md w-full">
          <TabsTrigger value="equipment" className="text-xs md:text-sm">
            Equipment ({data.activeEquipment.length})
          </TabsTrigger>
          <TabsTrigger value="events" className="text-xs md:text-sm">
            Events ({data.events.length})
          </TabsTrigger>
          <TabsTrigger value="account" className="text-xs md:text-sm">
            Account & NFC
          </TabsTrigger>
        </TabsList>

        {/* ── 1. Equipment Tab ── */}
        <TabsContent value="equipment" className="space-y-6 pt-2">
          {/* Active Possessions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-600" />
                Currently in Possession ({data.activeEquipment.length})
              </h2>
            </div>

            {data.activeEquipment.length === 0 ? (
              <Card className="border-dashed bg-muted/20">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>No equipment currently in possession.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.activeEquipment.map((eq) => {
                  const isOverdue =
                    eq.expected_return_at && new Date() > new Date(eq.expected_return_at);
                  const isReturning = returningId === eq.equipment_id;

                  return (
                    <Card
                      key={eq.id}
                      className={cn(
                        "border transition-all shadow-xs flex flex-col justify-between",
                        isOverdue && "border-red-300 dark:border-red-900 bg-red-50/10"
                      )}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <CardTitle className="text-sm md:text-base font-semibold truncate">
                              {eq.equipment_name}
                            </CardTitle>
                            <CardDescription className="font-mono text-xs text-muted-foreground truncate">
                              {eq.equipment_serial_number || "No Serial / ID"}
                            </CardDescription>
                          </div>
                          <Badge
                            variant={isOverdue ? "destructive" : "secondary"}
                            className="text-[11px] shrink-0"
                          >
                            {isOverdue ? "Overdue" : "In Possession"}
                          </Badge>
                        </div>
                      </CardHeader>

                      <CardContent className="pb-3 text-xs space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-muted-foreground pt-1 border-t">
                          <div>
                            <span className="block text-[10px] uppercase font-bold text-muted-foreground/80">
                              Checked Out At
                            </span>
                            <span className="text-foreground font-medium">
                              {fmtDateTime(eq.checked_out_at)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase font-bold text-muted-foreground/80">
                              Expected Return
                            </span>
                            <span
                              className={cn(
                                "font-medium",
                                isOverdue ? "text-destructive font-semibold" : "text-foreground"
                              )}
                            >
                              {fmtDateTime(eq.expected_return_at)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 text-muted-foreground pt-1">
                          <MapPin className="h-3 w-3 shrink-0 text-primary" />
                          <span className="truncate">
                            Location: {eq.checkout_location || eq.equipment_location}
                          </span>
                        </div>

                        {eq.notes && (
                          <p className="text-muted-foreground italic bg-muted/40 p-1.5 rounded text-[11px]">
                            Note: {eq.notes}
                          </p>
                        )}
                      </CardContent>

                      <div className="px-4 py-2.5 bg-muted/20 border-t flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">
                          Condition: <strong className="text-foreground">{eq.equipment_condition}</strong>
                        </span>
                        {canReturnEquipment && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isReturning}
                            onClick={() => handleReturn(eq)}
                            className="h-7 text-xs gap-1"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {isReturning ? "Returning..." : "Mark Returned"}
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Past Equipment Possessions */}
          <div className="space-y-3 pt-4 border-t">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-purple-600" />
              Past Equipment Possessions ({data.pastEquipment.length})
            </h2>

            {data.pastEquipment.length === 0 ? (
              <Card className="border-dashed bg-muted/20">
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  <p>No past checkout history recorded.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {data.pastEquipment.map((eq) => (
                  <div
                    key={eq.id}
                    className="border rounded-lg p-3 bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs hover:bg-muted/10 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground truncate">
                          {eq.equipment_name}
                        </span>
                        {eq.equipment_serial_number && (
                          <span className="font-mono text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                            {eq.equipment_serial_number}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-[11px]">
                        <span>Checked out: {fmtDateTime(eq.checked_out_at)}</span>
                        <span>•</span>
                        <span className="font-medium text-foreground">
                          Returned: {fmtDateTime(eq.returned_at)}
                        </span>
                      </div>
                      {eq.notes && (
                        <p className="text-muted-foreground italic text-[11px]">
                          Note: {eq.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {eq.equipment_condition}
                      </Badge>
                      <Badge className="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                        Returned
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── 2. Events & Deployments Tab ── */}
        <TabsContent value="events" className="space-y-4 pt-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-600" />
              Event Roles & Deployments ({filteredEvents.length})
            </h2>

            {/* Event Filter Pills */}
            <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg text-xs">
              <Button
                variant={eventFilter === "all" ? "default" : "ghost"}
                size="sm"
                onClick={() => setEventFilter("all")}
                className="h-7 text-xs px-2.5"
              >
                All ({data.events.length})
              </Button>
              <Button
                variant={eventFilter === "upcoming" ? "default" : "ghost"}
                size="sm"
                onClick={() => setEventFilter("upcoming")}
                className="h-7 text-xs px-2.5"
              >
                Active / Upcoming ({data.stats.upcomingEventsCount})
              </Button>
              <Button
                variant={eventFilter === "past" ? "default" : "ghost"}
                size="sm"
                onClick={() => setEventFilter("past")}
                className="h-7 text-xs px-2.5"
              >
                Completed ({data.stats.completedEventsCount})
              </Button>
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <Card className="border-dashed bg-muted/20">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>No events found for this filter.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredEvents.map((ev) => {
                const isCompleted = ev.status === "Completed";
                const isOngoing = ev.status === "Ongoing";

                return (
                  <Card
                    key={ev.event_id}
                    onClick={() => {
                      setSelectedEventId(ev.event_id);
                      setEventDetailOpen(true);
                    }}
                    className={cn(
                      "border transition-all cursor-pointer hover:shadow-xs group",
                      isOngoing && "border-emerald-500/50 bg-emerald-50/10",
                      isCompleted && "opacity-85"
                    )}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-base text-foreground group-hover:text-primary transition-colors truncate">
                              {ev.event_name}
                            </h3>
                            <Badge
                              variant={
                                isOngoing
                                  ? "default"
                                  : isCompleted
                                  ? "secondary"
                                  : "outline"
                              }
                              className={cn(
                                "text-[10px] shrink-0",
                                isOngoing && "bg-emerald-600 text-white"
                              )}
                            >
                              {ev.status}
                            </Badge>
                          </div>
                          {ev.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {ev.description}
                            </p>
                          )}
                        </div>

                        <span className="text-primary text-xs font-semibold flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          Details <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </div>

                      {/* Timings & Location */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground border-t pt-2.5">
                        <div className="flex items-center gap-1.5 truncate">
                          <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span>
                            {fmtDateTime(ev.start_time)} – {fmtDateTime(ev.end_time)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 truncate">
                          <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span>{ev.location}</span>
                        </div>
                      </div>

                      {/* Roles in this Event */}
                      <div className="border-t pt-2.5 space-y-1.5">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
                          Assigned Roles in this Event
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {ev.roles.map((r, rIdx) => {
                            if (r.type === "oic") {
                              return (
                                <Badge
                                  key={rIdx}
                                  className="bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800 text-xs py-0.5"
                                >
                                  Overall In-Charge (OIC)
                                </Badge>
                              );
                            }
                            if (r.type === "section_ic") {
                              return (
                                <Badge
                                  key={rIdx}
                                  className="bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800 text-xs py-0.5"
                                >
                                  {r.label}
                                </Badge>
                              );
                            }
                            // Deployment crew
                            const isConfirmed = r.response_status === "confirmed";
                            const isDeclined = r.response_status === "declined";
                            return (
                              <div
                                key={rIdx}
                                className="inline-flex items-center gap-1.5 bg-muted/60 border rounded-md px-2 py-0.5 text-xs font-medium"
                              >
                                <span>{r.label}</span>
                                {isConfirmed && (
                                  <Badge className="bg-emerald-600 text-white text-[9px] px-1 py-0 h-3.5 gap-0.5">
                                    <CheckCircle className="h-2 w-2" /> Free
                                  </Badge>
                                )}
                                {isDeclined && (
                                  <Badge className="bg-red-600 text-white text-[9px] px-1 py-0 h-3.5 gap-0.5">
                                    <XCircle className="h-2 w-2" /> Not Free
                                  </Badge>
                                )}
                                {!isConfirmed && !isDeclined && (
                                  <Badge variant="outline" className="text-amber-600 text-[9px] px-1 py-0 h-3.5">
                                    Pending RSVP
                                  </Badge>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── 3. Account & NFC Tab ── */}
        <TabsContent value="account" className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Account Details Card */}
            <Card className="border shadow-2xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <UserIcon className="h-4 w-4 text-primary" />
                  Account Information
                </CardTitle>
                <CardDescription className="text-xs">
                  Basic user profile details registered in MediaHub.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">User ID</span>
                  <span className="font-mono font-medium">{user.id}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Full Name</span>
                  <span className="font-medium">{user.name}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Username</span>
                  <span className="font-medium">{user.username || "—"}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Email Address</span>
                  <span className="font-medium">{user.email}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Access Role</span>
                  <Badge className={cn(roleBadgeClass[user.role], "capitalize text-[10px]")}>
                    {user.role}
                  </Badge>
                </div>
                <div className="flex justify-between pt-0.5">
                  <span className="text-muted-foreground">Auth Provider</span>
                  <span className="font-medium capitalize">{user.provider || "Credentials / Google"}</span>
                </div>
              </CardContent>
            </Card>

            {/* NFC Card Details Card */}
            <Card className="border shadow-2xs">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-purple-600" />
                  NFC Station Card
                </CardTitle>
                <CardDescription className="text-xs">
                  Physical tap-to-checkout card associated with this member.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {data.nfcCard ? (
                  <>
                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 p-2.5 rounded-lg">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>Physical NFC Card linked and active for tap checkouts.</span>
                    </div>

                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Card Member Name</span>
                      <span className="font-medium">{data.nfcCard.member_name}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">NFC Card ID / UID</span>
                      <span className="font-mono font-medium">{data.nfcCard.nfc_value}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Card Linked Date</span>
                      <span className="font-medium">{fmtDate(data.nfcCard.created_at)}</span>
                    </div>
                    {data.nfcCard.notes && (
                      <div className="pt-1">
                        <span className="text-muted-foreground block mb-0.5">Notes:</span>
                        <p className="italic bg-muted/30 p-2 rounded">{data.nfcCard.notes}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-6 text-center text-muted-foreground space-y-2">
                    <CreditCard className="h-8 w-8 mx-auto opacity-30" />
                    <p className="font-medium">No NFC Card Registered</p>
                    <p className="text-[11px] max-w-xs mx-auto">
                      Members can have a physical NFC card mapped to their account at the NFC Station.
                    </p>
                    {isAdmin && (
                      <Link href="/dashboard/nfc" className="inline-block pt-2">
                        <Button variant="outline" size="sm" className="text-xs gap-1">
                          Go to NFC Station <ExternalLink className="h-3 w-3" />
                        </Button>
                      </Link>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Event Detail Modal ── */}
      <EventDetailModal
        eventId={selectedEventId}
        open={eventDetailOpen}
        onClose={() => {
          setEventDetailOpen(false);
          setSelectedEventId(null);
        }}
      />

      {/* ── Edit Display Name Dialog ── */}
      <Dialog open={editUsernameOpen} onOpenChange={setEditUsernameOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSaveUsername}>
            <DialogHeader>
              <DialogTitle>Edit Profile Name</DialogTitle>
              <DialogDescription>
                Update your display name. This will be shown on equipment checkouts, event rosters, and your profile.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4 space-y-2">
              <Label htmlFor="display-name" className="text-xs">
                Your Full Name (as in eSpace)
              </Label>
              <Input
                id="display-name"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="e.g. Alice Johnson"
                autoFocus
                required
              />
              {usernameError && (
                <p className="text-xs text-destructive">{usernameError}</p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditUsernameOpen(false)}
                disabled={updatingUsername}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updatingUsername}>
                {updatingUsername ? "Saving..." : "Save Name"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
