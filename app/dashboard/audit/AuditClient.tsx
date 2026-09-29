"use client";

import { useState, useRef, useEffect, useMemo } from "react";
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
  Camera,
  CameraOff,
  FlipHorizontal,
  RefreshCcw,
  Users,
  QrCode,
  Radio,
  Check,
  X,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
    osc.frequency.setValueAtTime(exists ? 1046.5 : 440, ctx.currentTime); // C6 for match, A4 for miss
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

function extractIdentifier(rawCode: string, equipmentList: Equipment[]): string {
  const code = rawCode.trim();
  if (!code) return "";
  const lowerCode = code.toLowerCase();

  // 1. Direct Serial match
  const bySerial = equipmentList.find(
    (e) => e.serial_number && e.serial_number.toLowerCase() === lowerCode
  );
  if (bySerial) return bySerial.serial_number || String(bySerial.id);

  // 2. Direct Name match
  const byName = equipmentList.find((e) => e.name.toLowerCase() === lowerCode);
  if (byName) return byName.serial_number || String(byName.id);

  // 3. Direct DB ID match (if numeric)
  if (/^\d+$/.test(code)) {
    return code;
  }

  // 4. URL query or path extraction
  try {
    if (code.startsWith("http://") || code.startsWith("https://")) {
      const url = new URL(code);
      const urlId = url.searchParams.get("id");
      if (urlId) return urlId;
      const urlEq = url.searchParams.get("eq") || url.searchParams.get("serial");
      if (urlEq) return urlEq;

      const segments = url.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1];
      if (last && (/^\d+$/.test(last) || equipmentList.some((e) => e.serial_number?.toLowerCase() === last.toLowerCase()))) {
        return last;
      }
    }
  } catch {
    // Ignore URL parse error
  }

  return code;
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

  // Phone Camera Scanning State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<{
    text: string;
    type: "success" | "warning" | "error";
  } | null>(null);

  // Live Multi-User Sync State
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(new Date());

  const scanInputRef = useRef<HTMLInputElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScannedTimeRef = useRef<{ [code: string]: number }>({});

  // Auto-focus manual barcode input when not using camera
  useEffect(() => {
    if (session?.status === "in_progress" && !isCameraOpen) {
      scanInputRef.current?.focus();
    }
  }, [session?.status, isCameraOpen]);

  // Initial population of records if session loaded without them
  useEffect(() => {
    if (session?.id && (!session.records || session.records.length === 0)) {
      fetch(`/api/audit/session?id=${session.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.records) {
            setSession((prev) => (prev ? { ...prev, ...data } : prev));
          }
        })
        .catch(() => {});
    }
  }, [session?.id]);

  // Centralized scan submission used by both Camera and Barcode Gun
  async function processScan(rawCode: string, method: "qr" | "manual" = "manual") {
    const code = rawCode.trim();
    if (!code || !session?.id) return;

    const identifier = extractIdentifier(code, equipmentList);

    try {
      const res = await fetch("/api/audit/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          session_id: session.id,
          identifier,
          code: identifier,
          method,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        if (data.alreadyScanned) {
          playAuditBeep(true);
          setScanFeedback({
            text: `⚠️ Already verified: ${data.record.equipment_name || identifier}`,
            type: "warning",
          });
        } else {
          playAuditBeep(true);
          setScanFeedback({
            text: `✅ Verified: ${data.record.equipment_name || identifier}`,
            type: "success",
          });

          // Optimistically update session records in state
          setSession((prev) => {
            if (!prev) return prev;
            const existingRecords = prev.records || [];
            const updated = existingRecords.map((r) =>
              r.id === data.record.id ? { ...r, ...data.record } : r
            );
            return {
              ...prev,
              found_count: (prev.found_count || 0) + 1,
              missing_count: Math.max(0, (prev.missing_count || 0) - 1),
              records: updated,
            };
          });
        }
      } else {
        playAuditBeep(false);
        setScanFeedback({
          text: `❌ ${data.error || "Item not recognized in catalog"}`,
          type: "error",
        });
      }
    } catch (err) {
      console.error("Scan recording error:", err);
      playAuditBeep(false);
      setScanFeedback({
        text: "❌ Network error recording scan",
        type: "error",
      });
    }

    // Auto-dismiss notification after 3 seconds
    setTimeout(() => {
      setScanFeedback((cur) => (cur?.text.includes(identifier) ? null : cur));
    }, 3000);
  }

  // Camera scanner handlers
  async function stopCamera() {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // ignore cleanup error
      }
      scannerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
    setCameraError(null);
  }

  async function startCamera(desiredFacing: "environment" | "user" = facingMode) {
    await stopCamera();
    setCameraError(null);
    setIsCameraOpen(true);

    // Allow DOM element to mount
    setTimeout(async () => {
      let mod: typeof import("html5-qrcode");
      try {
        mod = await import("html5-qrcode");
      } catch {
        setCameraError("QR and Barcode camera engine failed to load.");
        return;
      }

      const supportedFormats = [
        mod.Html5QrcodeSupportedFormats.QR_CODE,
        mod.Html5QrcodeSupportedFormats.CODE_128,
        mod.Html5QrcodeSupportedFormats.CODE_39,
        mod.Html5QrcodeSupportedFormats.EAN_13,
        mod.Html5QrcodeSupportedFormats.EAN_8,
        mod.Html5QrcodeSupportedFormats.UPC_A,
        mod.Html5QrcodeSupportedFormats.UPC_E,
        mod.Html5QrcodeSupportedFormats.ITF,
      ];

      const html5QrCode = new mod.Html5Qrcode("audit-camera-reader", {
        formatsToSupport: supportedFormats,
        verbose: false,
      });
      scannerRef.current = html5QrCode;

      try {
        await html5QrCode.start(
          { facingMode: desiredFacing },
          {
            fps: 15,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          (decodedText: string) => {
            const now = Date.now();
            const lastTime = lastScannedTimeRef.current[decodedText] || 0;
            // Debounce identical barcode scans for 1.8s
            if (now - lastTime < 1800) return;
            lastScannedTimeRef.current[decodedText] = now;
            processScan(decodedText, "qr");
          },
          undefined
        );

        const video = document.querySelector<HTMLVideoElement>("#audit-camera-reader video");
        if (video?.srcObject instanceof MediaStream) {
          streamRef.current = video.srcObject;
        }
      } catch (err: unknown) {
        console.error("Camera start failed:", err);
        const msg = String(err);
        setCameraError(
          /NotAllowed|PermissionDenied/i.test(msg)
            ? "Camera permission denied. Please allow camera permissions in your mobile browser."
            : "Camera unavailable on this device. You can still scan using external barcode guns or manual entry."
        );
      }
    }, 150);
  }

  function toggleCameraFacing() {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startCamera(next);
  }

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop().catch(() => {});
          }
          scannerRef.current.clear();
        } catch {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Multi-user website-wide live sync polling
  async function syncSession(silent = true) {
    if (!silent) setIsSyncing(true);
    try {
      const res = await fetch("/api/audit/session");
      if (!res.ok) return;
      const data = await res.json();

      if (data?.active?.id || data?.id) {
        const activeData = data.active ? { ...data.active, ...data } : data;
        setSession((prev) => {
          // If we had no session locally, join the newly discovered active audit
          if (!prev) return activeData;
          // If on the same session, merge updated records and counts
          if (activeData.id === prev.id) {
            return {
              ...prev,
              ...activeData,
              records:
                activeData.records && activeData.records.length > 0
                  ? activeData.records
                  : prev.records,
            };
          }
          return activeData;
        });
        setLastSyncTime(new Date());
      } else {
        // If active session was finalized by another admin
        setSession((prev) => {
          if (prev?.status === "in_progress") {
            setCompletionSummary("The active audit session was completed or cancelled by another administrator.");
            return null;
          }
          return prev;
        });
      }
    } catch (err) {
      console.warn("Audit sync poll failed:", err);
    } finally {
      if (!silent) setIsSyncing(false);
    }
  }

  // Auto-sync polling every 3.5 seconds when page is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        syncSession(true);
      }
    }, 3500);

    return () => clearInterval(interval);
  }, []);

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

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scanInput.trim()) return;
    await processScan(scanInput, "manual");
    setScanInput("");
  }

  async function handleCompleteSession() {
    if (!session) return;
    try {
      setIsCompleting(true);
      if (isCameraOpen) await stopCamera();

      const res = await fetch("/api/audit/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          session_id: session.id,
          markMissingInCatalog,
          mark_missing_in_catalog: markMissingInCatalog,
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

  // Aggregate contributing admins across the session
  const contributors = useMemo(() => {
    const map = new Map<string, { count: number; methods: Set<string> }>();
    for (const r of records) {
      if (r.status === "exists") {
        const name = r.scanned_by_name || "Admin";
        const entry = map.get(name) || { count: 0, methods: new Set<string>() };
        entry.count += 1;
        if (r.method) entry.methods.add(r.method);
        map.set(name, entry);
      }
    }
    return Array.from(map.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      methods: Array.from(data.methods),
      isCurrent: name.toLowerCase() === userName.toLowerCase(),
    }));
  }, [records, userName]);

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <ClipboardCheck className="h-6 w-6 text-primary" />
              Storage Room Stock Audit
            </h2>
            <Badge
              variant="outline"
              className="hidden sm:inline-flex gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/30"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Live Multi-Admin Sync
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Website-wide physical inventory roll call. Any admin can scan simultaneously using phone camera or barcode gun.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {session && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncSession(false)}
              disabled={isSyncing}
              className="gap-1.5 h-9 text-xs"
              title="Sync latest scans from other administrators"
            >
              <RefreshCcw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin text-primary")} />
              Sync
            </Button>
          )}

          {!session ? (
            <Button onClick={() => setIsStartModalOpen(true)} className="gap-1.5 h-9">
              <Play className="h-4 w-4" />
              Start New Audit Session
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={() => setIsCompleteModalOpen(true)}
              className="gap-1.5 h-9"
            >
              <CheckCircle2 className="h-4 w-4" />
              Finish & Lock Audit
            </Button>
          )}
        </div>
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
          <CardContent className="py-12 text-center text-muted-foreground space-y-4">
            <ClipboardCheck className="h-12 w-12 mx-auto opacity-30 text-primary" />
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">No Active Audit In Progress</h3>
              <p className="text-xs max-w-md mx-auto">
                Ready to do a routine shelf or cabinet roll call? Starting a new audit session will freeze current inventory counts and allow any admin to scan items with their phone camera or barcode gun.
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
          {/* Active Collaborative Session Info Banner */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Collaborative Audit
                  </span>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs font-semibold text-foreground">{session.name}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Initiated by <strong className="text-foreground">{session.started_by_name || "Admin"}</strong> at{" "}
                  {new Date(session.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
                  All admins can scan simultaneously from phones or laptops.
                </p>
              </div>

              {/* Action: Open Camera Scanner */}
              <div className="flex items-center gap-2 shrink-0">
                {!isCameraOpen ? (
                  <Button
                    onClick={() => startCamera("environment")}
                    className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
                  >
                    <Camera className="h-4 w-4" />
                    Scan with Phone Camera
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={stopCamera}
                    className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/10"
                  >
                    <CameraOff className="h-4 w-4" />
                    Close Camera Scanner
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Phone Camera Scanner Card */}
          {isCameraOpen && (
            <Card className="border-2 border-primary shadow-lg overflow-hidden transition-all bg-card">
              <div className="p-3 bg-muted/40 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-primary animate-pulse" />
                  <span className="text-xs font-bold text-foreground">Phone Camera Viewfinder</span>
                  <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary font-mono">
                    Continuous Auto-Scan
                  </Badge>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={toggleCameraFacing}
                    className="h-7 px-2 text-xs gap-1"
                    title="Switch between front and back camera"
                  >
                    <FlipHorizontal className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Flip Camera</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={stopCamera}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <CardContent className="p-4 space-y-3">
                {/* Camera Viewport Container */}
                <div className="relative w-full max-w-sm mx-auto aspect-square bg-black rounded-xl overflow-hidden shadow-inner flex items-center justify-center">
                  <div id="audit-camera-reader" className="w-full h-full" />

                  {/* Viewfinder Target Reticle Overlay */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-48 h-48 sm:w-56 sm:h-56 relative">
                      {/* 4 Corner Markers */}
                      <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-md"></div>
                      <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-md"></div>
                      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-md"></div>
                      <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-md"></div>

                      {/* Scanning Sweep Line */}
                      <div className="w-full h-0.5 bg-primary/80 shadow-[0_0_12px_rgba(59,130,246,0.8)] absolute top-1/2 -translate-y-1/2 animate-pulse" />
                    </div>
                  </div>

                  {/* Floating Live Scan Result Overlay */}
                  {scanFeedback && (
                    <div
                      className={cn(
                        "absolute bottom-4 left-4 right-4 p-2.5 rounded-lg text-xs font-semibold text-center shadow-lg transition-all animate-in fade-in slide-in-from-bottom-2",
                        scanFeedback.type === "success" && "bg-emerald-600 text-white",
                        scanFeedback.type === "warning" && "bg-amber-600 text-white",
                        scanFeedback.type === "error" && "bg-red-600 text-white"
                      )}
                    >
                      {scanFeedback.text}
                    </div>
                  )}
                </div>

                {cameraError ? (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive text-center space-y-2">
                    <p>{cameraError}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => startCamera(facingMode)}
                      className="h-7 text-xs"
                    >
                      Retry Camera
                    </Button>
                  </div>
                ) : (
                  <p className="text-[11px] text-center text-muted-foreground">
                    Point camera at equipment QR code or 1D barcode sticker. Items verify instantly without tapping.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stat Banner */}
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

          {/* Active Contributors Card */}
          {contributors.length > 0 && (
            <Card className="border bg-card/60">
              <CardContent className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-xs font-semibold text-foreground">
                    Contributing Admins ({contributors.length}):
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {contributors.map((c) => (
                    <Badge
                      key={c.name}
                      variant="secondary"
                      className={cn(
                        "text-xs gap-1.5 py-1 px-2.5 font-medium",
                        c.isCurrent && "border-primary/40 bg-primary/10 text-primary"
                      )}
                    >
                      <span>{c.name}</span>
                      {c.isCurrent && <span className="text-[10px] opacity-80">(You)</span>}
                      <span className="font-bold bg-background/80 px-1.5 py-0.5 rounded-full text-[10px]">
                        {c.count} items
                      </span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Rapid Scanner Gun / Manual Keyboard Input */}
          <Card className="border-2 border-primary/20 shadow-xs">
            <CardContent className="p-4">
              <form onSubmit={handleManualSubmit} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auditScanner" className="text-xs font-semibold flex items-center gap-1.5">
                    <Barcode className="h-4 w-4 text-primary" />
                    Rapid Barcode Gun / Manual Input
                  </Label>
                  <span className="text-[10px] text-muted-foreground">Press Enter or pull barcode trigger</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    id="auditScanner"
                    ref={scanInputRef}
                    placeholder="Scan equipment barcode or type serial / ID (e.g. LP-KAM-001)..."
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    className="font-mono text-sm h-10"
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
                placeholder="Search gear name or serial..."
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
                const isCurrentAuditor =
                  rec.scanned_by_name?.toLowerCase() === userName.toLowerCase();

                return (
                  <div
                    key={rec.id}
                    className={cn(
                      "p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors",
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
                        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground truncate">
                          <span>{rec.equipment_serial_number || `Item #${rec.equipment_id}`}</span>
                          {rec.equipment_location && (
                            <>
                              <span>•</span>
                              <span className="font-sans">{rec.equipment_location}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 flex-wrap sm:flex-nowrap">
                      {isExists && (
                        <div className="text-right space-y-0.5">
                          <div className="flex items-center gap-1.5 text-xs text-foreground">
                            <span title={rec.method === "qr" ? "Scanned via Phone Camera" : rec.method === "nfc" ? "Scanned via NFC" : "Scanned via Barcode Gun"}>
                              {rec.method === "qr" ? (
                                <QrCode className="h-3.5 w-3.5 text-primary" />
                              ) : rec.method === "nfc" ? (
                                <Radio className="h-3.5 w-3.5 text-indigo-500" />
                              ) : (
                                <Barcode className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </span>
                            <span className="font-medium">
                              {rec.scanned_by_name || "Admin"}
                              {isCurrentAuditor && " (You)"}
                            </span>
                          </div>
                          {rec.scanned_at && (
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(rec.scanned_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          )}
                        </div>
                      )}

                      <Badge
                        variant={isExists ? "default" : "destructive"}
                        className={cn(
                          "capitalize text-xs font-medium shrink-0",
                          isExists
                            ? "bg-green-600 hover:bg-green-700 text-white"
                            : "bg-amber-600 hover:bg-amber-700 text-white"
                        )}
                      >
                        {isExists ? "Exists" : "Missing"}
                      </Badge>
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
                Initiates a snapshot of all catalog equipment. All items will be placed into the Missing list until scanned. Any admin will be able to join and scan immediately.
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
                Lock the roll call results for all administrators. You currently have <strong>{missingCount}</strong> unverified / missing items.
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
