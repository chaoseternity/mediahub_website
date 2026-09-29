"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, RefreshCcw, Barcode, QrCode, Zap, CheckCircle2, Handshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EquipmentModal } from "@/components/EquipmentModal";
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

  async function stopScanner(scanner: { isScanning?: boolean; stop: () => Promise<void>; clear: () => void } | null) {
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {
      // ignore
    }
  }

  async function cleanup() {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    await stopScanner(scanner);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
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
    });
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: { width: 260, height: 180 } },
        (decodedText: string) => {
          if (pausedRef.current || inFlightRef.current) return;
          void handleCodeRecognized(decodedText);
        },
        undefined
      );
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
      <div className="relative rounded-2xl overflow-hidden border-2 border-primary/20 bg-black min-h-64 shadow-md">
        {!started && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 text-white">
            <Camera className="h-10 w-10 animate-pulse text-primary" />
            <p className="text-xs text-muted-foreground">Starting camera scanner…</p>
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
