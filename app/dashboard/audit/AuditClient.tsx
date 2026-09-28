"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  Barcode,
  Search,
  AlertTriangle,
  Package,
  Layers,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { AuditRecord, AuditSession, Equipment, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AuditClientProps {
  initialSession: (AuditSession & { records?: AuditRecord[] }) | null;
  equipmentList: Equipment[];
  role: Role;
  userName: string;
}

function playAuditBeep(exists: boolean) {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(exists ? 1046.5 : 440, ctx.currentTime); // C6 for match
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Ignore audio autoplay restrictions
  }
}

export function AuditClient({
  initialSession,
  equipmentList,
  role,
  userName,
}: AuditClientProps) {
  const router = useRouter();
  const [session, setSession] = useState<(AuditSession & { records?: AuditRecord[] }) | null>(
    initialSession
  );
  const [scanInput, setScanInput] = useState("");
  const [filterState, setFilterState] = useState<"all" | "missing" | "exists">("all");
  const [search, setSearch] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [startNotes, setStartNotes] = useState("");
  const [isStartModalOpen, setIsStartModalOpen] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [markMissingInCatalog, setMarkMissingInCatalog] = useState(false);
  const [completionSummary, setCompletionSummary] = useState<string | null>(null);

  const scanInputRef = useRef<HTMLInputElement | null>(null);

  // Focus input automatically when active
  useEffect(() => {
    if (session?.status === "in_progress") {
      scanInputRef.current?.focus();
    }
  }, [session?.status]);

  async function handleStartSession(e: React.FormEvent) {
    e.preventDefault();
    try {
      setIsStarting(true);
      const res = await fetch("/api/audit/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: startNotes }),
      });
      const data = await res.json();
      if (res.ok) {
        setSession(data);
        setIsStartModalOpen(false);
        setStartNotes("");
        router.refresh();
      } else {
        alert(data.error || "Failed to start audit session");
      }
    } catch (err) {
      console.error(err);
      alert("Network error starting audit session");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = scanInput.trim();
    if (!code || !session) return;

    try {
      const res = await fetch("/api/audit/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          code,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        playAuditBeep(true);
        // Refresh session record in state
        if (session.records) {
          const updated = session.records.map((r) =>
            r.id === data.record.id ? data.record : r
          );
          setSession({
            ...session,
            found_count: (session.found_count || 0) + 1,
            missing_count: Math.max(0, (session.missing_count || 0) - 1),
            records: updated,
          });
        }
        setScanInput("");
      } else {
        playAuditBeep(false);
        alert(data.error || "Item not recognized in this audit");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to submit scan");
    }
  }

  async function handleCompleteSession() {
    if (!session) return;
    try {
      setIsCompleting(true);
      const res = await fetch("/api/audit/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          markMissingInCatalog,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setCompletionSummary(
          `Audit Finished!\n\nTotal Counted: ${data.session.total_items}\nVerified Present: ${data.session.found_count}\nMissing: ${data.session.missing_count}`
        );
        setSession(null);
        setIsCompleteModalOpen(false);
        router.refresh();
      } else {
        alert(data.error || "Failed to finalize audit session");
      }
    } catch (err) {
      console.error(err);
      alert("Error completing audit");
    } finally {
      setIsCompleting(false);
    }
  }

  const records = session?.records || [];
  const filteredRecords = records.filter((r) => {
    const matchesFilter = filterState === "all" || r.status === filterState;
    const matchesSearch =
      (r.equipment_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.equipment_serial_number || "").toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const existsCount = records.filter((r) => r.status === "exists").length;
  const missingCount = records.filter((r) => r.status === "missing").length;
  const totalCount = records.length;
  const progressPercent = totalCount > 0 ? Math.round((existsCount / totalCount) * 100) : 0;

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Storage Room Stock Audit
          </h2>
          <p className="text-muted-foreground text-sm">
            Rapid inventory roll-call mode. Items default to &ldquo;Missing&rdquo; until scanned as &ldquo;Exists&rdquo;.
          </p>
        </div>

        {!session ? (
          <Button onClick={() => setIsStartModalOpen(true)} className="gap-1.5 self-start sm:self-auto">
            <Play className="h-4 w-4" />
            Start New Audit Session
          </Button>
        ) : (
          <Button
            variant="destructive"
            onClick={() => setIsCompleteModalOpen(true)}
            className="gap-1.5 self-start sm:self-auto"
          >
            <CheckCircle2 className="h-4 w-4" />
            Finish & Lock Audit
          </Button>
        )}
      </div>

      {completionSummary && (
        <Card className="border-green-300 dark:border-green-800 bg-green-500/10">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300 whitespace-pre-line font-medium">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
              <span>{completionSummary}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setCompletionSummary(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {/* No Active Session State */}
      {!session ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <ClipboardCheck className="h-12 w-12 mx-auto opacity-30 text-primary" />
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">No Active Audit In Progress</h3>
              <p className="text-xs max-w-md mx-auto">
                Ready to do a routine shelf or cabinet roll call? Starting a new audit session will freeze current inventory counts and let you scan items with a barcode gun or camera.
              </p>
            </div>
            <Button onClick={() => setIsStartModalOpen(true)} className="gap-1.5 mt-2">
              <Play className="h-4 w-4" />
              Begin Roll Call Session
            </Button>
          </CardContent>
        </Card>
      ) : (
        /* Active Audit In Progress */
        <div className="space-y-6">
          {/* Progress Bar & Stat Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Card className="p-4 flex flex-col justify-between">
              <span className="text-xs text-muted-foreground font-medium">Total In Scope</span>
              <span className="text-2xl font-bold">{totalCount}</span>
            </Card>

            <Card className="p-4 flex flex-col justify-between border-green-200 dark:border-green-900/50 bg-green-50/20">
              <span className="text-xs text-green-700 dark:text-green-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Exists / Found
              </span>
              <span className="text-2xl font-bold text-green-700 dark:text-green-400">{existsCount}</span>
            </Card>

            <Card className="p-4 flex flex-col justify-between border-amber-200 dark:border-amber-900/50 bg-amber-50/20">
              <span className="text-xs text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                <XCircle className="h-3.5 w-3.5" /> Missing / Uncounted
              </span>
              <span className="text-2xl font-bold text-amber-700 dark:text-amber-400">{missingCount}</span>
            </Card>

            <Card className="p-4 flex flex-col justify-between">
              <span className="text-xs text-muted-foreground font-medium">Roll Call Progress</span>
              <div className="space-y-1">
                <span className="text-2xl font-bold">{progressPercent}%</span>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Rapid Scanner Gun Input */}
          <Card className="border-2 border-primary/20 shadow-xs">
            <CardContent className="p-4">
              <form onSubmit={handleScanSubmit} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auditScanner" className="text-xs font-semibold flex items-center gap-1.5">
                    <Barcode className="h-4 w-4 text-primary" />
                    Rapid Barcode Gun / Input Receiver
                  </Label>
                  <span className="text-[10px] text-muted-foreground">Press Enter or pull gun trigger</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    id="auditScanner"
                    ref={scanInputRef}
                    placeholder="Scan equipment barcode or type serial (e.g. LP-KAM-001)..."
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    className="font-mono text-sm h-10"
                    autoFocus
                  />
                  <Button type="submit" className="h-10 px-4 shrink-0">
                    Verify Item
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Roll Call Item List Controls */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search gear or serial..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-xs h-9"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={filterState === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterState("all")}
                className="text-xs h-8"
              >
                All ({totalCount})
              </Button>
              <Button
                variant={filterState === "missing" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterState("missing")}
                className="text-xs h-8 text-amber-600 dark:text-amber-400"
              >
                Missing ({missingCount})
              </Button>
              <Button
                variant={filterState === "exists" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterState("exists")}
                className="text-xs h-8 text-green-600 dark:text-green-400"
              >
                Exists ({existsCount})
              </Button>
            </div>
          </div>

          {/* Records Table / List */}
          <div className="border rounded-xl overflow-hidden divide-y bg-background shadow-2xs">
            {filteredRecords.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No items match this filter.
              </div>
            ) : (
              filteredRecords.map((rec) => {
                const isExists = rec.status === "exists";
                return (
                  <div
                    key={rec.id}
                    className={cn(
                      "p-3.5 flex items-center justify-between gap-3 transition-colors",
                      isExists ? "bg-green-50/20 dark:bg-green-950/10" : "bg-card hover:bg-muted/30"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "p-2 rounded-lg shrink-0",
                          isExists
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        <Package className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-semibold truncate text-foreground">
                          {rec.equipment_name}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground truncate">
                          {rec.equipment_serial_number || `Item #${rec.equipment_id}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={isExists ? "default" : "destructive"}
                        className={cn(
                          "capitalize text-xs font-medium",
                          isExists
                            ? "bg-green-600 hover:bg-green-700 text-white"
                            : "bg-amber-600 hover:bg-amber-700 text-white"
                        )}
                      >
                        {isExists ? "Exists" : "Missing"}
                      </Badge>
                      {rec.scanned_at && (
                        <span className="text-[10px] text-muted-foreground hidden sm:inline">
                          Scanned {new Date(rec.scanned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Start Session Modal */}
      <Dialog open={isStartModalOpen} onOpenChange={setIsStartModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleStartSession} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Play className="h-5 w-5 text-primary" />
                Start Stock Audit Session
              </DialogTitle>
              <DialogDescription>
                Initiates a snapshot of all catalog equipment. All items will be placed into the Missing list until scanned.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="auditNotes" className="text-xs">
                  Session Notes (Optional)
                </Label>
                <Input
                  id="auditNotes"
                  placeholder="e.g. End of Semester Roll Call, Studio Locker 3 Check"
                  value={startNotes}
                  onChange={(e) => setStartNotes(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsStartModalOpen(false)}
                disabled={isStarting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isStarting}>
                {isStarting ? "Starting..." : "Begin Session"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Complete Session Modal */}
      <Dialog open={isCompleteModalOpen} onOpenChange={setIsCompleteModalOpen}>
        <DialogContent className="sm:max-w-md">
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Finish Audit Session
              </DialogTitle>
              <DialogDescription>
                Lock the roll call results. You currently have <strong>{missingCount}</strong> unverified / missing items.
              </DialogDescription>
            </DialogHeader>

            <div className="p-3 bg-muted/40 rounded-lg space-y-2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={markMissingInCatalog}
                  onChange={(e) => setMarkMissingInCatalog(e.target.checked)}
                  className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                />
                <span>Update equipment catalog condition to &ldquo;Missing&rdquo; for uncounted items</span>
              </label>
              <p className="text-muted-foreground text-[11px] pl-6">
                If checked, unverified gear will be flagged as Missing in the main equipment table.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCompleteModalOpen(false)}
                disabled={isCompleting}
              >
                Keep Auditing
              </Button>
              <Button
                variant="destructive"
                onClick={handleCompleteSession}
                disabled={isCompleting}
              >
                {isCompleting ? "Finalizing..." : "Lock & Complete"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
