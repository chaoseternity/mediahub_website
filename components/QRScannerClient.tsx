"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EquipmentModal } from "@/components/EquipmentModal";
import type { Equipment, Role } from "@/lib/types";

interface QRScannerClientProps {
  equipment: Equipment[];
  role: Role;
  userName: string;
}

export function QRScannerClient({ equipment, role, userName }: QRScannerClientProps) {
  const [started, setStarted] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(false);
  // Keep equipment ref stable so the scan callback always sees current data
  const equipmentRef = useRef(equipment);
  equipmentRef.current = equipment;

  async function cleanup() {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {
      // ignore
    }
    // Explicitly stop every MediaStreamTrack — the OS-level signal that
    // releases the camera indicator light
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    scannerRef.current = null;
  }

  async function init() {
    await cleanup();
    setCameraError(null);
    setNotFound(null);
    setStarted(false);
    pausedRef.current = false;

    let mod: typeof import("html5-qrcode");
    try {
      mod = await import("html5-qrcode");
    } catch {
      setCameraError("QR scanner failed to load.");
      return;
    }

    const scanner = new mod.Html5Qrcode("qr-reader");
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText: string) => {
          if (pausedRef.current) return;
          const name = decodedText.trim();
          const found = equipmentRef.current.find(
            (e) => e.name.toLowerCase() === name.toLowerCase(),
          );
          if (found) {
            pausedRef.current = true;
            scanner.pause(true);
            setNotFound(null);
            setSelectedId(found.id);
            setModalOpen(true);
          } else {
            setNotFound(name);
          }
        },
        undefined,
      );
      setStarted(true);
      // Capture the MediaStream so cleanup can stop tracks explicitly
      const video = document.querySelector<HTMLVideoElement>("#qr-reader video");
      if (video?.srcObject instanceof MediaStream) {
        streamRef.current = video.srcObject;
      }
    } catch (err) {
      const msg = String(err);
      setCameraError(
        /NotAllowed|PermissionDenied/.test(msg)
          ? "Camera permission denied. Please allow camera access and try again."
          : "Camera not available. Make sure no other app is using it.",
      );
    }
  }

  useEffect(() => {
    void init();
    return () => { void cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleModalClose() {
    setModalOpen(false);
    setSelectedId(null);
    pausedRef.current = false;
    scannerRef.current?.resume();
  }

  return (
    <div className="max-w-sm mx-auto space-y-4">
      {/* Viewfinder — always in DOM so Html5Qrcode can attach to it */}
      <div className="relative rounded-xl overflow-hidden border bg-black min-h-64">
        {!started && !cameraError && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <Camera className="h-8 w-8 text-white animate-pulse" />
          </div>
        )}
        <div id="qr-reader" className="w-full [&_video]:w-full" />
      </div>

      {cameraError && (
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-destructive">{cameraError}</p>
          <Button variant="outline" size="sm" onClick={() => void init()}>
            <RefreshCcw className="h-3.5 w-3.5 mr-2" />
            Retry
          </Button>
        </div>
      )}

      {notFound && (
        <p className="text-sm text-center text-amber-600 dark:text-amber-400">
          No equipment found matching <strong>&quot;{notFound}&quot;</strong>.
        </p>
      )}

      {started && !cameraError && (
        <p className="text-xs text-center text-muted-foreground">
          Point the camera at an equipment QR code.
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
