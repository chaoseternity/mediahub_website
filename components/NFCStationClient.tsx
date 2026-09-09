"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Nfc,
  Barcode,
  RotateCcw,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Package,
  UserCheck,
  Search,
  Radio,
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight,
  PlusCircle,
  HelpCircle,
  Laptop,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { User, Equipment, NFCMemberData, NFCCheckoutItem, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

// Audio synthesized sound effects via Web Audio API
function playSound(type: "success" | "warning" | "error" | "scan" | "return") {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    if (type === "success") {
      // Ascending two-tone chime
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.12);
      osc2.start(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.35);
    } else if (type === "return") {
      // Gentle return confirmation chime
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      osc.frequency.exponentialRampToValueAtTime(523.25, ctx.currentTime + 0.25); // C5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === "warning") {
      // Attention prompt chime
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(554.37, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } else if (type === "error") {
      // Low buzz
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(160, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(110, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else {
      // Brief scan blip
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(784, ctx.currentTime); // G5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    }
  } catch {
    // Ignore audio policy blocks
  }
}

interface NFCStationClientProps {
  allEquipment: Equipment[];
  allUsers: User[];
  currentRole: Role;
  currentUserName: string;
}

type StationMode = "awaiting_nfc" | "member_active";
type ScanAction = "return" | "checkout";

export function NFCStationClient({
  allEquipment: initialEquipment,
  allUsers: initialUsers,
  currentRole,
}: NFCStationClientProps) {
  const [equipmentList, setEquipmentList] = useState<Equipment[]>(initialEquipment);
  const [usersList, setUsersList] = useState<User[]>(initialUsers);

  // Workflow states
  const [stationMode, setStationMode] = useState<StationMode>("awaiting_nfc");
  const [scanAction, setScanAction] = useState<ScanAction>("checkout");
  const [memberData, setMemberData] = useState<NFCMemberData | null>(null);
  const [activeTab, setActiveTab] = useState<"current" | "history">("current");

  // Input & Scanner
  const [manualInput, setManualInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: "info" | "success" | "warning" | "error";
  } | null>(null);

  // Unregistered card registration dialog
  const [unregisteredCard, setUnregisteredCard] = useState<string | null>(null);
  const [selectedUserIdToPair, setSelectedUserIdToPair] = useState<number | null>(null);

  // Confirmation dialog for "Already Checked Out" prompt
  const [collisionPrompt, setCollisionPrompt] = useState<{
    equipment: Equipment;
    checkoutItem?: NFCCheckoutItem;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const isProcessingRef = useRef(false);
  isProcessingRef.current = isProcessing;

  // Auto-focus input on mode changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [stationMode, scanAction, collisionPrompt, unregisteredCard]);

  // Keep equipment and memberData references updated for event listeners
  const memberDataRef = useRef(memberData);
  memberDataRef.current = memberData;
  const equipmentListRef = useRef(equipmentList);
  equipmentListRef.current = equipmentList;
  const scanActionRef = useRef(scanAction);
  scanActionRef.current = scanAction;
  const stationModeRef = useRef(stationMode);
  stationModeRef.current = stationMode;

  // Helper to match equipment by barcode / serial_number / name / id
  const findEquipment = useCallback((rawCode: string): Equipment | undefined => {
    const code = rawCode.trim().toLowerCase();
    if (!code) return undefined;

    return (
      equipmentListRef.current.find(
        (e) => e.serial_number && e.serial_number.toLowerCase() === code
      ) ||
      equipmentListRef.current.find((e) => e.name.toLowerCase() === code) ||
      (/^\d+$/.test(code)
        ? equipmentListRef.current.find((e) => e.id === Number(code))
        : undefined)
    );
  }, []);

  // Fetch updated member data by NFC ID
  const refreshMemberData = useCallback(async (nfcId: string) => {
    try {
      const res = await fetch(`/api/nfc?nfc_id=${encodeURIComponent(nfcId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.found) {
          setMemberData({
            member: data.member,
            activeCheckouts: data.activeCheckouts || [],
            history: data.history || [],
          });
        }
      }
    } catch (err) {
      console.error("Failed to refresh member data:", err);
    }
  }, []);

  // Refresh equipment list from server
  const refreshEquipmentList = useCallback(async () => {
    try {
      const res = await fetch("/api/equipment");
      if (res.ok) {
        const data = await res.json();
        setEquipmentList(data);
      }
    } catch (err) {
      console.error("Failed to refresh equipment list:", err);
    }
  }, []);

  // 1. NFC CARD RECOGNITION HANDLER
  const handleNfcScanned = useCallback(
    async (rawCardId: string) => {
      const nfcId = rawCardId.trim();
      if (!nfcId) return;

      setIsProcessing(true);
      setStatusMessage({ text: `Looking up NFC card: ${nfcId}...`, type: "info" });
      playSound("scan");

      try {
        const res = await fetch(`/api/nfc?nfc_id=${encodeURIComponent(nfcId)}`);
        const json = await res.json();

        if (json.found) {
          setMemberData({
            member: json.member,
            activeCheckouts: json.activeCheckouts || [],
            history: json.history || [],
          });
          setStationMode("member_active");
          setScanAction("checkout"); // default to checkout mode as per workflow
          setStatusMessage({
            text: `Welcome ${json.member.name || json.member.username}! Ready for checkout or returns.`,
            type: "success",
          });
          playSound("success");
        } else {
          playSound("error");
          setUnregisteredCard(nfcId);
          setStatusMessage({
            text: `NFC Card "${nfcId}" is not registered in the system.`,
            type: "warning",
          });
        }
      } catch (err) {
        playSound("error");
        setStatusMessage({
          text: "Network error reading NFC card. Please try again.",
          type: "error",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  // 2. RETURN EQUIPMENT HANDLER
  const executeReturn = useCallback(
    async (equipmentId: number, equipName?: string) => {
      if (!memberDataRef.current) return;
      setIsProcessing(true);

      try {
        const res = await fetch("/api/nfc/return", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            equipment_id: equipmentId,
            nfc_id: memberDataRef.current.member.nfc_id,
          }),
        });

        const json = await res.json();
        if (res.ok) {
          playSound("return");
          setStatusMessage({
            text: `Successfully returned "${equipName || json.equipment?.name || "Equipment"}"!`,
            type: "success",
          });
          if (memberDataRef.current.member.nfc_id) {
            await refreshMemberData(memberDataRef.current.member.nfc_id);
          }
          await refreshEquipmentList();
        } else {
          playSound("error");
          setStatusMessage({
            text: json.error || "Failed to return equipment.",
            type: "error",
          });
        }
      } catch (err) {
        playSound("error");
        setStatusMessage({
          text: "Error processing equipment return.",
          type: "error",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [refreshMemberData, refreshEquipmentList]
  );

  // 3. CHECKOUT EQUIPMENT HANDLER
  const executeCheckout = useCallback(
    async (equipment: Equipment) => {
      if (!memberDataRef.current) return;
      setIsProcessing(true);

      try {
        const res = await fetch("/api/nfc/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            equipment_id: equipment.id,
            nfc_id: memberDataRef.current.member.nfc_id,
          }),
        });

        const json = await res.json();
        if (res.ok) {
          playSound("success");
          setStatusMessage({
            text: `Successfully checked out "${equipment.name}" to ${
              memberDataRef.current.member.name || "member"
            }!`,
            type: "success",
          });
          if (memberDataRef.current.member.nfc_id) {
            await refreshMemberData(memberDataRef.current.member.nfc_id);
          }
          await refreshEquipmentList();
        } else {
          playSound("error");
          setStatusMessage({
            text: json.error || "Failed to check out equipment.",
            type: "error",
          });
        }
      } catch (err) {
        playSound("error");
        setStatusMessage({
          text: "Error processing equipment checkout.",
          type: "error",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [refreshMemberData, refreshEquipmentList]
  );

  // 4. BARCODE SCANNED IN MEMBER ACTIVE MODE
  const handleBarcodeScanned = useCallback(
    async (rawBarcode: string) => {
      const code = rawBarcode.trim();
      if (!code || !memberDataRef.current) return;

      const foundEquipment = findEquipment(code);
      if (!foundEquipment) {
        playSound("error");
        setStatusMessage({
          text: `Equipment not found for barcode: "${code}".`,
          type: "warning",
        });
        return;
      }

      // Check if equipment is currently checked out by THIS member
      const isAlreadyCheckedOutByMember = memberDataRef.current.activeCheckouts.some(
        (c) => c.equipment_id === foundEquipment.id
      );

      // WORKFLOW REQUIREMENT 3: Return Mode
      if (scanActionRef.current === "return") {
        if (!isAlreadyCheckedOutByMember) {
          playSound("warning");
          setStatusMessage({
            text: `"${foundEquipment.name}" is not currently checked out by ${
              memberDataRef.current.member.name || "this member"
            }.`,
            type: "warning",
          });
          return;
        }

        // Return immediately
        await executeReturn(foundEquipment.id, foundEquipment.name);
        return;
      }

      // WORKFLOW REQUIREMENT 4: Checkout Mode
      if (scanActionRef.current === "checkout") {
        if (isAlreadyCheckedOutByMember) {
          // PROMPT: "If the barcode is one of the equipments the person has already checked out,
          // prompt the user if he wants to return the equipment, not check it out.
          // If he says yes, return the equipment, if not just ignore that scan."
          playSound("warning");
          const activeItem = memberDataRef.current.activeCheckouts.find(
            (c) => c.equipment_id === foundEquipment.id
          );
          setCollisionPrompt({
            equipment: foundEquipment,
            checkoutItem: activeItem,
          });
          return;
        }

        // Check if available or unavailable
        if (foundEquipment.status !== "Available") {
          playSound("error");
          setStatusMessage({
            text: `"${foundEquipment.name}" cannot be checked out (Status: ${foundEquipment.status}).`,
            type: "error",
          });
          return;
        }

        // Check it out
        await executeCheckout(foundEquipment);
      }
    },
    [findEquipment, executeReturn, executeCheckout]
  );

  // 5. MASTER INPUT / SCAN DISPATCHER
  const handleScanSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setManualInput("");

      if (stationModeRef.current === "awaiting_nfc") {
        void handleNfcScanned(trimmed);
      } else {
        void handleBarcodeScanned(trimmed);
      }
    },
    [handleNfcScanned, handleBarcodeScanned]
  );

  // 6. GLOBAL HARDWARE SCANNER KEYSTROKE LISTENER (USB / Bluetooth HID)
  useEffect(() => {
    let buffer = "";
    let lastKeyTime = Date.now();

    function onKeyDown(e: KeyboardEvent) {
      // Don't intercept if an explicit modal dialog (like pair dialog) is focused on an input
      if (unregisteredCard !== null) return;

      const now = Date.now();
      // Scanners send characters with < 80ms intervals
      if (now - lastKeyTime > 100) {
        buffer = "";
      }
      lastKeyTime = now;

      if (e.key === "Enter") {
        if (buffer.length >= 2) {
          e.preventDefault();
          const scanned = buffer.trim();
          buffer = "";
          handleScanSubmit(scanned);
        }
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [unregisteredCard, handleScanSubmit]);

  // Pair unregistered card to existing member
  async function handlePairCard() {
    if (!unregisteredCard || !selectedUserIdToPair) return;
    setIsProcessing(true);

    try {
      const res = await fetch("/api/nfc/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedUserIdToPair,
          nfc_id: unregisteredCard,
        }),
      });

      const json = await res.json();
      if (res.ok) {
        playSound("success");
        // Update local users list
        setUsersList((prev) =>
          prev.map((u) => (u.id === selectedUserIdToPair ? { ...u, nfc_id: unregisteredCard } : u))
        );
        const cardToLoad = unregisteredCard;
        setUnregisteredCard(null);
        setSelectedUserIdToPair(null);
        // Automatically load this member's station
        await handleNfcScanned(cardToLoad);
      } else {
        playSound("error");
        setStatusMessage({ text: json.error || "Failed to pair card.", type: "error" });
      }
    } catch {
      playSound("error");
      setStatusMessage({ text: "Error pairing NFC card.", type: "error" });
    } finally {
      setIsProcessing(false);
    }
  }

  // Reset station for next member
  function handleSwitchMember() {
    playSound("scan");
    setMemberData(null);
    setStationMode("awaiting_nfc");
    setStatusMessage(null);
    setManualInput("");
    setCollisionPrompt(null);
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full pb-12">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
              <Nfc className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">NFC Equipment Station</h1>
              <p className="text-xs text-muted-foreground">
                Tap member NFC card, then scan equipment barcodes to return or checkout
              </p>
            </div>
          </div>
        </div>

        {/* Station status & quick switch */}
        <div className="flex items-center gap-2">
          {stationMode === "member_active" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSwitchMember}
              className="gap-2 border-primary/30 hover:bg-primary/10"
            >
              <RotateCcw className="h-4 w-4" />
              Finish / Switch Member
            </Button>
          )}

          <Badge
            variant="outline"
            className={cn(
              "px-3 py-1 text-xs font-semibold gap-1.5",
              stationMode === "awaiting_nfc"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 animate-pulse"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
            )}
          >
            <Radio className="h-3 w-3" />
            {stationMode === "awaiting_nfc" ? "Waiting for NFC Tap" : "Member Station Active"}
          </Badge>
        </div>
      </div>

      {/* Global Scanner Input / Barcode Bar */}
      <div className="relative rounded-2xl border bg-card/60 backdrop-blur-md p-4 shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleScanSubmit(manualInput);
          }}
          className="flex flex-col sm:flex-row gap-2.5 items-stretch"
        >
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground">
              {stationMode === "awaiting_nfc" ? (
                <Nfc className="h-5 w-5 text-primary animate-pulse" />
              ) : (
                <Barcode className="h-5 w-5 text-primary" />
              )}
            </div>
            <Input
              ref={inputRef}
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              disabled={isProcessing}
              placeholder={
                stationMode === "awaiting_nfc"
                  ? "Scan NFC Card with connected scanner or enter NFC Card ID..."
                  : scanAction === "return"
                  ? "Scan Equipment Barcode to RETURN..."
                  : "Scan Equipment Barcode to CHECK OUT..."
              }
              className="pl-11 h-12 text-sm md:text-base font-medium rounded-xl border-primary/30 focus-visible:ring-primary/40 shadow-inner"
            />
          </div>

          <Button
            type="submit"
            disabled={isProcessing || !manualInput.trim()}
            className="h-12 px-6 rounded-xl font-semibold gap-2 shrink-0 shadow-sm"
          >
            <Search className="h-4 w-4" />
            {stationMode === "awaiting_nfc" ? "Look Up Card" : "Submit Barcode"}
          </Button>
        </form>

        {/* Live Feedback / Notification Banner */}
        {statusMessage && (
          <div
            className={cn(
              "mt-3 px-3.5 py-2.5 rounded-lg text-xs md:text-sm font-medium flex items-center gap-2 transition-all",
              statusMessage.type === "success" &&
                "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30",
              statusMessage.type === "warning" &&
                "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
              statusMessage.type === "error" &&
                "bg-destructive/15 text-destructive border border-destructive/30",
              statusMessage.type === "info" &&
                "bg-primary/15 text-primary border border-primary/30"
            )}
          >
            {statusMessage.type === "success" && <CheckCircle2 className="h-4 w-4 shrink-0" />}
            {statusMessage.type === "warning" && <AlertTriangle className="h-4 w-4 shrink-0" />}
            {statusMessage.type === "error" && <XCircle className="h-4 w-4 shrink-0" />}
            {statusMessage.type === "info" && <Sparkles className="h-4 w-4 shrink-0" />}
            <span className="flex-1">{statusMessage.text}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStatusMessage(null)}
              className="h-6 w-6 p-0 hover:bg-transparent text-current opacity-70 hover:opacity-100"
            >
              ✕
            </Button>
          </div>
        )}
      </div>

      {/* STATE 1: AWAITING NFC CARD SCAN */}
      {stationMode === "awaiting_nfc" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Hero Card */}
          <Card className="md:col-span-2 border-dashed border-2 border-primary/30 bg-gradient-to-br from-card/80 via-card/40 to-primary/5 rounded-2xl flex flex-col items-center justify-center p-8 sm:p-12 text-center relative overflow-hidden">
            {/* Animated glowing wave background */}
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="relative mb-6">
              <div className="w-24 h-24 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center shadow-lg animate-pulse">
                <Nfc className="h-12 w-12 text-primary" />
              </div>
              <div className="absolute -inset-2 rounded-full border border-primary/20 animate-ping pointer-events-none" />
            </div>

            <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-2">
              Ready for Member NFC Card
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Hold or tap the club member&apos;s physical NFC card on the USB NFC scanner connected to
              this laptop to begin.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/60 border">
                <Laptop className="h-3.5 w-3.5 text-primary" /> USB NFC Scanner Active
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/60 border">
                <Barcode className="h-3.5 w-3.5 text-primary" /> Barcode Ready
              </span>
            </div>
          </Card>

          {/* Side panel: Registered Members quick test / list */}
          <Card className="rounded-2xl flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Club Members ({usersList.length})</span>
                <Badge variant="outline" className="text-[10px]">
                  Quick Tap Simulator
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Tap any member below to simulate their NFC card scan:
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto max-h-72 space-y-2 pr-2">
              {usersList.map((user) => {
                const hasNfc = Boolean(user.nfc_id);
                return (
                  <button
                    key={user.id}
                    onClick={() => {
                      if (user.nfc_id) {
                        void handleNfcScanned(user.nfc_id);
                      } else {
                        // Prompt to assign
                        setUnregisteredCard(`NFC-${user.name.toUpperCase().replace(/\s+/g, "")}-01`);
                        setSelectedUserIdToPair(user.id);
                      }
                    }}
                    className="w-full text-left p-2.5 rounded-xl border bg-background/50 hover:bg-accent hover:border-primary/40 transition-all flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate group-hover:text-primary">
                        {user.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {user.username ? `@${user.username}` : user.email}
                      </p>
                    </div>

                    {hasNfc ? (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-mono shrink-0 bg-primary/10 text-primary border-primary/20"
                      >
                        {user.nfc_id}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] shrink-0 text-muted-foreground hover:border-primary"
                      >
                        + Assign Card
                      </Badge>
                    )}
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* STATE 2: MEMBER ACTIVE */}
      {stationMode === "member_active" && memberData && (
        <div className="space-y-6">
          {/* Member Identity Banner */}
          <Card className="rounded-2xl border-primary/30 bg-gradient-to-r from-primary/10 via-background to-primary/5 p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center font-bold text-lg text-primary shadow-xs">
                  {memberData.member.name?.slice(0, 2).toUpperCase() || "MB"}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">{memberData.member.name}</h2>
                    {memberData.member.username && (
                      <span className="text-xs text-muted-foreground">
                        (@{memberData.member.username})
                      </span>
                    )}
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {memberData.member.role}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{memberData.member.email}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] gap-1 bg-background/80 border-primary/30 text-primary"
                    >
                      <Nfc className="h-3 w-3" />
                      NFC: {memberData.member.nfc_id || "Registered"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Action Mode Toggle Buttons */}
              <div className="flex items-center gap-2 bg-background/80 p-1.5 rounded-xl border shadow-2xs">
                <Button
                  type="button"
                  variant={scanAction === "checkout" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setScanAction("checkout");
                    playSound("scan");
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "rounded-lg gap-2 text-xs font-semibold transition-all",
                    scanAction === "checkout" &&
                      "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                  )}
                >
                  <ArrowUpRight className="h-4 w-4" />
                  Checkout Equipment
                </Button>

                <Button
                  type="button"
                  variant={scanAction === "return" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setScanAction("return");
                    playSound("scan");
                    inputRef.current?.focus();
                  }}
                  className={cn(
                    "rounded-lg gap-2 text-xs font-semibold transition-all",
                    scanAction === "return" &&
                      "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                  )}
                >
                  <ArrowDownLeft className="h-4 w-4" />
                  Return Equipment
                </Button>
              </div>
            </div>
          </Card>

          {/* Active Mode Notice */}
          <div
            className={cn(
              "px-4 py-3 rounded-xl border flex items-center justify-between text-xs sm:text-sm font-medium shadow-xs transition-colors",
              scanAction === "checkout"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30"
            )}
          >
            <div className="flex items-center gap-2">
              <Barcode className="h-4 w-4 animate-pulse shrink-0" />
              <span>
                {scanAction === "checkout"
                  ? "SCANNER IN CHECKOUT MODE: Scan barcode of equipment to check out. (If already checked out to member, system prompts to return)."
                  : "SCANNER IN RETURN MODE: Scan barcode of equipment to return it immediately."}
              </span>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] uppercase font-bold shrink-0",
                scanAction === "checkout" ? "border-emerald-500/40" : "border-blue-500/40"
              )}
            >
              Listening...
            </Badge>
          </div>

          {/* Navigation Tabs for Active Items vs History */}
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab("current")}
              className={cn(
                "px-5 py-2.5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2",
                activeTab === "current"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Package className="h-4 w-4" />
              Currently Checked Out
              <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0.2">
                {memberData.activeCheckouts.length}
              </Badge>
            </button>

            <button
              onClick={() => setActiveTab("history")}
              className={cn(
                "px-5 py-2.5 text-sm font-semibold border-b-2 transition-all flex items-center gap-2",
                activeTab === "history"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Clock className="h-4 w-4" />
              Checkout History
              <Badge variant="outline" className="ml-1 text-xs px-1.5 py-0.2">
                {memberData.history.length}
              </Badge>
            </button>
          </div>

          {/* TAB 1: CURRENTLY CHECKED OUT */}
          {activeTab === "current" && (
            <div>
              {memberData.activeCheckouts.length === 0 ? (
                <Card className="border-dashed p-10 text-center rounded-2xl">
                  <Package className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                  <h3 className="font-semibold text-base mb-1">No equipment currently checked out</h3>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
                    This member has no active equipment checkouts. Scan an available equipment
                    barcode to check it out to them.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setScanAction("checkout");
                      inputRef.current?.focus();
                    }}
                    className="gap-1.5 text-xs font-semibold"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    Scan Barcode to Checkout
                  </Button>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {memberData.activeCheckouts.map((item) => (
                    <Card
                      key={item.id}
                      className="rounded-xl border hover:border-primary/50 transition-all p-4 flex flex-col justify-between group shadow-xs"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-sm group-hover:text-primary transition-colors">
                            {item.equipment_name}
                          </h4>
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0"
                          >
                            {item.equipment_serial_number || "NO-BARCODE"}
                          </Badge>
                        </div>

                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <span>📍 Location:</span>
                          <span className="font-medium text-foreground">
                            {item.equipment_location || "Media Room"}
                          </span>
                        </p>

                        <div className="text-[11px] text-muted-foreground space-y-0.5 pt-1 border-t">
                          <p>
                            Checked out:{" "}
                            <span className="font-medium text-foreground">
                              {new Date(item.checked_out_at).toLocaleString()}
                            </span>
                          </p>
                          {item.notes && <p className="italic text-[10px]">Note: {item.notes}</p>}
                        </div>
                      </div>

                      {/* Instant Return Button */}
                      <div className="pt-3 mt-2 border-t">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => executeReturn(item.equipment_id, item.equipment_name)}
                          disabled={isProcessing}
                          className="w-full text-xs font-semibold gap-1.5 hover:bg-blue-600 hover:text-white transition-colors"
                        >
                          <ArrowDownLeft className="h-3.5 w-3.5" />
                          Return This Item
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CHECKOUT HISTORY */}
          {activeTab === "history" && (
            <Card className="rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 uppercase text-[10px] text-muted-foreground tracking-wider border-b">
                    <tr>
                      <th className="p-3">Equipment</th>
                      <th className="p-3">Barcode / ID</th>
                      <th className="p-3">Checked Out</th>
                      <th className="p-3">Returned</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {memberData.history.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-muted-foreground">
                          No past checkout records for this NFC card.
                        </td>
                      </tr>
                    ) : (
                      memberData.history.map((record) => {
                        const isReturned = Boolean(record.returned_at);
                        return (
                          <tr key={record.id} className="hover:bg-accent/40 transition-colors">
                            <td className="p-3 font-semibold text-foreground">
                              {record.equipment_name}
                            </td>
                            <td className="p-3 font-mono text-[11px]">
                              {record.equipment_serial_number || "N/A"}
                            </td>
                            <td className="p-3 text-muted-foreground">
                              {new Date(record.checked_out_at).toLocaleDateString()}
                            </td>
                            <td className="p-3 text-muted-foreground">
                              {record.returned_at
                                ? new Date(record.returned_at).toLocaleDateString()
                                : "—"}
                            </td>
                            <td className="p-3">
                              {isReturned ? (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] bg-muted text-muted-foreground"
                                >
                                  Returned
                                </Badge>
                              ) : (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold"
                                >
                                  Active
                                </Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Quick Equipment Barcode Test Bar for demo/convenience */}
          <Card className="p-4 rounded-xl border-dashed">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Quick Barcode Test Palette (Simulate Barcode Scanner)</span>
              <span className="text-[10px] normal-case">Click any equipment to test scan</span>
            </h4>
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
              {equipmentList.slice(0, 12).map((eq) => {
                const code = eq.serial_number || eq.name;
                const isCheckedOutToMember = memberData.activeCheckouts.some(
                  (c) => c.equipment_id === eq.id
                );
                return (
                  <button
                    key={eq.id}
                    onClick={() => void handleBarcodeScanned(code)}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all text-left flex items-center gap-1.5",
                      isCheckedOutToMember
                        ? "bg-blue-500/15 border-blue-500/40 text-blue-700 dark:text-blue-300"
                        : eq.status === "Available"
                        ? "bg-background hover:bg-emerald-500/10 hover:border-emerald-500/40"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Barcode className="h-3.5 w-3.5" />
                    <span>{eq.name}</span>
                    {isCheckedOutToMember && (
                      <span className="text-[9px] px-1 bg-blue-500 text-white rounded-full">
                        Checked Out
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* DIALOG 1: EQUIPMENT ALREADY CHECKED OUT PROMPT (WORKFLOW REQUIREMENT 4) */}
      <Dialog
        open={collisionPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setCollisionPrompt(null);
        }}
      >
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-2 border border-amber-500/30">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <DialogTitle className="text-lg font-bold">Equipment Already Checked Out</DialogTitle>
            <DialogDescription className="text-sm pt-1 text-foreground/80">
              <span className="font-semibold text-foreground">
                &ldquo;{collisionPrompt?.equipment.name}&rdquo;
              </span>{" "}
              is already checked out to{" "}
              <span className="font-semibold text-foreground">{memberData?.member.name}</span>.
              <br />
              <br />
              Would you like to <strong>return</strong> this equipment instead of checking it out?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // User says NO: ignore that scan
                setCollisionPrompt(null);
                setStatusMessage({
                  text: `Scan for "${collisionPrompt?.equipment.name}" ignored.`,
                  type: "info",
                });
                inputRef.current?.focus();
              }}
              className="rounded-xl"
            >
              No, Keep Checked Out
            </Button>

            <Button
              type="button"
              onClick={async () => {
                // User says YES: return the equipment
                if (collisionPrompt) {
                  const eq = collisionPrompt.equipment;
                  setCollisionPrompt(null);
                  await executeReturn(eq.id, eq.name);
                }
              }}
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-1.5"
            >
              <ArrowDownLeft className="h-4 w-4" />
              Yes, Return Equipment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: UNREGISTERED NFC CARD PAIRING */}
      <Dialog
        open={unregisteredCard !== null}
        onOpenChange={(open) => {
          if (!open) setUnregisteredCard(null);
        }}
      >
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2 border border-primary/20">
              <Nfc className="h-6 w-6" />
            </div>
            <DialogTitle className="text-lg font-bold">Unregistered NFC Card Scanned</DialogTitle>
            <DialogDescription className="text-sm pt-1">
              Card ID <code className="font-mono text-primary font-semibold">{unregisteredCard}</code>{" "}
              is not linked to any member yet. You can pair it right now:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <label className="text-xs font-semibold">Select Member to Assign this Card to:</label>
            <select
              value={selectedUserIdToPair ?? ""}
              onChange={(e) => setSelectedUserIdToPair(Number(e.target.value) || null)}
              className="w-full h-11 px-3 rounded-xl border bg-background text-sm font-medium focus:ring-2 focus:ring-primary"
            >
              <option value="">-- Choose Club Member --</option>
              {usersList.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.username ? `(@${u.username})` : `(${u.email})`}
                  {u.nfc_id ? ` [Current: ${u.nfc_id}]` : " [No card]"}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setUnregisteredCard(null)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selectedUserIdToPair || isProcessing}
              onClick={handlePairCard}
              className="rounded-xl font-semibold gap-1.5"
            >
              <UserCheck className="h-4 w-4" />
              Pair Card & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
