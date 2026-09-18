import type { Equipment, NFCCard, NFCMemberData, NFCCheckoutItem } from "@/lib/types";

export type QueuedActionType = "checkout" | "return" | "register_card";

export interface QueuedAction {
  id: string;
  type: QueuedActionType;
  endpoint: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body: Record<string, any>;
  timestamp: number;
  description: string;
  retryCount: number;
  status: "pending" | "syncing" | "failed";
  error?: string;
}

export interface EnqueueParams {
  type: QueuedActionType;
  endpoint?: string;
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  payload?: Record<string, any>;
  body?: Record<string, any>;
  description: string;
}

const STORAGE_KEYS = {
  QUEUE: "mediahub_offline_queue_v1",
  EQUIPMENT: "mediahub_offline_equipment_v1",
  CARDS: "mediahub_offline_cards_v1",
  MEMBERS: "mediahub_offline_members_v1",
  LAST_SYNC: "mediahub_offline_last_sync_v1",
};

// Safe localStorage access
function safeGetItem(key: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    console.warn(`[offlineSync] Failed to read ${key}:`, err);
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`[offlineSync] Failed to write ${key}:`, err);
  }
}

function emitEvent(name: string, detail?: any) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

// ---------------------------------------------------------------------------
// 1. QUEUE MANAGEMENT
// ---------------------------------------------------------------------------

export function getOfflineQueue(): QueuedAction[] {
  const raw = safeGetItem(STORAGE_KEYS.QUEUE);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedAction[];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(queue: QueuedAction[]): void {
  safeSetItem(STORAGE_KEYS.QUEUE, JSON.stringify(queue));
  emitEvent("mediahub-offline-queue-changed", { count: queue.length });
}

export function enqueueOfflineAction(params: EnqueueParams): QueuedAction {
  const queue = getOfflineQueue();

  let endpoint = params.endpoint;
  const method: "POST" | "PUT" | "PATCH" | "DELETE" = params.method || "POST";
  const body = params.payload || params.body || {};

  if (!endpoint) {
    if (params.type === "checkout") endpoint = "/api/nfc/checkout";
    else if (params.type === "return") endpoint = "/api/nfc/return";
    else if (params.type === "register_card") endpoint = "/api/nfc/card";
    else endpoint = "/api/nfc";
  }

  const newAction: QueuedAction = {
    id: `offline-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    type: params.type,
    endpoint,
    method,
    body,
    timestamp: Date.now(),
    description: params.description,
    retryCount: 0,
    status: "pending",
  };
  queue.push(newAction);
  saveOfflineQueue(queue);
  return newAction;
}

export function removeQueuedAction(id: string): void {
  const queue = getOfflineQueue();
  const filtered = queue.filter((item) => item.id !== id);
  saveOfflineQueue(filtered);
}

export function clearOfflineQueue(): void {
  saveOfflineQueue([]);
}

// ---------------------------------------------------------------------------
// 2. OFFLINE CACHE MANAGEMENT
// ---------------------------------------------------------------------------

export function getCachedEquipment(): Equipment[] {
  const raw = safeGetItem(STORAGE_KEYS.EQUIPMENT);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Equipment[];
  } catch {
    return [];
  }
}

export function setCachedEquipment(equipment: Equipment[]): void {
  safeSetItem(STORAGE_KEYS.EQUIPMENT, JSON.stringify(equipment));
}

export function getCachedCards(): NFCCard[] {
  const raw = safeGetItem(STORAGE_KEYS.CARDS);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as NFCCard[];
  } catch {
    return [];
  }
}

export function setCachedCards(cards: NFCCard[]): void {
  safeSetItem(STORAGE_KEYS.CARDS, JSON.stringify(cards));
}

export function getAllCachedMembers(): Record<string, NFCMemberData> {
  const raw = safeGetItem(STORAGE_KEYS.MEMBERS);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, NFCMemberData>;
  } catch {
    return {};
  }
}

export function getCachedMemberData(nfcValue: string): NFCMemberData | null {
  const all = getAllCachedMembers();
  return all[nfcValue] || null;
}

export function setCachedMemberData(nfcValue: string, data: NFCMemberData): void {
  const all = getAllCachedMembers();
  all[nfcValue] = data;
  safeSetItem(STORAGE_KEYS.MEMBERS, JSON.stringify(all));
}

// ---------------------------------------------------------------------------
// 3. OPTIMISTIC UPDATES FOR OFFLINE ACTIONS
// ---------------------------------------------------------------------------

export function applyOptimisticCheckout(
  currentEquipment: Equipment[],
  currentCardData: NFCMemberData,
  equipmentIds: number[]
): { updatedEquipment: Equipment[]; updatedCardData: NFCMemberData } {
  const nfcValue = currentCardData.card.nfc_value;
  const now = new Date().toISOString();

  const checkedOutEquipments: Equipment[] = [];
  const updatedEquipment: Equipment[] = currentEquipment.map((eq) => {
    if (equipmentIds.includes(eq.id)) {
      const updated: Equipment = {
        ...eq,
        status: "Checked Out",
        active_checkout_id: Date.now() + Math.floor(Math.random() * 1000),
        checked_out_by_name: currentCardData.card.member_name,
        checked_out_at: now,
      };
      checkedOutEquipments.push(updated);
      return updated;
    }
    return eq;
  });
  setCachedEquipment(updatedEquipment);

  const newActiveItems: NFCCheckoutItem[] = checkedOutEquipments.map((eq) => ({
    id: eq.active_checkout_id || Date.now() + Math.floor(Math.random() * 1000),
    equipment_id: eq.id,
    checked_out_by: null,
    checked_out_by_name: currentCardData.card.member_name,
    checked_out_at: now,
    expected_return_at: null,
    returned_at: null,
    notes: "[Offline Checkout]",
    checkout_location: null,
    nfc_value: nfcValue,
    nfc_id: currentCardData.card.id.toString(),
    equipment_name: eq.name,
    equipment_serial_number: eq.serial_number,
    equipment_location: eq.location,
  }));

  const updatedCardData: NFCMemberData = {
    ...currentCardData,
    activeCheckouts: [...currentCardData.activeCheckouts, ...newActiveItems],
  };
  setCachedMemberData(nfcValue, updatedCardData);

  return { updatedEquipment, updatedCardData };
}

export function applyOptimisticReturn(
  currentEquipment: Equipment[],
  currentCardData: NFCMemberData,
  equipmentIds: number[]
): { updatedEquipment: Equipment[]; updatedCardData: NFCMemberData } {
  const nfcValue = currentCardData.card.nfc_value;
  const now = new Date().toISOString();

  const updatedEquipment: Equipment[] = currentEquipment.map((eq) => {
    if (equipmentIds.includes(eq.id)) {
      return {
        ...eq,
        status: "Available",
        active_checkout_id: null,
        checked_out_by_name: null,
        checked_out_at: null,
        expected_return_at: null,
        checkout_location: null,
      };
    }
    return eq;
  });
  setCachedEquipment(updatedEquipment);

  const returnedItems = currentCardData.activeCheckouts
    .filter((item) => equipmentIds.includes(item.equipment_id))
    .map((item) => ({
      ...item,
      returned_at: now,
    }));

  const remainingActive = currentCardData.activeCheckouts.filter(
    (item) => !equipmentIds.includes(item.equipment_id)
  );

  const updatedCardData: NFCMemberData = {
    ...currentCardData,
    activeCheckouts: remainingActive,
    history: [...returnedItems, ...currentCardData.history],
  };
  setCachedMemberData(nfcValue, updatedCardData);

  return { updatedEquipment, updatedCardData };
}

export function applyOptimisticCardRegistration(
  currentCards: NFCCard[],
  card: NFCCard
): NFCCard[] {
  const exists = currentCards.some((c) => c.nfc_value === card.nfc_value);
  const updatedCards = exists ? currentCards : [...currentCards, card];
  setCachedCards(updatedCards);

  setCachedMemberData(card.nfc_value, {
    card,
    activeCheckouts: [],
    history: [],
  });

  return updatedCards;
}

// ---------------------------------------------------------------------------
// 4. CONNECTIVITY & SYNC ENGINE
// ---------------------------------------------------------------------------

export function isOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

export async function verifyConnectivity(): Promise<boolean> {
  if (!isOnline()) return false;
  try {
    // Quick head/get check with a 4s timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch("/api/nfc/cards", {
      method: "GET",
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

let isSyncingInProgress = false;

export async function processSyncQueue(
  onProgress?: (processed: number, total: number) => void
): Promise<{ success: number; failed: number }> {
  if (isSyncingInProgress) {
    return { success: 0, failed: 0 };
  }

  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { success: 0, failed: 0 };
  }

  // Check if we can actually reach the server
  const reachable = await verifyConnectivity();
  if (!reachable) {
    return { success: 0, failed: queue.length };
  }

  isSyncingInProgress = true;
  emitEvent("mediahub-sync-status-changed", { isSyncing: true, total: queue.length });

  let successCount = 0;
  let failedCount = 0;
  const total = queue.length;

  try {
    // Replay queued actions sequentially to ensure data ordering integrity
    for (let i = 0; i < queue.length; i++) {
      const action = queue[i];
      action.status = "syncing";
      saveOfflineQueue(queue);

      try {
        const res = await fetch(action.endpoint, {
          method: action.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.body),
        });

        if (res.ok) {
          successCount++;
          // Remove from queue
          queue.splice(i, 1);
          i--; // Adjust index
          saveOfflineQueue(queue);
          if (onProgress) onProgress(successCount, total);
        } else {
          // If server error or duplicate, inspect error
          const errData = await res.json().catch(() => ({}));
          action.retryCount++;
          action.status = "failed";
          action.error = errData.error || `Server responded with ${res.status}`;
          failedCount++;
          saveOfflineQueue(queue);
          // If non-recoverable or temporary, halt further queue processing to preserve order
          break;
        }
      } catch (networkErr: any) {
        // Network drop during sync
        action.retryCount++;
        action.status = "failed";
        action.error = networkErr?.message || "Network error during sync";
        failedCount++;
        saveOfflineQueue(queue);
        break;
      }
    }
  } finally {
    isSyncingInProgress = false;
    safeSetItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    emitEvent("mediahub-sync-status-changed", {
      isSyncing: false,
      successCount,
      failedCount,
      remainingCount: getOfflineQueue().length,
    });
  }

  return { success: successCount, failed: failedCount };
}
