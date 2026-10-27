"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, RefreshCcw, Barcode, QrCode, Zap, CheckCircle2, Handshake, Focus, Flashlight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EquipmentModal } from "@/components/EquipmentModal";
import { cn } from "@/lib/utils";
import type { Checkout, Equipment, Role } from "@/lib/types";

interface QRScannerClientProps {
  equipment: Equipment[];
  role: Role;
  userName: string;
}

function playScanBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 chime
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Ignore audio error if blocked by browser autoplay policy
  }
}

function findEquipmentByCode(equipmentList: Equipment[], rawCode: string): Equipment | undefined {
  const code = rawCode.trim();
  if (!code) return undefined;
  const lowerCode = code.toLowerCase();

  // 1. Direct Equipment ID (serial_number) match (e.g. LP-KAM-001, SD-V-01)
  const bySerial = equipmentList.find(
    (e) => e.serial_number && e.serial_number.toLowerCase() === lowerCode
  );
  if (bySerial) return bySerial;

  // 2. Direct Name match
  const byName = equipmentList.find(
    (e) => e.name.toLowerCase() === lowerCode
  );
  if (byName) return byName;

  // 3. Direct DB ID match (if numeric)
  if (/^\d+$/.test(code)) {
    const numId = Number(code);
    const byId = equipmentList.find((e) => e.id === numId);
    if (byId) return byId;
  }

  // 4. URL extraction (e.g. https://.../equipment/12 or ?id=12 or ?eq=SD-V-01)
  try {
    if (code.startsWith("http://") || code.startsWith("https://")) {
      const url = new URL(code);
      const urlId = url.searchParams.get("id");
      if (urlId) {
        const found = equipmentList.find((e) => e.id === Number(urlId));
        if (found) return found;
      }
      const urlEq = url.searchParams.get("eq") || url.searchParams.get("serial");
      if (urlEq) {
        const found = equipmentList.find(
          (e) => e.serial_number && e.serial_number.toLowerCase() === urlEq.toLowerCase()
        );
        if (found) return found;
      }
    }
  } catch {
    // Ignore URL parse error
  }

  return undefined;
}

/** Handover codes are "HD-" followed by 6 digits (e.g. "HD-482913"). */
const HANDOVER_CODE_RE = /^HD-\d{6}$/i;

/** Bare 6-digit form ("482913"), also accepted by the server's normalizeHandoverCode. */
const BARE_HANDOVER_DIGITS_RE = /^\d{6}$/;
/** QR payload types: the server generates "MEDIAHUB_HANDOVER"; "HANDOVER" kept for older payloads. */
const HANDOVER_QR_TYPES = new Set(["MEDIAHUB_HANDOVER", "HANDOVER"]);

/**
 * Returns the normalized "HD-XXXXXX" code if `code` is an explicit handover code
 * ("HD-123456", or a JSON QR payload of a handover type), else null. Bare 6-digit
 * input is handled by the caller so it cannot shadow an equipment ID.
 */
function extractHandoverCode(code: string): string | null {
  if (HANDOVER_CODE_RE.test(code)) return code.toUpperCase();
  if (code.startsWith("{") && code.includes("HANDOVER")) {
    try {
      const parsed = JSON.parse(code);
      if (parsed && HANDOVER_QR_TYPES.has(parsed.type) && typeof parsed.code === "string") {
        const inner = parsed.code.trim().toUpperCase();
        if (HANDOVER_CODE_RE.test(inner)) return inner;
        if (BARE_HANDOVER_DIGITS_RE.test(inner)) return `HD-${inner}`;
      }
    } catch {
      // ignore parse error
    }
  }
  return null;
}

/** Ignore repeat decodes of the same code within this window (camera decodes at ~15fps). */
const SAME_CODE_DEDUPE_MS = 3000;

export function QRScannerClient({ equipment, role, userName }: QRScannerClientProps) {
  const [started, setStarted] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");

  // Camera hardware controls & tap-to-focus
  const [reticle, setReticle] = useState<{
    x: number;
    y: number;
    active: boolean;
    status: "focusing" | "locked";
  } | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomCapabilities, setZoomCapabilities] = useState<{ min: number; max: number; step: number } | null>(null);
  const reticleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reticleLockTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(false);
  // Set synchronously when ANY code starts being handled; cleared once its result is shown.
  const inFlightRef = useRef(false);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  // Incremented on every init/unmount so a stale async init can detect it was superseded.
  const initGenRef = useRef(0);
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  // Keep equipment ref stable so the scan callback always sees current data
  const equipmentRef = useRef(equipment);
  equipmentRef.current = equipment;

  async function handleCodeRecognized(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;

    // Synchronous guards: the camera decode callback fires ~15 times per second, so the
    // in-flight flag must be set before any await, and repeats of the same code are dropped.
    if (inFlightRef.current) return;
    const now = Date.now();
    const last = lastCodeRef.current;
    if (last && last.code === code && now - last.at < SAME_CODE_DEDUPE_MS) return;
    inFlightRef.current = true;
    lastCodeRef.current = { code, at: now };

    try {
      const found = findEquipmentByCode(equipmentRef.current, code);
      // Explicit handover codes always claim; a bare 6-digit code claims only if it is not an equipment ID.
      const handoverCodeToClaim =
        extractHandoverCode(code) ?? (!found && BARE_HANDOVER_DIGITS_RE.test(code) ? `HD-${code}` : null);

      if (handoverCodeToClaim) {
        playScanBeep();
        try {
          const res = await fetch("/api/handover/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: handoverCodeToClaim }),
          });
          const data: { success?: boolean; checkout?: Checkout; error?: string } = await res
            .json()
            .catch(() => ({}));
          if (res.ok && data.success !== false) {
            // The claim API returns { success, checkout }; resolve the equipment from the local list.
            const equipmentId = data.checkout?.equipment_id;
            const eq = equipmentId != null ? equipmentRef.current.find((e) => e.id === equipmentId) : undefined;
            const label = eq ? `${eq.name} (${eq.serial_number || "No Serial"})` : "the handed-over equipment";
            alert(`Handover Successful! \u{1F389}\n\nYou are now in possession of: ${label}.`);
            window.location.reload();
          } else {
            alert(`Handover Claim Failed: ${data.error ?? `Request failed (${res.status})`}`);
          }
        } catch (err) {
          console.error(err);
          alert("Failed to process handover claim.");
        }
        // The result has been shown (alert blocks); restart the dedupe window from now.
        lastCodeRef.current = { code, at: Date.now() };
        return;
      }

      if (found) {
        playScanBeep();
        pausedRef.current = true;
        if (scannerRef.current?.isScanning) {
          try {
            scannerRef.current.pause(true);
          } catch {
            // Ignore
          }
        }
        setNotFound(null);
        setSelectedId(found.id);
        setModalOpen(true);
      } else {
        setNotFound(code);
      }
    } finally {
      inFlightRef.current = false;
    }
  }

  async function applyZoom(targetZoom: number) {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !zoomCapabilities) return;
    try {
      const clamped = Math.max(zoomCapabilities.min, Math.min(targetZoom, zoomCapabilities.max));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await track.applyConstraints({ advanced: [{ zoom: clamped }] } as any);
      setZoomLevel(clamped);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(15);
      }
    } catch (err) {
      console.warn("Failed to apply zoom:", err);
    }
  }

  async function cycleZoom() {
    if (!zoomCapabilities) return;
    let nextZoom = 1.0;
    if (zoomLevel < 1.8 && zoomCapabilities.max >= 2.0) {
      nextZoom = 2.0;
    } else if (zoomLevel < 2.8 && zoomCapabilities.max >= 3.0) {
      nextZoom = 3.0;
    } else {
      nextZoom = 1.0;
    }
    await applyZoom(nextZoom);
  }

  async function triggerFocusAtPoint(clientX: number, clientY: number, showVisual = true) {
    if (!viewfinderRef.current) return;
    const rect = viewfinderRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));

    // Immediate haptic pulse if supported
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate(25);
      } catch {
        // ignore
      }
    }

    if (showVisual) {
      if (reticleTimeoutRef.current) clearTimeout(reticleTimeoutRef.current);
      if (reticleLockTimeoutRef.current) clearTimeout(reticleLockTimeoutRef.current);

      setReticle({ x, y, active: true, status: "focusing" });

      reticleLockTimeoutRef.current = setTimeout(() => {
        setReticle((prev) => (prev ? { ...prev, status: "locked" } : null));
      }, 350);

      reticleTimeoutRef.current = setTimeout(() => {
        setReticle((prev) => (prev ? { ...prev, active: false } : null));
      }, 1500);
    }

    const track = streamRef.current?.getVideoTracks()[0];
    if (track) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cap = (track.getCapabilities ? track.getCapabilities() : {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const settings = (track.getSettings ? track.getSettings() : {}) as any;
      const normX = Math.max(0, Math.min(1, x / Math.max(1, rect.width)));
      const normY = Math.max(0, Math.min(1, y / Math.max(1, rect.height)));

      try {
        // 1. Point of interest focusing
        if (cap.pointsOfInterest) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await track.applyConstraints({ advanced: [{ pointsOfInterest: [{ x: normX, y: normY }] }] } as any).catch(() => {});
        }

        // 2. Focus mode cycling
        if (cap.focusMode?.includes("single-shot")) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await track.applyConstraints({ advanced: [{ focusMode: "single-shot" }] } as any).catch(() => {});
        } else if (cap.focusMode?.includes("continuous")) {
          if (cap.focusMode.includes("manual")) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await track.applyConstraints({ advanced: [{ focusMode: "manual" }] } as any).catch(() => {});
            setTimeout(() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              track.applyConstraints({ advanced: [{ focusMode: "continuous" }] } as any).catch(() => {});
            }, 80);
          }
        }

        // 3. Hardware PDAF depth kick via momentary micro-zoom nudge (+0.04 for 120ms)
        // Recalibrates contrast and focal depth on mobile camera ISPs (iOS & Android)
        if (cap.zoom && cap.zoom.max > 1.05) {
          const currentZ = settings.zoom || zoomLevel || 1.0;
          const nudgeZ = currentZ < cap.zoom.max - 0.05 ? currentZ + 0.04 : Math.max(1.0, currentZ - 0.04);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          track.applyConstraints({ advanced: [{ zoom: nudgeZ }] } as any).then(() => {
            setTimeout(() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              track.applyConstraints({ advanced: [{ zoom: currentZ }] } as any).catch(() => {});
            }, 120);
          }).catch(() => {});
        }
      } catch {
        // Ignore unsupported constraints
      }
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await track.applyConstraints({ advanced: [{ torch: next }] } as any);
      setTorchOn(next);
    } catch (err) {
      console.warn("Failed to toggle flashlight:", err);
    }
  }

  async function stopScanner(scanner: { isScanning?: boolean; stop: () => Promise<void>; clear: () => void } | null) {
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {
      // ignore
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (reticleTimeoutRef.current) {
      clearTimeout(reticleTimeoutRef.current);
      reticleTimeoutRef.current = null;
    }
    if (reticleLockTimeoutRef.current) {
      clearTimeout(reticleLockTimeoutRef.current);
      reticleLockTimeoutRef.current = null;
    }
    setTorchOn(false);
    setHasTorch(false);
    setZoomCapabilities(null);
    setZoomLevel(1);
    setReticle(null);
  }

  async function cleanup() {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    await stopScanner(scanner);
  }

  function invalidatePendingInit() {
    initGenRef.current += 1;
  }

  async function init() {
    const gen = ++initGenRef.current;
    const isStale = () => gen !== initGenRef.current;

    await cleanup();
    if (isStale()) return;
    setCameraError(null);
    setNotFound(null);
    setStarted(false);
    pausedRef.current = false;

    let mod: typeof import("html5-qrcode");
    try {
      mod = await import("html5-qrcode");
    } catch {
      if (!isStale()) setCameraError("QR and Barcode scanner failed to load.");
      return;
    }
    if (isStale()) return;

    // Configure formats to support standard 2D QR codes and 1D Barcodes
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

    const scanner = new mod.Html5Qrcode("qr-reader", {
      formatsToSupport: supportedFormats,
      verbose: false,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true,
      },
    });
    scannerRef.current = scanner;

    try {
      const scanConfig = {
        fps: 20,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const w = Math.min(Math.floor(viewfinderWidth * 0.85), 320);
          const h = Math.min(Math.floor(viewfinderHeight * 0.65), 200);
          return {
            width: Math.min(w, Math.max(50, viewfinderWidth - 20)),
            height: Math.min(h, Math.max(50, viewfinderHeight - 20)),
          };
        },
      };

      const onScanSuccess = (decodedText: string) => {
        if (pausedRef.current || inFlightRef.current) return;
        void handleCodeRecognized(decodedText);
      };

      let startErr: unknown = null;
      // 1. Try environment camera with 1080p ideal resolution for sharp 1D barcodes
      try {
        await scanner.start(
          {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          scanConfig,
          onScanSuccess,
          undefined
        );
      } catch (err) {
        startErr = err;
      }

      // 2. Fallback to basic environment camera if resolution constraints rejected
      if (startErr && !isStale()) {
        try {
          await scanner.start(
            { facingMode: "environment" },
            scanConfig,
            onScanSuccess,
            undefined
          );
          startErr = null;
        } catch {
          // 3. Fallback to user/front camera (e.g. laptop webcam)
          try {
            await scanner.start(
              { facingMode: "user" },
              scanConfig,
              onScanSuccess,
              undefined
            );
            startErr = null;
          } catch (finalErr) {
            throw finalErr;
          }
        }
      }

      // Unmounted (or re-initialised) while start() was pending: release the camera now,
      // otherwise the stream would leak (e.g. React StrictMode double mount).
      if (isStale()) {
        if (scannerRef.current === scanner) scannerRef.current = null;
        await stopScanner(scanner);
        return;
      }
      setStarted(true);
      const video = document.querySelector<HTMLVideoElement>("#qr-reader video");
      if (video?.srcObject instanceof MediaStream) {
        streamRef.current = video.srcObject;
        const track = video.srcObject.getVideoTracks()[0];
        if (track) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cap = (track.getCapabilities ? track.getCapabilities() : {}) as any;
          if (cap.torch) setHasTorch(true);
          if (cap.zoom && cap.zoom.max > 1.2) {
            setZoomCapabilities({
              min: cap.zoom.min || 1,
              max: cap.zoom.max || 1,
              step: cap.zoom.step || 0.1,
            });
          }
          if (cap.focusMode?.includes("continuous") && track.applyConstraints) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            track.applyConstraints({ advanced: [{ focusMode: "continuous" }] } as any).catch(() => {});
          }
        }
      }
    } catch (err) {
      if (isStale()) {
        await stopScanner(scanner);
        return;
      }
      const msg = String(err);
      setCameraError(
        /NotAllowed|PermissionDenied/.test(msg)
          ? "Camera permission denied. Please allow camera access or use the USB/Bluetooth Barcode Scanner below."
          : "Camera not available. You can use an external USB/Bluetooth Barcode Scanner."
      );
    }
  }

  // Handle external USB/Bluetooth barcode scanner inputs via global keystroke buffer
  useEffect(() => {
    let buffer = "";
    let lastKeyTime = Date.now();

    function onKeyDown(e: KeyboardEvent) {
      // If modal is currently open, don't intercept typing in forms
      if (pausedRef.current) return;

      const now = Date.now();
      // External barcode scanners send keystrokes extremely rapidly (< 50ms interval)
      if (now - lastKeyTime > 100) {
        buffer = "";
      }
      lastKeyTime = now;

      if (e.key === "Enter") {
        if (buffer.length >= 2) {
          e.preventDefault();
          handleCodeRecognized(buffer);
          buffer = "";
        }
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    void init();
    return () => {
      // Invalidate any pending init so it stops the scanner once start() resolves.
      invalidatePendingInit();
      void cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleModalClose() {
    setModalOpen(false);
    setSelectedId(null);
    pausedRef.current = false;
    try {
      scannerRef.current?.resume();
    } catch {
      // Ignore
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = manualCode.trim();
    if (value) {
      setManualCode("");
      // Manual entry is an explicit action: allow re-submitting the same code immediately.
      lastCodeRef.current = null;
      void handleCodeRecognized(value);
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-5">
      {/* Scanner Mode Badges */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge variant="outline" className="gap-1 text-xs py-1 px-2.5 bg-background font-medium">
          <QrCode className="h-3.5 w-3.5 text-primary" />
          QR Codes
        </Badge>
        <Badge variant="outline" className="gap-1 text-xs py-1 px-2.5 bg-background font-medium">
          <Barcode className="h-3.5 w-3.5 text-primary" />
          Barcodes (Code128 / UPC)
        </Badge>
        <Badge variant="outline" className="gap-1 text-xs py-1 px-2.5 bg-background font-medium">
          <Handshake className="h-3.5 w-3.5 text-indigo-500" />
          Peer Handover (HD-XXXXXX)
        </Badge>
        <Badge variant="outline" className="gap-1 text-xs py-1 px-2.5 bg-primary/10 text-primary border-primary/20 font-medium">
          <Zap className="h-3.5 w-3.5" />
          USB / Bluetooth Scanner
        </Badge>
      </div>

      {/* Camera Viewfinder */}
      <div
        ref={viewfinderRef}
        className="relative rounded-2xl overflow-hidden border-2 border-primary/20 bg-black min-h-64 shadow-md select-none"
      >
        {!started && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 text-white">
            <Camera className="h-10 w-10 animate-pulse text-primary" />
            <p className="text-xs text-muted-foreground">Starting camera scanner…</p>
          </div>
        )}

        {/* Transparent Tap-to-Focus Touch Layer - captures touch/pointerdown immediately with zero lag */}
        {started && (
          <div
            className="absolute inset-0 z-10 cursor-crosshair touch-none select-none"
            onPointerDown={(e) => {
              e.preventDefault();
              void triggerFocusAtPoint(e.clientX, e.clientY);
            }}
          />
        )}

        {/* Tap-to-Focus Reticle Indicator */}
        {reticle && reticle.active && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 z-30 transition-all duration-200 ease-out flex flex-col items-center"
            style={{ left: reticle.x, top: reticle.y }}
          >
            <div
              className={cn(
                "relative w-16 h-16 border-2 rounded-xl transition-all duration-300 flex items-center justify-center",
                reticle.status === "focusing"
                  ? "border-amber-400 scale-110 shadow-[0_0_16px_rgba(251,191,36,0.9)]"
                  : "border-emerald-400 scale-100 shadow-[0_0_16px_rgba(52,211,153,0.9)]"
              )}
            >
              <span className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-white" />
              <span className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-white" />
              <span className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-white" />
              <span className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-white" />
              {reticle.status === "focusing" ? (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
            </div>
            <span
              className={cn(
                "mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-md shadow-sm transition-all",
                reticle.status === "focusing"
                  ? "bg-amber-500/80 text-black"
                  : "bg-emerald-600/90 text-white"
              )}
            >
              {reticle.status === "focusing" ? "Refocusing…" : "Focused ✓"}
            </span>
          </div>
        )}

        {/* Floating Quick Action Controls (Flashlight, Macro Zoom, Manual Focus) */}
        {started && (
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-black/60 backdrop-blur-md p-1 rounded-full border border-white/10 shadow-lg">
            {hasTorch && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleTorch();
                }}
                className={cn(
                  "h-8 w-8 rounded-full text-white transition-colors",
                  torchOn ? "bg-amber-500 text-black hover:bg-amber-400" : "hover:bg-white/20"
                )}
                title={torchOn ? "Turn off Flashlight" : "Turn on Flashlight"}
              >
                <Flashlight className="h-4 w-4" />
              </Button>
            )}
            {zoomCapabilities && zoomCapabilities.max > 1.2 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  void cycleZoom();
                }}
                className={cn(
                  "h-8 px-2.5 rounded-full text-xs font-bold text-white transition-colors",
                  zoomLevel > 1 ? "bg-primary text-primary-foreground hover:bg-primary/90" : "hover:bg-white/20"
                )}
                title="Cycle Zoom (1x / 2x / 3x) for small barcodes"
              >
                {`${zoomLevel}x`}
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                if (viewfinderRef.current) {
                  const rect = viewfinderRef.current.getBoundingClientRect();
                  void triggerFocusAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                }
              }}
              className="h-8 w-8 rounded-full text-white hover:bg-white/20"
              title="Refocus center"
            >
              <Focus className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Bottom Helper Hint & Macro Zoom Buttons */}
        {started && (
          <div className="absolute bottom-3 inset-x-3 z-20 flex flex-col items-center gap-1.5 pointer-events-none">
            {zoomCapabilities && zoomCapabilities.max > 1.2 && (
              <div className="pointer-events-auto flex items-center gap-1 bg-black/75 backdrop-blur-md px-1.5 py-1 rounded-full border border-white/10 shadow-md">
                <span className="text-[10px] text-white/70 font-medium pl-1.5 pr-0.5">Macro:</span>
                {[1, 2, ...(zoomCapabilities.max >= 3 ? [3] : [])].map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void applyZoom(z);
                    }}
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[11px] font-bold transition-all",
                      Math.abs(zoomLevel - z) < 0.2
                        ? "bg-amber-400 text-black shadow-sm"
                        : "text-white/80 hover:text-white hover:bg-white/20"
                    )}
                  >
                    {z}x
                  </button>
                ))}
              </div>
            )}

            <div className="bg-black/75 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-[11px] text-white/95 font-medium flex items-center gap-1.5 shadow-sm text-center">
              <Focus className="h-3 w-3 text-amber-400 shrink-0" />
              <span>Tap anywhere to focus • Hold 15–20 cm away</span>
            </div>
          </div>
        )}

        <div id="qr-reader" className="w-full [&_video]:w-full" />
      </div>

      {cameraError && (
        <div className="flex flex-col items-center gap-2 text-center p-3 border rounded-xl bg-destructive/10 border-destructive/20">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p className="text-xs text-destructive font-medium">{cameraError}</p>
          <Button variant="outline" size="sm" onClick={() => void init()} className="h-8 text-xs mt-1">
            <RefreshCcw className="h-3 w-3 mr-1.5" />
            Retry Camera
          </Button>
        </div>
      )}

      {/* External / Manual Barcode Input */}
      <form onSubmit={handleManualSubmit} className="space-y-2 p-3.5 border rounded-xl bg-muted/20">
        <div className="flex items-center justify-between">
          <label htmlFor="barcode-input" className="text-xs font-semibold flex items-center gap-1.5">
            <Barcode className="h-4 w-4 text-primary" />
            External Scanner or Manual Entry
          </label>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            Gun Ready
          </span>
        </div>
        <div className="flex gap-2">
          <Input
            id="barcode-input"
            ref={manualInputRef}
            placeholder="Scan with USB gun, enter ID (e.g. LP-KAM-001) or handover code (HD-123456)…"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            className="text-xs h-9 font-mono"
          />
          <Button type="submit" size="sm" className="h-9 px-3 text-xs shrink-0">
            Scan
          </Button>
        </div>
      </form>

      {notFound && (
        <div className="p-3 border rounded-xl bg-amber-500/10 border-amber-500/30 text-center space-y-1">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            No equipment found matching <strong>&quot;{notFound}&quot;</strong>.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Please make sure the QR code or barcode matches an existing Equipment ID or name.
          </p>
        </div>
      )}

      {started && !cameraError && (
        <p className="text-xs text-center text-muted-foreground">
          Point the camera at an equipment <strong>QR Code</strong> or <strong>Barcode</strong>, or pull the trigger on an external USB/Bluetooth scanner gun.
        </p>
      )}

      <EquipmentModal
        equipmentId={selectedId}
        open={modalOpen}
        role={role}
        userName={userName}
        onClose={handleModalClose}
        onUpdated={() => {}}
      />
    </div>
  );
}
