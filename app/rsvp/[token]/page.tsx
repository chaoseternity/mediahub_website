"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Camera,
  Video,
  Mic,
  Loader2,
  Sparkles,
  Check,
  X,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface RSVPData {
  eventName: string;
  eventDescription: string | null;
  startTime: string;
  endTime: string;
  location: string;
  hasRehearsal: boolean;
  rehearsalStartTime: string | null;
  rehearsalEndTime: string | null;
  attendingRehearsal: boolean;
  userName: string;
  userEmail: string;
  section: "photo" | "video" | "av";
  responseStatus: "pending" | "confirmed" | "declined";
  respondedAt: string | null;
}

const SECTION_CONFIG = {
  photo: {
    icon: Camera,
    label: "Photography Team",
    color: "from-blue-600 to-indigo-600",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  },
  video: {
    icon: Video,
    label: "Videography Team",
    color: "from-purple-600 to-pink-600",
    badge: "bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  },
  av: {
    icon: Mic,
    label: "Audio / AV Team",
    color: "from-amber-600 to-orange-600",
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  },
};

function RSVPContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params?.token as string;
  const initialAction = searchParams.get("action");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<RSVPData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittedStatus, setSubmittedStatus] = useState<"confirmed" | "declined" | null>(null);

  const handleRSVP = useCallback(
    async (status: "confirmed" | "declined") => {
      if (!token) return;
      try {
        setSubmitting(true);
        setError(null);
        const res = await fetch("/api/rsvp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, status }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to update availability");
        }

        setSubmittedStatus(status);
        setData((prev) =>
          prev
            ? {
                ...prev,
                responseStatus: status,
                respondedAt: new Date().toISOString(),
              }
            : null
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to submit response");
      } finally {
        setSubmitting(false);
      }
    },
    [token]
  );

  // Load RSVP Data
  useEffect(() => {
    if (!token) return;

    async function loadData() {
      try {
        setLoading(true);
        const res = await fetch(`/api/rsvp?token=${token}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to load invitation details");
        }
        const rsvpData: RSVPData = await res.json();
        setData(rsvpData);

        // If URL contained ?action=confirm or ?action=decline, auto-respond if currently pending
        if (initialAction === "confirm" && rsvpData.responseStatus === "pending") {
          handleRSVP("confirmed");
        } else if (initialAction === "decline" && rsvpData.responseStatus === "pending") {
          handleRSVP("declined");
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Invalid invitation token");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [token, initialAction, handleRSVP]);

  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-purple-600/10 dark:bg-purple-500/20 flex items-center justify-center animate-pulse">
              <Sparkles className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            </div>
            <Loader2 className="h-5 w-5 animate-spin text-purple-600 absolute -top-1 -right-1" />
          </div>
          <p className="text-sm font-medium text-muted-foreground animate-pulse">Loading deployment invitation...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-linear-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border shadow-xl bg-card">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-red-100 dark:bg-red-950/60 flex items-center justify-center text-red-600 mb-3 shadow-inner">
              <AlertCircle className="h-7 w-7" />
            </div>
            <CardTitle className="text-lg font-bold">Invitation Link Invalid</CardTitle>
            <CardDescription className="text-xs">{error || "This invitation link is invalid or has expired."}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const sectionMeta = SECTION_CONFIG[data.section] || SECTION_CONFIG.photo;
  const SectionIcon = sectionMeta.icon;
  const currentStatus = submittedStatus || data.responseStatus;
  const isConfirmed = currentStatus === "confirmed";
  const isDeclined = currentStatus === "declined";

  return (
    <div className="min-h-screen bg-linear-to-b from-slate-50 via-slate-50/80 to-slate-100 dark:from-slate-950 dark:via-slate-900/90 dark:to-slate-950 py-10 px-4 sm:px-6 flex items-center justify-center relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 -left-32 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-lg w-full space-y-4 relative z-10">
        {/* Top Header Badge */}
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100/80 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 text-xs font-semibold backdrop-blur-xs border border-purple-200/50 dark:border-purple-800/50 shadow-xs">
            <Sparkles className="h-3.5 w-3.5" />
            MediaHub Production Crew
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            Deployment Availability
          </h1>
          <p className="text-xs text-muted-foreground">
            Please confirm your availability to crew for this production
          </p>
        </div>

        {/* Dynamic Status Banner */}
        {isConfirmed && (
          <div className="p-4 rounded-2xl bg-linear-to-r from-emerald-500/15 via-emerald-500/10 to-teal-500/15 dark:from-emerald-950/60 dark:via-emerald-900/40 dark:to-teal-950/60 border-2 border-emerald-500/30 dark:border-emerald-500/40 flex items-start gap-3.5 shadow-md shadow-emerald-500/5 backdrop-blur-xs animate-in fade-in zoom-in-95 duration-300">
            <div className="h-8 w-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Check className="h-5 w-5 stroke-[2.5]" />
            </div>
            <div className="space-y-0.5 flex-1">
              <div className="flex items-center justify-between">
                <p className="font-bold text-sm text-emerald-900 dark:text-emerald-200">You are Confirmed!</p>
                <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-100/80 dark:bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-300/60 dark:border-emerald-800">
                  Ready to deploy
                </span>
              </div>
              <p className="text-xs text-emerald-800/90 dark:text-emerald-300/90 leading-relaxed">
                Thank you, <span className="font-semibold">{data.userName}</span>. Your Section In-Charge has been notified.
              </p>
            </div>
          </div>
        )}

        {isDeclined && (
          <div className="p-4 rounded-2xl bg-linear-to-r from-rose-500/15 via-rose-500/10 to-red-500/15 dark:from-rose-950/60 dark:via-rose-900/40 dark:to-red-950/60 border-2 border-rose-500/30 dark:border-rose-500/40 flex items-start gap-3.5 shadow-md shadow-rose-500/5 backdrop-blur-xs animate-in fade-in zoom-in-95 duration-300">
            <div className="h-8 w-8 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <X className="h-5 w-5 stroke-[2.5]" />
            </div>
            <div className="space-y-0.5 flex-1">
              <div className="flex items-center justify-between">
                <p className="font-bold text-sm text-rose-900 dark:text-rose-200">Marked as Not Available</p>
                <span className="text-[10px] font-medium text-rose-700 dark:text-rose-400 bg-rose-100/80 dark:bg-rose-950 px-2 py-0.5 rounded-full border border-rose-300/60 dark:border-rose-800">
                  Declined
                </span>
              </div>
              <p className="text-xs text-rose-800/90 dark:text-rose-300/90 leading-relaxed">
                You have declined this deployment. You can change your response below if your availability changes.
              </p>
            </div>
          </div>
        )}

        {/* Main Event Card */}
        <Card className="border-border/60 shadow-xl bg-card/95 backdrop-blur-md overflow-hidden rounded-2xl">
          {/* Card Top Accent Bar */}
          <div className={cn("h-2 w-full bg-linear-to-r", sectionMeta.color)} />

          <CardHeader className="pb-4 pt-5 px-5 sm:px-6 border-b bg-muted/15">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Badge variant="outline" className={cn("gap-1.5 py-1 px-3 font-semibold text-xs border shadow-2xs", sectionMeta.badge)}>
                <SectionIcon className="h-3.5 w-3.5" />
                {sectionMeta.label}
              </Badge>

              <Badge
                className={cn(
                  "font-bold text-xs py-1 px-3 shadow-xs transition-all",
                  isConfirmed
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : isDeclined
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "bg-amber-500 text-white hover:bg-amber-600"
                )}
              >
                {isConfirmed ? "✓ Confirmed" : isDeclined ? "✕ Not Free" : "⏳ Pending Your Response"}
              </Badge>
            </div>

            <CardTitle className="text-xl sm:text-2xl font-bold mt-3 text-foreground tracking-tight">
              {data.eventName}
            </CardTitle>
            {data.eventDescription && (
              <CardDescription className="text-xs leading-relaxed text-muted-foreground mt-1">
                {data.eventDescription}
              </CardDescription>
            )}
          </CardHeader>

          <CardContent className="p-5 sm:p-6 space-y-5 text-xs">
            {/* Crew Member Summary Pill */}
            <div className="p-3.5 bg-muted/40 dark:bg-muted/20 rounded-xl flex items-center justify-between border border-border/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                  {data.userName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground font-medium block">Crew Member</span>
                  <span className="font-semibold text-xs text-foreground">{data.userName}</span>
                </div>
              </div>
              <span className="text-muted-foreground text-[11px] font-mono bg-background/60 px-2 py-1 rounded border border-border/50">
                {data.userEmail}
              </span>
            </div>

            {/* Event Timing & Location */}
            <div className="space-y-3 bg-muted/20 p-4 rounded-xl border border-border/40">
              <div className="flex items-start gap-3 text-foreground/90">
                <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600 shrink-0 mt-0.5">
                  <Calendar className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <span className="font-semibold block text-foreground">Event Schedule</span>
                  <span className="text-muted-foreground">
                    {new Date(data.startTime).toLocaleString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}{" "}
                    –{" "}
                    {new Date(data.endTime).toLocaleString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 text-foreground/90">
                <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600 shrink-0 mt-0.5">
                  <MapPin className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <span className="font-semibold block text-foreground">Location</span>
                  <span className="text-muted-foreground">{data.location}</span>
                </div>
              </div>

              {/* Rehearsal Details */}
              {data.hasRehearsal && data.rehearsalStartTime && data.rehearsalEndTime && (
                <div className="mt-2 pt-3 border-t border-border/40 flex items-start gap-3 text-amber-900 dark:text-amber-200">
                  <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-600 shrink-0 mt-0.5">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">Rehearsal Session</span>
                      {data.attendingRehearsal && (
                        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/80 px-1.5 py-0.2 rounded border border-amber-300 dark:border-amber-800">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground">
                      {new Date(data.rehearsalStartTime).toLocaleString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })}{" "}
                      –{" "}
                      {new Date(data.rehearsalEndTime).toLocaleString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                INTERACTIVE RSVP ACTION BUTTONS
                ══════════════════════════════════════════════════════════════════ */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Select Your Availability
                </span>
                {submitting && (
                  <span className="text-[11px] text-purple-600 flex items-center gap-1 font-medium">
                    <Loader2 className="h-3 w-3 animate-spin" /> Saving response...
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 🟢 Option 1: Confirm Availability */}
                <button
                  type="button"
                  onClick={() => handleRSVP("confirmed")}
                  disabled={submitting}
                  className={cn(
                    "relative group text-left p-4 rounded-2xl border-2 transition-all duration-200 cursor-pointer select-none",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
                    "active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed",
                    isConfirmed
                      ? "bg-linear-to-br from-emerald-50 to-teal-50/80 dark:from-emerald-950/80 dark:to-teal-950/60 border-emerald-500 shadow-md shadow-emerald-500/10 ring-2 ring-emerald-500/20"
                      : "bg-card hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 border-border/80 hover:border-emerald-300 dark:hover:border-emerald-800 shadow-xs hover:shadow-md"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          "w-7 h-7 rounded-xl flex items-center justify-center transition-colors",
                          isConfirmed
                            ? "bg-emerald-600 text-white shadow-xs"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white"
                        )}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="font-bold text-sm text-foreground block">
                          I am Free
                        </span>
                        <span className="text-[11px] text-muted-foreground block font-normal">
                          Confirm availability
                        </span>
                      </div>
                    </div>

                    {isConfirmed && (
                      <span className="h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">
                        Selected
                      </span>
                    )}
                  </div>
                </button>

                {/* 🔴 Option 2: Decline */}
                <button
                  type="button"
                  onClick={() => handleRSVP("declined")}
                  disabled={submitting}
                  className={cn(
                    "relative group text-left p-4 rounded-2xl border-2 transition-all duration-200 cursor-pointer select-none",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2",
                    "active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed",
                    isDeclined
                      ? "bg-linear-to-br from-rose-50 to-red-50/80 dark:from-rose-950/80 dark:to-red-950/60 border-rose-500 shadow-md shadow-rose-500/10 ring-2 ring-rose-500/20"
                      : "bg-card hover:bg-rose-50/50 dark:hover:bg-rose-950/20 border-border/80 hover:border-rose-300 dark:hover:border-rose-800 shadow-xs hover:shadow-md"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          "w-7 h-7 rounded-xl flex items-center justify-center transition-colors",
                          isDeclined
                            ? "bg-rose-600 text-white shadow-xs"
                            : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 group-hover:bg-rose-600 group-hover:text-white"
                        )}
                      >
                        <XCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="font-bold text-sm text-foreground block">
                          Not Free
                        </span>
                        <span className="text-[11px] text-muted-foreground block font-normal">
                          Decline deployment
                        </span>
                      </div>
                    </div>

                    {isDeclined && (
                      <span className="h-5 px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                        Selected
                      </span>
                    )}
                  </div>
                </button>
              </div>
            </div>

            {/* Footer Assurance */}
            <div className="pt-3 border-t border-border/40 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-purple-600" />
              <span>Token-authenticated MediaHub RSVP • Instant synchronization</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function RSVPPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-linear-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
        </div>
      }
    >
      <RSVPContent />
    </Suspense>
  );
}
