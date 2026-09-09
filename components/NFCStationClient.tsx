"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Nfc,
  Barcode,
  RotateCcw,
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
  Laptop,
  Trash2,
  X,
  ScanLine,
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
type ScanPopupMode = "checkout" | "return" | null;

export function NFCStationClient({
  allEquipment: initialEquipment,
  allUsers: initialUsers,
}: NFCStationClientProps) {
  const [equipmentList, setEquipmentList] = useState<Equipment[]>(initialEquipment);
  const [usersList, setUsersList] = useState<User[]>(initialUsers);

  // Workflow states
  const [stationMode, setStationMode] = useState<StationMode>("awaiting_nfc");
  const [memberData, setMemberData] = useState<NFCMemberData | null>(null);
  const [activeTab, setActiveTab] = useState<"current" | "history">("current");

  // Popup Scanning Page Mode ("checkout" or "return" or null)
  const [popupMode, setPopupMode] = useState<ScanPopupMode>(null);
  // Staged equipment items in the popup list (appear one by one)
  const [stagedItems, setStagedItems] = useState<Equipment[]>([]);

  // Inputs & Scanning
  const [nfcInput, setNfcInput] = useState("");
  const [popupBarcode, setPopupBarcode] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Main status banner
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: "info" | "success" | "warning" | "error";
  } | null>(null);

  // Popup internal status banner
  const [popupMessage, setPopupMessage] = useState<{
    text: string;
    type: "info" | "success" | "warning" | "error";
  } | null>(null);

  // Unregistered card pairing dialog
  const [unregisteredCard, setUnregisteredCard] = useState<string | null>(null);
  const [selectedUserIdToPair, setSelectedUserIdToPair] = useState<number | null>(null);

  // Collision Confirmation Dialog
  const [collisionPrompt, setCollisionPrompt] = useState<{
    equipment: Equipment;
    checkoutItem?: NFCCheckoutItem;
  } | null>(null);

  const nfcInputRef = useRef<HTMLInputElement | null>(null);
  const popupInputRef = useRef<HTMLInputElement | null>(null);

  // Auto focus appropriate input
  useEffect(() => {
    if (popupMode !== null) {
      popupInputRef.current?.focus();
    } else if (stationMode === "awaiting_nfc") {
      nfcInputRef.current?.focus();
    }
  }, [popupMode, stationMode, collisionPrompt, unregisteredCard]);

  // Keep references for event listener
  const memberDataRef = useRef(memberData);
  memberDataRef.current = memberData;
  const equipmentListRef = useRef(equipmentList);
  equipmentListRef.current = equipmentList;
  const popupModeRef = useRef(popupMode);
  popupModeRef.current = popupMode;
  const stagedItemsRef = useRef(stagedItems);
  stagedItemsRef.current = stagedItems;
  const stationModeRef = useRef(stationMode);
  stationModeRef.current = stationMode;
  const collisionPromptRef = useRef(collisionPrompt);
  collisionPromptRef.current = collisionPrompt;
  const unregisteredCardRef = useRef(unregisteredCard);
  unregisteredCardRef.current = unregisteredCard;

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
          setNfcInput("");
          setStatusMessage({
            text: `Welcome, ${json.member.name || json.member.username}!`,
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
      } catch {
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

  // 2. OPEN SCANNING POPUP PAGE
  function openPopup(mode: "checkout" | "return") {
    setPopupMode(mode);
    setStagedItems([]);
    setPopupBarcode("");
    setPopupMessage(null);
    playSound("scan");
  }

  function closePopup() {
    setPopupMode(null);
    setStagedItems([]);
    setPopupBarcode("");
    setPopupMessage(null);
  }

  // 3. BARCODE SCANNED INSIDE POPUP
  const handleBarcodeInPopup = useCallback(
    (rawBarcode: string) => {
      const code = rawBarcode.trim();
      if (!code || !memberDataRef.current) return;
      setPopupBarcode("");

      const foundEquipment = findEquipment(code);
      if (!foundEquipment) {
        playSound("error");
        setPopupMessage({
          text: `Equipment not found for barcode: "${code}".`,
          type: "error",
        });
        return;
      }

      // Check if already in staged list
      const isAlreadyStaged = stagedItemsRef.current.some((e) => e.id === foundEquipment.id);
      if (isAlreadyStaged) {
        playSound("warning");
        setPopupMessage({
          text: `"${foundEquipment.name}" is already in your scanned list.`,
          type: "warning",
        });
        return;
      }

      const isCheckedOutByMember = memberDataRef.current.activeCheckouts.some(
        (c) => c.equipment_id === foundEquipment.id
      );

      // CHECKOUT MODE
      if (popupModeRef.current === "checkout") {
        if (isCheckedOutByMember) {
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

        if (foundEquipment.status !== "Available") {
          playSound("error");
          setPopupMessage({
            text: `"${foundEquipment.name}" cannot be checked out (Status: ${foundEquipment.status}).`,
            type: "error",
          });
          return;
        }

        // Add to staged list (appears one by one)
        playSound("scan");
        setStagedItems((prev) => [...prev, foundEquipment]);
        setPopupMessage({
          text: `Added "${foundEquipment.name}" to checkout list.`,
          type: "success",
        });
        return;
      }

      // RETURN MODE
      if (popupModeRef.current === "return") {
        if (!isCheckedOutByMember) {
          playSound("warning");
          setPopupMessage({
            text: `"${foundEquipment.name}" is not currently checked out by ${
              memberDataRef.current.member.name || "this member"
            }.`,
            type: "warning",
          });
          return;
        }

        // Add to staged list for return
        playSound("scan");
        setStagedItems((prev) => [...prev, foundEquipment]);
        setPopupMessage({
          text: `Added "${foundEquipment.name}" to return list.`,
          type: "success",
        });
      }
    },
    [findEquipment]
  );

  // 4. CONFIRM / FINISH STAGED ITEMS (BATCH SUBMIT)
  async function handleFinishBatch() {
    if (!memberData || stagedItems.length === 0 || !popupMode) return;
    setIsProcessing(true);

    try {
      const equipmentIds = stagedItems.map((e) => e.id);

      if (popupMode === "checkout") {
        const res = await fetch("/api/nfc/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nfc_id: memberData.member.nfc_id,
            equipment_ids: equipmentIds,
          }),
        });

        const json = await res.json();
        if (res.ok) {
          playSound("success");
          setStatusMessage({
            text: `Successfully checked out ${stagedItems.length} item(s) to ${
              memberData.member.name || "member"
            }!`,
            type: "success",
          });
          closePopup();
          if (memberData.member.nfc_id) {
            await refreshMemberData(memberData.member.nfc_id);
          }
          await refreshEquipmentList();
        } else {
          playSound("error");
          setPopupMessage({ text: json.error || "Batch checkout failed.", type: "error" });
        }
      } else if (popupMode === "return") {
        const res = await fetch("/api/nfc/return", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nfc_id: memberData.member.nfc_id,
            equipment_ids: equipmentIds,
          }),
        });

        const json = await res.json();
        if (res.ok) {
          playSound("return");
          setStatusMessage({
            text: `Successfully returned ${stagedItems.length} item(s) from ${
              memberData.member.name || "member"
            }!`,
            type: "success",
          });
          closePopup();
          if (memberData.member.nfc_id) {
            await refreshMemberData(memberData.member.nfc_id);
          }
          await refreshEquipmentList();
        } else {
          playSound("error");
          setPopupMessage({ text: json.error || "Batch return failed.", type: "error" });
        }
      }
    } catch {
      playSound("error");
      setPopupMessage({ text: "Network error processing batch.", type: "error" });
    } finally {
      setIsProcessing(false);
    }
  }

  // 5. GLOBAL KEYSTROKE SCANNER LISTENER (USB/Bluetooth HID)
  useEffect(() => {
    let buffer = "";
    let lastKeyTime = Date.now();

    function onKeyDown(e: KeyboardEvent) {
      // Don't intercept if pairing modal or collision dialog is active
      if (unregisteredCardRef.current !== null || collisionPromptRef.current !== null) return;

      const now = Date.now();
      if (now - lastKeyTime > 100) {
        buffer = "";
      }
      lastKeyTime = now;

      if (e.key === "Enter") {
        if (buffer.length >= 2) {
          e.preventDefault();
          const scanned = buffer.trim();
          buffer = "";

          if (popupModeRef.current !== null) {
            handleBarcodeInPopup(scanned);
          } else if (stationModeRef.current === "awaiting_nfc") {
            void handleNfcScanned(scanned);
          }
        }
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleBarcodeInPopup, handleNfcScanned]);

  // Pair card handler
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
        setUsersList((prev) =>
          prev.map((u) => (u.id === selectedUserIdToPair ? { ...u, nfc_id: unregisteredCard } : u))
        );
        const cardToLoad = unregisteredCard;
        setUnregisteredCard(null);
        setSelectedUserIdToPair(null);
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

  function handleSwitchMember() {
    playSound("scan");
    setMemberData(null);
    setStationMode("awaiting_nfc");
    setStatusMessage(null);
    setNfcInput("");
    setPopupMode(null);
    setStagedItems([]);
  }

  function removeItemFromStaged(id: number) {
    playSound("scan");
    setStagedItems((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto w-full pb-12">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
            <Nfc className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">NFC Equipment Station</h1>
            <p className="text-xs text-muted-foreground">
              Scan member NFC card, then start a checkout or return session with barcode scanner
            </p>
          </div>
        </div>

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

      {/* Live Feedback Banner */}
      {statusMessage && (
        <div
          className={cn(
            "px-4 py-3 rounded-xl text-xs md:text-sm font-medium flex items-center gap-2 transition-all shadow-xs",
            statusMessage.type === "success" &&
              "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30",
            statusMessage.type === "warning" &&
              "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30",
            statusMessage.type === "error" &&
              "bg-destructive/15 text-destructive border border-destructive/30",
            statusMessage.type === "info" && "bg-primary/15 text-primary border border-primary/30"
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

      {/* STATE 1: AWAITING NFC CARD SCAN */}
      {stationMode === "awaiting_nfc" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Hero Card */}
          <Card className="md:col-span-2 border-dashed border-2 border-primary/30 bg-gradient-to-br from-card/80 via-card/40 to-primary/5 rounded-2xl flex flex-col items-center justify-center p-8 sm:p-12 text-center relative overflow-hidden">
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
              Hold or tap the member&apos;s physical NFC card on the USB reader connected to this
              laptop.
            </p>

            {/* Input field for manual or USB typing */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleNfcScanned(nfcInput);
              }}
              className="flex gap-2 w-full max-w-sm"
            >
              <Input
                ref={nfcInputRef}
                type="text"
                value={nfcInput}
                onChange={(e) => setNfcInput(e.target.value)}
                placeholder="Or enter NFC Card ID manually..."
                disabled={isProcessing}
                className="h-11 rounded-xl text-sm"
              />
              <Button
                type="submit"
                disabled={isProcessing || !nfcInput.trim()}
                className="h-11 rounded-xl px-4 font-semibold"
              >
                Scan
              </Button>
            </form>

            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground mt-6">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/60 border">
                <Laptop className="h-3.5 w-3.5 text-primary" /> USB NFC Scanner Active
              </span>
            </div>
          </Card>

          {/* Quick Tap Simulator */}
          <Card className="rounded-2xl flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Club Members ({usersList.length})</span>
                <Badge variant="outline" className="text-[10px]">
                  Simulator
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Click a member to simulate their NFC card tap:
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto max-h-80 space-y-2 pr-2">
              {usersList.map((user) => {
                const hasNfc = Boolean(user.nfc_id);
                return (
                  <button
                    key={user.id}
                    onClick={() => {
                      if (user.nfc_id) {
                        void handleNfcScanned(user.nfc_id);
                      } else {
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

      {/* STATE 2: MEMBER ACTIVE DASHBOARD */}
      {stationMode === "member_active" && memberData && (
        <div className="space-y-6">
          {/* Member Card Header with the TWO BIG ACTION BUTTONS */}
          <Card className="rounded-2xl border-primary/30 bg-gradient-to-r from-primary/10 via-background to-primary/5 p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              {/* Member Profile */}
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center font-bold text-xl text-primary shadow-xs">
                  {memberData.member.name?.slice(0, 2).toUpperCase() || "MB"}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">{memberData.member.name}</h2>
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
                      Card UID: {memberData.member.nfc_id || "Registered"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* USER ACTION BUTTONS: CLICK TO OPEN POPUP SCANNING PAGE */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={() => openPopup("return")}
                  size="lg"
                  className="rounded-xl h-14 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold gap-2.5 shadow-md hover:shadow-lg transition-all"
                >
                  <ArrowDownLeft className="h-5 w-5" />
                  <div className="text-left">
                    <div className="text-sm">Return Equipments</div>
                    <div className="text-[10px] font-normal opacity-90">Open Return Scanner</div>
                  </div>
                </Button>

                <Button
                  onClick={() => openPopup("checkout")}
                  size="lg"
                  className="rounded-xl h-14 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2.5 shadow-md hover:shadow-lg transition-all"
                >
                  <ArrowUpRight className="h-5 w-5" />
                  <div className="text-left">
                    <div className="text-sm">Checkout Equipments</div>
                    <div className="text-[10px] font-normal opacity-90">Open Checkout Scanner</div>
                  </div>
                </Button>
              </div>
            </div>
          </Card>

          {/* Sub Navigation Tabs */}
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab("current")}
              className={cn(
                "px-5 py-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2",
                activeTab === "current"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Package className="h-4 w-4" />
              Currently Checked Out
              <Badge variant="secondary" className="ml-1 text-xs px-2 py-0.5">
                {memberData.activeCheckouts.length}
              </Badge>
            </button>

            <button
              onClick={() => setActiveTab("history")}
              className={cn(
                "px-5 py-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2",
                activeTab === "history"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Clock className="h-4 w-4" />
              Checkout History
              <Badge variant="outline" className="ml-1 text-xs px-2 py-0.5">
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
                    This member has no active equipment checkouts. Tap &quot;Checkout Equipments&quot; above
                    to start scanning items to borrow.
                  </p>
                  <Button
                    onClick={() => openPopup("checkout")}
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs font-semibold"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    Open Checkout Scanner
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
        </div>
      )}

      {/* POPUP / BLACK PAGE SCANNING OVERLAY */}
      {popupMode !== null && memberData && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col justify-between p-4 sm:p-8 animate-in fade-in duration-200">
          {/* Top Bar inside popup */}
          <div className="flex items-center justify-between border-b border-border/40 pb-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "p-3 rounded-2xl border shadow-md",
                  popupMode === "checkout"
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                )}
              >
                <Barcode className="h-6 w-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                    {popupMode === "checkout" ? "Equipment Checkout Session" : "Equipment Return Session"}
                  </h2>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs uppercase font-bold",
                      popupMode === "checkout"
                        ? "border-emerald-500/50 text-emerald-400"
                        : "border-blue-500/50 text-blue-400"
                    )}
                  >
                    {stagedItems.length} Scanned
                  </Badge>
                </div>
                <p className="text-xs text-neutral-400">
                  Member: <strong className="text-white">{memberData.member.name}</strong>{" "}
                  {memberData.member.username ? `(@${memberData.member.username})` : ""}
                </p>
              </div>
            </div>

            {/* Cancel Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={closePopup}
              className="h-10 w-10 text-neutral-400 hover:text-white rounded-xl hover:bg-neutral-800"
            >
              <X className="h-6 w-6" />
            </Button>
          </div>

          {/* Center Content: Scanner Bar & One-by-One Staged Equipment List */}
          <div className="flex-1 my-6 flex flex-col max-w-4xl w-full mx-auto overflow-hidden">
            {/* Scanner Input Bar */}
            <div className="mb-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleBarcodeInPopup(popupBarcode);
                }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <ScanLine
                    className={cn(
                      "absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 animate-pulse",
                      popupMode === "checkout" ? "text-emerald-400" : "text-blue-400"
                    )}
                  />
                  <Input
                    ref={popupInputRef}
                    type="text"
                    value={popupBarcode}
                    onChange={(e) => setPopupBarcode(e.target.value)}
                    placeholder="Scan equipment barcode now with scanner or type barcode..."
                    className="pl-12 h-14 text-base font-semibold bg-neutral-900/90 text-white rounded-2xl border-neutral-700 focus-visible:ring-2 focus-visible:ring-primary shadow-inner"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!popupBarcode.trim()}
                  className="h-14 px-6 rounded-2xl font-bold"
                >
                  Add Item
                </Button>
              </form>

              {/* Popup Alert Banner */}
              {popupMessage && (
                <div
                  className={cn(
                    "mt-3 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2",
                    popupMessage.type === "success" &&
                      "bg-emerald-950/60 text-emerald-300 border border-emerald-500/40",
                    popupMessage.type === "warning" &&
                      "bg-amber-950/60 text-amber-300 border border-amber-500/40",
                    popupMessage.type === "error" &&
                      "bg-rose-950/60 text-rose-300 border border-rose-500/40",
                    popupMessage.type === "info" &&
                      "bg-neutral-800 text-neutral-200 border border-neutral-700"
                  )}
                >
                  {popupMessage.type === "success" && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                  {popupMessage.type === "warning" && <AlertTriangle className="h-4 w-4 shrink-0" />}
                  {popupMessage.type === "error" && <XCircle className="h-4 w-4 shrink-0" />}
                  <span className="flex-1">{popupMessage.text}</span>
                  <button
                    onClick={() => setPopupMessage(null)}
                    className="opacity-70 hover:opacity-100 text-current"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* List of scanned equipments appearing one by one */}
            <div className="flex-1 overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 space-y-3 shadow-inner">
              {stagedItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-500">
                  <Barcode className="h-16 w-16 mb-3 opacity-30 animate-pulse" />
                  <p className="font-semibold text-neutral-300 text-base">No equipment scanned yet</p>
                  <p className="text-xs text-neutral-500 max-w-sm mt-1">
                    Scan equipment barcodes one by one. Each item will appear here in your session.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400 px-1 flex items-center justify-between">
                    <span>Scanned Equipment ({stagedItems.length})</span>
                    <span className="text-[10px] text-neutral-500">Appearing in order of scan</span>
                  </div>

                  {stagedItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className="p-4 rounded-xl bg-neutral-900/90 border border-neutral-800 hover:border-neutral-700 flex items-center justify-between gap-4 transition-all animate-in slide-in-from-top-2 duration-150"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-neutral-800 text-neutral-300 font-bold text-xs flex items-center justify-center shrink-0">
                          #{idx + 1}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm text-white truncate">{item.name}</h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-xs text-neutral-400">
                              {item.serial_number || "NO-BARCODE"}
                            </span>
                            <span className="text-neutral-600">•</span>
                            <span className="text-xs text-neutral-400">📍 {item.location}</span>
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItemFromStaged(item.id)}
                        className="h-8 w-8 text-neutral-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg shrink-0"
                        title="Remove from this session"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Test Barcode Simulator Bar */}
            <div className="mt-3 pt-2">
              <div className="text-[11px] text-neutral-400 mb-1.5 flex items-center justify-between">
                <span>Quick Test Barcode Simulator:</span>
                <span className="text-[10px] text-neutral-500">Click to simulate scanner</span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                {equipmentList.slice(0, 10).map((eq) => {
                  const code = eq.serial_number || eq.name;
                  return (
                    <button
                      key={eq.id}
                      onClick={() => handleBarcodeInPopup(code)}
                      className="px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-600 text-[11px] text-neutral-300 font-medium transition-all"
                    >
                      {eq.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Bottom Bar inside popup: Cancel or OK / Finish */}
          <div className="border-t border-neutral-800 pt-4 flex flex-col sm:flex-row items-center justify-between gap-3 max-w-4xl w-full mx-auto">
            <Button
              variant="outline"
              onClick={closePopup}
              disabled={isProcessing}
              className="w-full sm:w-auto h-12 px-6 rounded-xl border-neutral-700 text-neutral-300 hover:bg-neutral-800 font-semibold"
            >
              Cancel
            </Button>

            <Button
              onClick={handleFinishBatch}
              disabled={stagedItems.length === 0 || isProcessing}
              className={cn(
                "w-full sm:w-auto h-12 px-8 rounded-xl font-bold text-white shadow-lg transition-all text-sm sm:text-base",
                popupMode === "checkout"
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : "bg-blue-600 hover:bg-blue-500"
              )}
            >
              {isProcessing
                ? "Processing..."
                : popupMode === "checkout"
                ? `OK / Finish Checkout (${stagedItems.length} items)`
                : `OK / Finish Return (${stagedItems.length} items)`}
            </Button>
          </div>
        </div>
      )}

      {/* DIALOG 1: ALREADY CHECKED OUT COLLISION PROMPT */}
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
                // Ignore that scan
                setCollisionPrompt(null);
                setPopupMessage({
                  text: `Scan for "${collisionPrompt?.equipment.name}" ignored.`,
                  type: "info",
                });
                popupInputRef.current?.focus();
              }}
              className="rounded-xl"
            >
              No, Keep Checked Out
            </Button>

            <Button
              type="button"
              onClick={async () => {
                // Return the equipment
                if (collisionPrompt && memberData) {
                  const eq = collisionPrompt.equipment;
                  setCollisionPrompt(null);
                  try {
                    const res = await fetch("/api/nfc/return", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        equipment_id: eq.id,
                        nfc_id: memberData.member.nfc_id,
                      }),
                    });
                    if (res.ok) {
                      playSound("return");
                      setPopupMessage({
                        text: `Successfully returned "${eq.name}"!`,
                        type: "success",
                      });
                      if (memberData.member.nfc_id) {
                        await refreshMemberData(memberData.member.nfc_id);
                      }
                      await refreshEquipmentList();
                    }
                  } catch {
                    playSound("error");
                  }
                  popupInputRef.current?.focus();
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
