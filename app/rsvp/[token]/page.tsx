"use client";

import { useEffect, useState, Suspense } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

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
  responseNote: string | null;
}

const SECTION_ICONS = {
  photo: Camera,
  video: Video,
  av: Mic,
};

const SECTION_LABELS = {
  photo: "Photography Team",
  video: "Videography Team",
  av: "Audio / AV Team",
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
  const [note, setNote] = useState("");
  const [submittedStatus, setSubmittedStatus] = useState<"confirmed" | "declined" | null>(null);

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
        if (rsvpData.responseNote) {
          setNote(rsvpData.responseNote);
        }

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
  }, [token]);

  async function handleRSVP(status: "confirmed" | "declined") {
    if (!token) return;
    try {
      setSubmitting(true);
      setError(null);
      const res = await fetch("/api/rsvp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, status, note }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to update availability");
      }

      setSubmittedStatus(status);
      if (data) {
        setData({
          ...data,
          responseStatus: status,
          respondedAt: new Date().toISOString(),
          responseNote: note,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit response");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
          <p className="text-sm font-medium text-muted-foreground">Loading deployment invitation...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border shadow-sm">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto h-12 w-12 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center text-red-600 mb-2">
              <AlertCircle className="h-6 w-6" />
            </div>
            <CardTitle className="text-lg">Invitation Link Invalid</CardTitle>
            <CardDescription>{error || "This invitation link is invalid or has expired."}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const SectionIcon = SECTION_ICONS[data.section] || Camera;
  const currentStatus = submittedStatus || data.responseStatus;

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4 sm:px-6 flex items-center justify-center">
      <div className="max-w-lg w-full space-y-4">
        {/* Header Branding */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-xs font-semibold">
            <Sparkles className="h-3.5 w-3.5" />
            MediaHub Production Crew
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Deployment Availability</h1>
          <p className="text-xs text-muted-foreground">Please confirm if you are free to crew for this event</p>
        </div>

        {/* Status Confirmation Banner if already submitted */}
        {currentStatus === "confirmed" && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3 text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <div className="text-xs">
              <p className="font-semibold text-sm">You are confirmed for this event!</p>
              <p className="text-emerald-700 dark:text-emerald-300">
                Thank you, {data.userName}. The Section In-Charge has been notified of your availability.
              </p>
            </div>
          </div>
        )}

        {currentStatus === "declined" && (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 flex items-center gap-3 text-red-800 dark:text-red-200">
            <XCircle className="h-5 w-5 text-red-600 shrink-0" />
            <div className="text-xs">
              <p className="font-semibold text-sm">Marked as Not Free</p>
              <p className="text-red-700 dark:text-red-300">
                You have declined this deployment. The team will look for alternate crew members.
              </p>
            </div>
          </div>
        )}

        {/* Main Event Card */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 border-b bg-card">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="gap-1.5 py-1 px-2.5 bg-background font-medium text-xs">
                <SectionIcon className="h-3.5 w-3.5 text-purple-600" />
                {SECTION_LABELS[data.section]}
              </Badge>

              <Badge
                className={
                  currentStatus === "confirmed"
                    ? "bg-emerald-600 text-white"
                    : currentStatus === "declined"
                    ? "bg-red-600 text-white"
                    : "bg-amber-500 text-white"
                }
              >
                {currentStatus === "confirmed"
                  ? "✓ Available"
                  : currentStatus === "declined"
                  ? "✕ Not Free"
                  : "⏳ Pending RSVP"}
              </Badge>
            </div>

            <CardTitle className="text-xl font-bold mt-2 text-foreground">{data.eventName}</CardTitle>
            {data.eventDescription && (
              <CardDescription className="text-xs leading-relaxed text-muted-foreground">
                {data.eventDescription}
              </CardDescription>
            )}
          </CardHeader>

          <CardContent className="p-5 space-y-4 text-xs">
            {/* Crew Member Info */}
            <div className="p-3 bg-muted/40 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-muted-foreground block text-[11px]">Assigned Crew Member</span>
                <span className="font-semibold text-sm text-foreground">{data.userName}</span>
              </div>
              <span className="text-muted-foreground text-[11px]">{data.userEmail}</span>
            </div>

            {/* Event Schedule & Location Details */}
            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5 text-foreground/90">
                <Calendar className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Date & Event Time</span>
                  <span>
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

              <div className="flex items-start gap-2.5 text-foreground/90">
                <MapPin className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Location</span>
                  <span>{data.location}</span>
                </div>
              </div>

              {/* Rehearsal Details */}
              {data.hasRehearsal && data.rehearsalStartTime && data.rehearsalEndTime && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Rehearsal Session</span>
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
                  {data.attendingRehearsal && (
                    <span className="inline-block font-semibold text-emerald-700 dark:text-emerald-400 text-[11px]">
                      ✓ You are scheduled to attend this rehearsal session.
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Optional Note Box */}
            <div className="pt-2 border-t space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                <span>Optional Note / Remarks</span>
                <span className="text-[10px] text-muted-foreground font-normal">e.g. arrival time constraints</span>
              </label>
              <textarea
                placeholder="Add any details or notes for your Section IC..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
              <Button
                onClick={() => handleRSVP("confirmed")}
                disabled={submitting}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 h-11"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {currentStatus === "confirmed" ? "Keep as Confirmed" : "I am Free (Confirm)"}
              </Button>

              <Button
                onClick={() => handleRSVP("declined")}
                disabled={submitting}
                variant="outline"
                className="flex-1 border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 dark:border-red-900 font-semibold gap-1.5 h-11"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                {currentStatus === "declined" ? "Keep as Not Free" : "Not Free (Decline)"}
              </Button>
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
        <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
        </div>
      }
    >
      <RSVPContent />
    </Suspense>
  );
}
