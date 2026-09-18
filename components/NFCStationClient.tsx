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
  Search,
  Radio,
  Sparkles,
  ArrowDownLeft,
  ArrowUpRight,
  Laptop,
  Trash2,
  X,
  ScanLine,
  PlusCircle,
  IdCard,
  Download,
  Maximize,
  Minimize,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/Logo";
import { MediaClubLogo } from "@/components/MediaClubLogo";
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
import type { Equipment, NFCCard, NFCMemberData, NFCCheckoutItem, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

// Web Audio API Synthesizer
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

      osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
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
      osc.frequency.setValueAtTime(659.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(523.25, ctx.currentTime + 0.25);
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
      osc.frequency.setValueAtTime(784, ctx.currentTime);
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
  initialCards: NFCCard[];
  currentRole: Role;
  currentUserName: string;
}

type StationMode = "awaiting_nfc" | "card_active";
type ScanPopupMode = "checkout" | "return" | null;

export function NFCStationClient({
  allEquipment: initialEquipment,
  initialCards,
}: NFCStationClientProps) {
  const [equipmentList, setEquipmentList] = useState<Equipment[]>(initialEquipment);
  const [cardsList, setCardsList] = useState<NFCCard[]>(initialCards);

  // Workflow states
  const [stationMode, setStationMode] = useState<StationMode>("awaiting_nfc");
  const [cardData, setCardData] = useState<NFCMemberData | null>(null);
  const [activeTab, setActiveTab] = useState<"current" | "history">("current");

  // Popup Scanning Page Mode ("checkout" or "return" or null)
  const [popupMode, setPopupMode] = useState<ScanPopupMode>(null);
  // Staged equipment items in the popup list (appear one by one)
  const [stagedItems, setStagedItems] = useState<Equipment[]>([]);

  // Inputs & Scanning
  const [nfcInput, setNfcInput] = useState("");
  const [popupBarcode, setPopupBarcode] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Status banners
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: "info" | "success" | "warning" | "error";
  } | null>(null);

  const [popupMessage, setPopupMessage] = useState<{
    text: string;
    type: "info" | "success" | "warning" | "error";
  } | null>(null);

  // Unregistered card registration dialog
  const [unregisteredCard, setUnregisteredCard] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState("");
  const [newCardNotes, setNewCardNotes] = useState("");

  // Manage cards dialog
  const [isManageCardsOpen, setIsManageCardsOpen] = useState(false);

  // Collision Confirmation Dialog
  const [collisionPrompt, setCollisionPrompt] = useState<{
    equipment: Equipment;
    checkoutItem?: NFCCheckoutItem;
  } | null>(null);

  // PWA & Kiosk desktop states
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const checkStandalone = () => {
      const isStandaloneMode =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes("android-app://");
      setIsStandalone(Boolean(isStandaloneMode));
    };
    checkStandalone();

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  async function handleInstallApp() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
      }
    } else {
      setShowInstallHelp(true);
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

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
  const cardDataRef = useRef(cardData);
  cardDataRef.current = cardData;
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

  // Fetch updated card data by NFC value
  const refreshCardData = useCallback(async (nfcValue: string) => {
    try {
      const res = await fetch(`/api/nfc?nfc_value=${encodeURIComponent(nfcValue)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.found) {
          setCardData({
            card: data.card,
            activeCheckouts: data.activeCheckouts || [],
            history: data.history || [],
          });
        }
      }
    } catch (err) {
      console.error("Failed to refresh NFC card data:", err);
    }
  }, []);

  // Refresh equipment list
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

  // Refresh registered NFC cards list
  const refreshCardsList = useCallback(async () => {
    try {
      const res = await fetch("/api/nfc/cards");
      if (res.ok) {
        const data = await res.json();
        setCardsList(data);
      }
    } catch (err) {
      console.error("Failed to refresh cards list:", err);
    }
  }, []);

  // 1. NFC CARD RECOGNITION HANDLER
  const handleNfcScanned = useCallback(
    async (rawCardValue: string) => {
      const val = rawCardValue.trim();
      if (!val) return;

      setIsProcessing(true);
      setStatusMessage({ text: `Recognizing NFC card: ${val}...`, type: "info" });
      playSound("scan");

      try {
        const res = await fetch(`/api/nfc?nfc_value=${encodeURIComponent(val)}`);
        const json = await res.json();

        if (json.found) {
          setCardData({
            card: json.card,
            activeCheckouts: json.activeCheckouts || [],
            history: json.history || [],
          });
          setStationMode("card_active");
          setNfcInput("");
          setStatusMessage({
            text: `Recognized NFC Card: ${json.card.member_name} (${json.card.nfc_value})`,
            type: "success",
          });
          playSound("success");
        } else {
          playSound("error");
          setUnregisteredCard(val);
          setNewMemberName("");
          setNewCardNotes("");
          setStatusMessage({
            text: `NFC Card "${val}" is not in database. Register it to proceed.`,
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

  // 3. BARCODE SCANNED INSIDE POPUP (Appears One-by-One)
  const handleBarcodeInPopup = useCallback(
    (rawBarcode: string) => {
      const code = rawBarcode.trim();
      if (!code || !cardDataRef.current) return;
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
          text: `"${foundEquipment.name}" is already in your current scan list.`,
          type: "warning",
        });
        return;
      }

      const isCheckedOutUnderThisCard = cardDataRef.current.activeCheckouts.some(
        (c) => c.equipment_id === foundEquipment.id
      );

      // CHECKOUT MODE
      if (popupModeRef.current === "checkout") {
        if (isCheckedOutUnderThisCard) {
          // PROMPT: "If the barcode is one of the equipments the person has already checked out,
          // prompt the user if he wants to return the equipment, not check it out.
          // If he says yes, return the equipment, if not just ignore that scan."
          playSound("warning");
          const activeItem = cardDataRef.current.activeCheckouts.find(
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
        if (!isCheckedOutUnderThisCard) {
          playSound("warning");
          setPopupMessage({
            text: `"${foundEquipment.name}" is not checked out under this NFC Card.`,
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
    if (!cardData || stagedItems.length === 0 || !popupMode) return;
    setIsProcessing(true);

    try {
      const equipmentIds = stagedItems.map((e) => e.id);

      if (popupMode === "checkout") {
        const res = await fetch("/api/nfc/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nfc_value: cardData.card.nfc_value,
            equipment_ids: equipmentIds,
          }),
        });

        const json = await res.json();
        if (res.ok) {
          playSound("success");
          setStatusMessage({
            text: `Successfully checked out ${stagedItems.length} item(s) to ${cardData.card.member_name}!`,
            type: "success",
          });
          closePopup();
          await refreshCardData(cardData.card.nfc_value);
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
            nfc_value: cardData.card.nfc_value,
            equipment_ids: equipmentIds,
          }),
        });

        const json = await res.json();
        if (res.ok) {
          playSound("return");
          setStatusMessage({
            text: `Successfully returned ${stagedItems.length} item(s) from ${cardData.card.member_name}!`,
            type: "success",
          });
          closePopup();
          await refreshCardData(cardData.card.nfc_value);
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

  // Register New NFC Card (Independent from User Accounts)
  async function handleRegisterCard() {
    if (!unregisteredCard || !newMemberName.trim()) return;
    setIsProcessing(true);

    try {
      const res = await fetch("/api/nfc/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nfc_value: unregisteredCard.trim(),
          member_name: newMemberName.trim(),
          notes: newCardNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok) {
        playSound("success");
        await refreshCardsList();
        const registeredVal = unregisteredCard.trim();
        setUnregisteredCard(null);
        setNewMemberName("");
        setNewCardNotes("");
        await handleNfcScanned(registeredVal);
      } else {
        playSound("error");
        setStatusMessage({ text: json.error || "Failed to register card.", type: "error" });
      }
    } catch {
      playSound("error");
      setStatusMessage({ text: "Error registering NFC card.", type: "error" });
    } finally {
      setIsProcessing(false);
    }
  }

  function handleSwitchCard() {
    playSound("scan");
    setCardData(null);
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
        <div className="flex items-center gap-3.5">
          <Logo size="xl" iconOnly={true} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">NFC Equipment Station</h1>
              <Badge variant="outline" className="hidden sm:inline-flex text-[11px] font-bold uppercase tracking-wider bg-primary/5 border-primary/30 text-primary">
                Media Club
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Official Media Club equipment checkout &amp; return workstation
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isStandalone ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleInstallApp}
              className="gap-1.5 text-xs font-semibold bg-primary/5 hover:bg-primary/10 border-primary/30 text-primary"
              title="Install as dedicated desktop app on this laptop"
            >
              <Download className="h-3.5 w-3.5" />
              Install App
            </Button>
          ) : (
            <Badge variant="outline" className="text-xs gap-1 border-primary/30 bg-primary/5 text-primary py-1 px-2.5">
              <Laptop className="h-3.5 w-3.5" />
              Kiosk App
            </Badge>
          )}

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen Kiosk"}
            className="text-muted-foreground hover:text-foreground"
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsManageCardsOpen(true)}
            className="gap-1.5 text-xs font-semibold"
          >
            <IdCard className="h-3.5 w-3.5" />
            Club NFC Cards ({cardsList.length})
          </Button>

          {stationMode === "card_active" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSwitchCard}
              className="gap-2 border-primary/30 hover:bg-primary/10"
            >
              <RotateCcw className="h-4 w-4" />
              Finish / Switch Card
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
            {stationMode === "awaiting_nfc" ? "Waiting for NFC Tap" : "NFC Card Active"}
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

            <div className="mb-4 bg-black px-5 py-3.5 rounded-2xl border border-white/15 shadow-md flex items-center justify-center">
              <MediaClubLogo className="h-14 sm:h-16 w-auto" variant="white" />
            </div>

            <div className="relative mb-5">
              <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center shadow-lg animate-pulse">
                <Nfc className="h-10 w-10 text-primary" />
              </div>
              <div className="absolute -inset-2 rounded-full border border-primary/20 animate-ping pointer-events-none" />
            </div>

            <h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-1">
              Scan Member NFC Card
            </h2>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary/80 mb-2 block">
              Media Club Station
            </span>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Hold or tap the member&apos;s physical NFC card on the USB scanner connected to this
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
                placeholder="Or type NFC Card Value manually..."
                disabled={isProcessing}
                className="h-11 rounded-xl text-sm font-mono"
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
                <span>Club NFC Cards ({cardsList.length})</span>
                <Badge variant="outline" className="text-[10px]">
                  Simulator
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                Click a card below to simulate scanner tap:
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto max-h-80 space-y-2 pr-2">
              {cardsList.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  No NFC cards registered yet. Tap &quot;+ Register New Card&quot; to add one.
                </div>
              ) : (
                cardsList.map((card) => (
                  <button
                    key={card.id}
                    onClick={() => void handleNfcScanned(card.nfc_value)}
                    className="w-full text-left p-2.5 rounded-xl border bg-background/50 hover:bg-accent hover:border-primary/40 transition-all flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate group-hover:text-primary">
                        {card.member_name}
                      </p>
                      {card.notes && (
                        <p className="text-[10px] text-muted-foreground truncate">{card.notes}</p>
                      )}
                    </div>

                    <Badge
                      variant="secondary"
                      className="text-[10px] font-mono shrink-0 bg-primary/10 text-primary border-primary/20"
                    >
                      {card.nfc_value}
                    </Badge>
                  </button>
                ))
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUnregisteredCard(`NFC-CARD-${String(cardsList.length + 1).padStart(3, "0")}`);
                  setNewMemberName("");
                  setNewCardNotes("");
                }}
                className="w-full text-xs font-semibold gap-1.5 mt-2"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Register New Card
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* STATE 2: NFC CARD ACTIVE DASHBOARD */}
      {stationMode === "card_active" && cardData && (
        <div className="space-y-6">
          {/* Card Header with TWO BIG ACTION BUTTONS */}
          <Card className="rounded-2xl border-primary/30 bg-gradient-to-r from-primary/10 via-background to-primary/5 p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              {/* Card Profile */}
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl border border-primary/40 flex items-center justify-center shadow-xs overflow-hidden bg-[#0b0f19]">
                  <Logo size="lg" iconOnly={true} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">{cardData.card.member_name}</h2>
                    <Badge variant="outline" className="text-xs font-semibold text-primary border-primary/30 bg-primary/5">
                      Media Club
                    </Badge>
                    <Badge variant="outline" className="font-mono text-xs text-muted-foreground border-border">
                      {cardData.card.nfc_value}
                    </Badge>
                  </div>
                  {cardData.card.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5">{cardData.card.notes}</p>
                  )}
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Card Registered: {new Date(cardData.card.created_at).toLocaleDateString()}
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
                {cardData.activeCheckouts.length}
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
                {cardData.history.length}
              </Badge>
            </button>
          </div>

          {/* TAB 1: CURRENTLY CHECKED OUT */}
          {activeTab === "current" && (
            <div>
              {cardData.activeCheckouts.length === 0 ? (
                <Card className="border-dashed p-10 text-center rounded-2xl">
                  <Package className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                  <h3 className="font-semibold text-base mb-1">No equipment currently checked out</h3>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
                    This NFC card has no active equipment checkouts. Tap &quot;Checkout Equipments&quot; above
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
                  {cardData.activeCheckouts.map((item) => (
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
                    {cardData.history.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-muted-foreground">
                          No past checkout records for this NFC card.
                        </td>
                      </tr>
                    ) : (
                      cardData.history.map((record) => {
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
      {popupMode !== null && cardData && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col justify-between p-4 sm:p-8 animate-in fade-in duration-200">
          {/* Top Bar inside popup */}
          <div className="flex items-center justify-between border-b border-border/40 pb-4">
            <div className="flex items-center gap-3.5">
              <Logo size="lg" iconOnly={true} />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                    {popupMode === "checkout" ? "Equipment Checkout Session" : "Equipment Return Session"}
                  </h2>
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px] font-bold uppercase tracking-wider border-primary/40 text-primary bg-primary/10">
                    Media Club
                  </Badge>
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
                  Card: <strong className="text-white">{cardData.card.member_name}</strong> (
                  <span className="font-mono">{cardData.card.nfc_value}</span>)
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
                    placeholder="Scan equipment barcode with connected scanner..."
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
              is already checked out under this NFC Card (
              <span className="font-semibold text-foreground">{cardData?.card.member_name}</span>).
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
                if (collisionPrompt && cardData) {
                  const eq = collisionPrompt.equipment;
                  setCollisionPrompt(null);
                  try {
                    const res = await fetch("/api/nfc/return", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        equipment_id: eq.id,
                        nfc_value: cardData.card.nfc_value,
                      }),
                    });
                    if (res.ok) {
                      playSound("return");
                      setPopupMessage({
                        text: `Successfully returned "${eq.name}"!`,
                        type: "success",
                      });
                      await refreshCardData(cardData.card.nfc_value);
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

      {/* DIALOG 2: REGISTER UNREGISTERED NFC CARD (SEPARATE FROM USERS) */}
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
            <DialogTitle className="text-lg font-bold">Register New NFC Card</DialogTitle>
            <DialogDescription className="text-sm pt-1">
              Card UID <code className="font-mono text-primary font-semibold">{unregisteredCard}</code>{" "}
              is not in the database yet. Enter the member details to register this card:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-semibold block mb-1">Member Name / Label *</label>
              <Input
                type="text"
                placeholder="e.g. John Doe or Crew Card #04"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>

            <div>
              <label className="text-xs font-semibold block mb-1">Notes (Optional)</label>
              <Input
                type="text"
                placeholder="e.g. Video Team, Student ID 12345"
                value={newCardNotes}
                onChange={(e) => setNewCardNotes(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
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
              disabled={!newMemberName.trim() || isProcessing}
              onClick={handleRegisterCard}
              className="rounded-xl font-semibold gap-1.5"
            >
              <PlusCircle className="h-4 w-4" />
              Save Card & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 3: MANAGE ALL CLUB NFC CARDS */}
      <Dialog open={isManageCardsOpen} onOpenChange={setIsManageCardsOpen}>
        <DialogContent className="sm:max-w-xl rounded-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <IdCard className="h-5 w-5 text-primary" />
              Registered Club NFC Cards
            </DialogTitle>
            <DialogDescription className="text-xs">
              List of all physical NFC cards registered in the database for equipment checkouts.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-2 py-2 pr-1">
            {cardsList.length === 0 ? (
              <p className="text-center py-6 text-xs text-muted-foreground">No cards registered yet.</p>
            ) : (
              cardsList.map((c) => (
                <div
                  key={c.id}
                  className="p-3 rounded-xl border bg-background/50 flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-bold text-foreground">{c.member_name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{c.nfc_value}</div>
                    {c.notes && <div className="text-[10px] text-muted-foreground">{c.notes}</div>}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsManageCardsOpen(false);
                      void handleNfcScanned(c.nfc_value);
                    }}
                    className="text-xs font-medium"
                  >
                    Select Card
                  </Button>
                </div>
              ))
            )}
          </div>

          <DialogFooter className="pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsManageCardsOpen(false)}
              className="rounded-xl"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PWA Install Instructions Dialog */}
      <Dialog open={showInstallHelp} onOpenChange={setShowInstallHelp}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary mb-1">
              <Laptop className="h-5 w-5" />
              <DialogTitle>Install NFC Station App</DialogTitle>
            </div>
            <DialogDescription>
              Run MediaHub NFC Station in its own dedicated, borderless desktop window on this laptop.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs text-muted-foreground">
            <div className="p-3.5 rounded-xl border bg-muted/40 space-y-2">
              <p className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                <Download className="h-4 w-4 text-primary" />
                How to install in Edge or Chrome:
              </p>
              <ol className="list-decimal pl-4 space-y-1.5 text-xs">
                <li>
                  Look at the right side of the <strong>address bar</strong> at the top of your browser.
                </li>
                <li>
                  Click the <strong>Install App</strong> icon (looks like a computer screen 🖥️ or ➕).
                </li>
                <li>
                  Or click the browser menu (<strong>...</strong> or <strong>⋮</strong>) &rarr;{" "}
                  <strong>Apps</strong> &rarr; <strong>Install MediaHub NFC Station</strong>.
                </li>
                <li>Click <strong>Install</strong> to confirm.</li>
              </ol>
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-emerald-700 dark:text-emerald-400 space-y-1">
              <p className="font-semibold text-xs flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Dedicated Kiosk App:
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Once installed, a dedicated shortcut appears on your Windows Desktop and Taskbar. When clicked, it launches directly into this NFC Station with no browser URL bar or tabs, perfectly configured for USB card readers and barcode scanners.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setShowInstallHelp(false)}>Got It</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
