"use client";

import { useEffect, useState, useRef } from "react";
import QRCode from "qrcode";
import { Copy, Check, Clock, QrCode, ShieldCheck, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { HandoverCode } from "@/lib/types";
import { parseDbDate } from "@/lib/timezone";

interface HandoverModalProps {
  equipmentId: number;
  equipmentName: string;
  open: boolean;
  onClose: () => void;
  onHandoverComplete?: () => void;
}

export function HandoverModal({
  equipmentId,
  equipmentName,
  open,
  onClose,
  onHandoverComplete,
}: HandoverModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoverData, setHandoverData] = useState<HandoverCode | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(15 * 60);
  const [claimed, setClaimed] = useState(false);

  // Expiry timestamp (ms) of the current code; read by the poller without making it a dependency.
  const expiresAtRef = useRef<number>(0);
  // Latest callbacks, so the timers below don't restart when the parent re-renders.
  const onCloseRef = useRef(onClose);
  const onHandoverCompleteRef = useRef(onHandoverComplete);
  useEffect(() => {
    onCloseRef.current = onClose;
    onHandoverCompleteRef.current = onHandoverComplete;
  }, [onClose, onHandoverComplete]);
  // Ensures onHandoverComplete fires at most once per claimed code.
  const completionNotifiedRef = useRef(false);

  // Generate code on open
  useEffect(() => {
    if (!open) {
      setHandoverData(null);
      setQrDataUrl("");
      setClaimed(false);
      setError(null);
      return;
    }

    let cancelled = false;
    completionNotifiedRef.current = false;

    async function init() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/equipment/${equipmentId}/handover`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to generate handover code.");
        }
        if (cancelled) return;

        // Calculate initial remaining seconds
        // SQLite timestamps have no zone designator; parseDbDate reads them as UTC.
        const expiresAt = parseDbDate(data.expires_at)?.getTime() ?? Date.now();
        expiresAtRef.current = expiresAt;
        setSecondsRemaining(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
        setHandoverData(data);

        // Generate QR code (encodes the plain "HD-XXXXXX" code)
        const qrUrl = await QRCode.toDataURL(data.code, {
          width: 260,
          margin: 1.5,
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (!cancelled) setQrDataUrl(qrUrl);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to initiate handover.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [open, equipmentId]);

  const activeCode = handoverData?.code ?? null;

  // Countdown timer: one interval per code, derived from the absolute expiry time so it
  // never drifts and is not re-created every second.
  useEffect(() => {
    if (!activeCode || claimed) return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAtRef.current - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [activeCode, claimed]);

  // Poll for claim status on a stable 3s interval (depends only on the code / claimed state).
  useEffect(() => {
    if (!open || !activeCode || claimed) return;

    let cancelled = false;
    let inFlight = false;

    const poll = setInterval(async () => {
      if (Date.now() >= expiresAtRef.current) {
        clearInterval(poll);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/handover/${encodeURIComponent(activeCode)}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          const data: HandoverCode = await res.json();
          if (cancelled) return;
          if (data.status === "claimed") {
            clearInterval(poll);
            setClaimed(true);
          } else if (data.status !== "active") {
            // expired / revoked: nothing left to wait for
            clearInterval(poll);
          }
        } else if (res.status === 403 || res.status === 404) {
          // Not visible to us (or gone) — stop polling rather than hammering the API.
          clearInterval(poll);
        }
      } catch {
        // ignore transient poll errors
      } finally {
        inFlight = false;
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [open, activeCode, claimed]);

  // After a successful claim, show the success state briefly, then close.
  useEffect(() => {
    if (!claimed) return;
    const t = setTimeout(() => {
      if (!completionNotifiedRef.current) {
        completionNotifiedRef.current = true;
        onHandoverCompleteRef.current?.();
      }
      onCloseRef.current();
    }, 2500);
    return () => clearTimeout(t);
  }, [claimed]);

  function handleClose() {
    // If the user dismisses the success screen early, still let the parent refresh.
    if (claimed && !completionNotifiedRef.current) {
      completionNotifiedRef.current = true;
      onHandoverComplete?.();
    }
    onClose();
  }

  // Clear the "copied" indicator timer on unmount.
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  function handleCopy() {
    if (!handoverData?.code) return;
    navigator.clipboard.writeText(handoverData.code).catch(() => {});
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const timerDisplay = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md max-w-[95vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            Peer-to-Peer Handover
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Generating temporary handover code...</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center space-y-3">
            <div className="text-destructive font-semibold">Handover Error</div>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={handleClose} className="mt-2">
              Close
            </Button>
          </div>
        ) : claimed ? (
          <div className="py-8 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Handover Transferred!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Equipment responsibility successfully transferred to the recipient borrower.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="text-center bg-muted/40 p-3 rounded-lg border">
              <div className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
                Equipment Handover
              </div>
              <div className="text-base font-semibold text-foreground mt-0.5 truncate">
                {equipmentName}
              </div>
            </div>

            {/* QR Code Display */}
            {qrDataUrl && (
              <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl shadow-xs border mx-auto w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt={`Handover QR Code for ${equipmentName}`}
                  className="w-48 h-48 block rounded-md"
                />
              </div>
            )}

            {/* Temporary 6-digit code (HD-XXXXXX) */}
            {handoverData && (
              <div className="space-y-1.5">
                <div className="text-xs text-center text-muted-foreground font-medium">
                  Or enter this code on the recipient&apos;s phone:
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono text-2xl font-extrabold tracking-widest bg-accent px-4 py-1.5 rounded-lg border text-foreground select-all">
                    {handoverData.code}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopy}
                    className="h-10 w-10 shrink-0"
                    title="Copy code"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}

            {/* Live Expiry Countdown */}
            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground pt-1">
              <Clock className="h-3.5 w-3.5" />
              <span>
                Code expires in{" "}
                <strong className={secondsRemaining < 120 ? "text-destructive" : "text-foreground"}>
                  {timerDisplay}
                </strong>
              </span>
            </div>

            <div className="text-xs text-muted-foreground text-center bg-muted/30 p-2.5 rounded-md border text-[11px] leading-relaxed">
              Recipient can scan this code via <strong>Scan QR</strong> or enter the code under <strong>Claim Handover</strong>.
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-end">
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
