import type { Equipment, NFCCard, NFCMemberData, NFCCheckoutItem } from "@/lib/types";

export type QueuedActionType = "checkout" | "return" | "register_card";

export interface QueuedAction {
  id: string;
  type: QueuedActionType;
  endpoint: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body: Record<string, any>;
  /** When the action was actually performed on the station (ms epoch). */
  timestamp: number;
  description: string;
  retryCount: number;
  status: "pending" | "syncing" | "failed";
  error?: string;
  /** Logged-in station account (user id) that performed the action. Only that user replays it. */
  userId?: string;
  /** NFC card value the action was performed with (captured at queue time). */
  nfcValue?: string;
  /**
   * Name of the card's member at queue time. Sent on replay as `expected_member_name`
   * so the server rejects the action if the card has since been reassigned.
   */
  memberName?: string;
  /** Human-readable equipment names, shown in the queue UI and rejection popup. */
  equipmentNames?: string[];
}

export interface EnqueueParams {
  type: QueuedActionType;
  endpoint?: string;
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  payload?: Record<string, any>;
  body?: Record<string, any>;
  description: string;
  nfcValue?: string;
  memberName?: string;
  equipmentNames?: string[];
  /**
   * When the action actually happened (ms epoch). Defaults to now. Pass the time a live
   * request was started when enqueueing after it failed, so a replay lines up with a
   * delivery that may have reached the server.
   */
  occurredAt?: number;
}

/** A queued action the server permanently refused (4xx). Kept until the user acknowledges it. */
export interface RejectedAction {
  id: string;
  type: QueuedActionType;
  description: string;
  userId?: string;
  nfcValue?: string;
  memberName?: string;
  equipmentNames?: string[];
  /** When the action was originally performed / queued (ms epoch). */
  queuedAt: number;
  /** When the server rejected it (ms epoch). */
  rejectedAt: number;
  httpStatus: number;
  reason: string;
}

/**
 * Why a sync run stopped early (remaining actions stay queued):
 * - offline: no network / server unreachable before starting
 * - network: a request threw or timed out mid-sync
 * - server: transient server failure (5xx, 408, 429)
 * - auth: 401/403 — the station session must be re-authenticated
 * - busy: another sync is already running (this tab or another tab), or the caller vetoed start
 */
export type SyncStopReason = "offline" | "network" | "server" | "auth" | "busy";

export interface SyncResult {
  /** Actions accepted by the server and removed from the queue. */
  success: number;
  /** Actions that could not be delivered (transient/auth failure) and remain queued. */
  failed: number;
  /** Actions permanently rejected by the server during this run (removed from the queue). */
  rejected: RejectedAction[];
  stoppedReason: SyncStopReason | null;
  /** Server/network message associated with `stoppedReason`, if any. */
  stopMessage?: string;
  /** Queue length after the run. */
  remaining: number;
}

export interface ProcessSyncOptions {
  /**
   * Checked right before the sync takes the lock and starts replaying (synchronously, with
   * no await in between). Return false to postpone (e.g. a live request is in flight on
   * the station). Returning true is the signal to lock the station UI.
   */
  canStart?: () => boolean;
  /** Per-request timeout for replayed actions (ms). */
  requestTimeoutMs?: number;
}

const STORAGE_KEYS = {
  QUEUE: "mediahub_offline_queue_v1",
  EQUIPMENT: "mediahub_offline_equipment_v1",
  CARDS: "mediahub_offline_cards_v1",
  MEMBERS: "mediahub_offline_members_v1",
  LAST_SYNC: "mediahub_offline_last_sync_v1",
  REJECTED: "mediahub_offline_rejected_v1",
  SYNC_LOCK: "mediahub_offline_sync_lock_v1",
  ACTIVE_USER: "mediahub_offline_active_user_v1",
};

export const OFFLINE_QUEUE_STORAGE_KEY = STORAGE_KEYS.QUEUE;
export const OFFLINE_REJECTED_STORAGE_KEY = STORAGE_KEYS.REJECTED;
export const OFFLINE_MEMBERS_STORAGE_KEY = STORAGE_KEYS.MEMBERS;
export const OFFLINE_SYNC_LOCK_STORAGE_KEY = STORAGE_KEYS.SYNC_LOCK;
export const OFFLINE_ACTIVE_USER_STORAGE_KEY = STORAGE_KEYS.ACTIVE_USER;

/** Timeout for live station requests before they are treated as a network failure. */
export const LIVE_REQUEST_TIMEOUT_MS = 15_000;
/** Timeout for each replayed queued action. */
export const REPLAY_REQUEST_TIMEOUT_MS = 20_000;

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

function safeSetItem(key: string, value: string): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`[offlineSync] Failed to write ${key}:`, err);
    return false;
  }
}

function safeRemoveItem(key: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    console.warn(`[offlineSync] Failed to remove ${key}:`, err);
  }
}

function emitEvent(name: string, detail?: any) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

// ---------------------------------------------------------------------------
// 0. STATION USER NAMESPACING
// ---------------------------------------------------------------------------
//
// The queue, the rejected-actions store and the member cache are stored per logged-in
// station account, so actions queued by one account are never replayed under another
// account's session. Without a user (legacy data / tests) the un-namespaced keys are used.

let currentUserId: string | null = null;

function normalizeUserId(userId: string | number | null | undefined): string | null {
  if (userId === null || userId === undefined) return null;
  const s = String(userId).trim();
  return s ? s : null;
}

/** Storage key for per-user data (queue, rejections, member cache). */
export function offlineStorageKey(base: string, userId: string | null = currentUserId): string {
  return userId ? `${base}:user:${encodeURIComponent(userId)}` : base;
}

/** The station account the offline store is currently bound to. */
export function getOfflineUser(): string | null {
  return currentUserId;
}

/**
 * Binds the offline store to the logged-in station account. Call before reading the
 * queue. On first use, any legacy un-namespaced queue / rejections are moved to this
 * user (and the legacy keys removed, so the migration happens once).
 */
export function setOfflineUser(userId: string | number | null | undefined): void {
  const id = normalizeUserId(userId);
  currentUserId = id;
  if (!id) return;
  safeSetItem(STORAGE_KEYS.ACTIVE_USER, id);
  migrateLegacyData(id);
  emitEvent("mediahub-offline-queue-changed", { count: readQueue(id).length });
  emitEvent("mediahub-offline-rejections-changed", { count: readRejected(id).length });
}

function migrateLegacyData(userId: string): void {
  const legacyQueueRaw = safeGetItem(STORAGE_KEYS.QUEUE);
  if (legacyQueueRaw !== null) {
    const legacy = parseQueue(legacyQueueRaw);
    let ok = true;
    if (legacy.length > 0) {
      const existing = readQueue(userId);
      const known = new Set(existing.map((a) => a.id));
      const merged = [
        ...existing,
        ...legacy.filter((a) => !known.has(a.id)).map((a) => ({ ...a, userId })),
      ].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      ok = safeSetItem(offlineStorageKey(STORAGE_KEYS.QUEUE, userId), JSON.stringify(merged));
    }
    // Only drop the legacy copy once it has been safely written under the user.
    if (ok) safeRemoveItem(STORAGE_KEYS.QUEUE);
  }

  const legacyRejectedRaw = safeGetItem(STORAGE_KEYS.REJECTED);
  if (legacyRejectedRaw !== null) {
    const legacy = parseRejected(legacyRejectedRaw);
    let ok = true;
    if (legacy.length > 0) {
      const existing = readRejected(userId);
      const known = new Set(existing.map((r) => r.id));
      const merged = [
        ...existing,
        ...legacy.filter((r) => !known.has(r.id)).map((r) => ({ ...r, userId })),
      ];
      ok = safeSetItem(offlineStorageKey(STORAGE_KEYS.REJECTED, userId), JSON.stringify(merged));
    }
    if (ok) safeRemoveItem(STORAGE_KEYS.REJECTED);
  }

  // The legacy member cache cannot be attributed to an account; it is only a cache.
  safeRemoveItem(STORAGE_KEYS.MEMBERS);
}

// ---------------------------------------------------------------------------
// 1. QUEUE MANAGEMENT
// ---------------------------------------------------------------------------

function parseQueue(raw: string | null): QueuedAction[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as QueuedAction[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (action) =>
        action &&
        typeof action.id === "string" &&
        typeof action.endpoint === "string" &&
        action.endpoint.startsWith("/api/") &&
        !action.endpoint.startsWith("//")
    );
  } catch {
    return [];
  }
}

function readQueue(userId: string | null): QueuedAction[] {
  return parseQueue(safeGetItem(offlineStorageKey(STORAGE_KEYS.QUEUE, userId)));
}

function writeQueue(userId: string | null, queue: QueuedAction[]): void {
  safeSetItem(offlineStorageKey(STORAGE_KEYS.QUEUE, userId), JSON.stringify(queue));
  emitEvent("mediahub-offline-queue-changed", { count: queue.length });
}

/** The current station user's queued actions (FIFO). */
export function getOfflineQueue(): QueuedAction[] {
  return readQueue(currentUserId);
}

export function saveOfflineQueue(queue: QueuedAction[]): void {
  writeQueue(currentUserId, queue);
}

/** Number of unsynced actions for a station user (defaults to the current one). */
export function getPendingActionCount(userId?: string | number | null): number {
  const id = userId === undefined ? currentUserId : normalizeUserId(userId);
  return readQueue(id).length;
}

export function enqueueOfflineAction(params: EnqueueParams): QueuedAction {
  const userId = currentUserId;

  let endpoint = params.endpoint;
  const method: "POST" | "PUT" | "PATCH" | "DELETE" = params.method || "POST";
  const body = params.payload || params.body || {};

  if (!endpoint || !endpoint.startsWith("/api/") || endpoint.startsWith("//")) {
    if (params.type === "checkout") endpoint = "/api/nfc/checkout";
    else if (params.type === "return") endpoint = "/api/nfc/return";
    else if (params.type === "register_card") endpoint = "/api/nfc/card";
    else endpoint = "/api/nfc";
  }

  const nfcValue =
    params.nfcValue ?? (typeof body.nfc_value === "string" ? body.nfc_value : undefined);
  const timestamp =
    typeof params.occurredAt === "number" && Number.isFinite(params.occurredAt)
      ? params.occurredAt
      : Date.now();

  const newAction: QueuedAction = {
    id: `offline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type: params.type,
    endpoint,
    method,
    body,
    timestamp,
    description: params.description,
    retryCount: 0,
    status: "pending",
    ...(userId ? { userId } : {}),
    ...(nfcValue ? { nfcValue } : {}),
    ...(params.memberName ? { memberName: params.memberName } : {}),
    ...(params.equipmentNames && params.equipmentNames.length > 0
      ? { equipmentNames: params.equipmentNames }
      : {}),
  };
  // Read-modify-write on the latest stored queue so concurrent writers never drop items.
  const queue = readQueue(userId);
  queue.push(newAction);
  writeQueue(userId, queue);
  return newAction;
}

export function removeQueuedAction(id: string): void {
  removeQueuedActionFor(currentUserId, id);
}

function removeQueuedActionFor(userId: string | null, id: string): void {
  const queue = readQueue(userId);
  writeQueue(
    userId,
    queue.filter((item) => item.id !== id)
  );
}

/** Patches one queued action in place, re-reading storage so concurrent enqueues survive. */
function updateQueuedAction(userId: string | null, id: string, patch: Partial<QueuedAction>): void {
  const queue = readQueue(userId);
  let changed = false;
  const updated = queue.map((item) => {
    if (item.id !== id) return item;
    changed = true;
    return { ...item, ...patch };
  });
  if (changed) writeQueue(userId, updated);
}

export function clearOfflineQueue(): void {
  saveOfflineQueue([]);
}

// ---------------------------------------------------------------------------
// 1b. REJECTED ACTIONS (awaiting user acknowledgement)
// ---------------------------------------------------------------------------

function parseRejected(raw: string | null): RejectedAction[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RejectedAction[];
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.id === "string") : [];
  } catch {
    return [];
  }
}

function readRejected(userId: string | null): RejectedAction[] {
  return parseRejected(safeGetItem(offlineStorageKey(STORAGE_KEYS.REJECTED, userId)));
}

function writeRejected(userId: string | null, list: RejectedAction[]): void {
  const key = offlineStorageKey(STORAGE_KEYS.REJECTED, userId);
  if (list.length === 0) safeRemoveItem(key);
  else safeSetItem(key, JSON.stringify(list));
  emitEvent("mediahub-offline-rejections-changed", { count: list.length });
}

/** Rejected actions for the current station user, oldest first. */
export function getRejectedActions(): RejectedAction[] {
  return readRejected(currentUserId);
}

function recordRejectedAction(userId: string | null, rejection: RejectedAction): void {
  const list = readRejected(userId).filter((r) => r.id !== rejection.id);
  list.push(rejection);
  writeRejected(userId, list);
}

/** Dismisses acknowledged rejections (all of them when `ids` is omitted). */
export function acknowledgeRejectedActions(ids?: string[]): void {
  if (!ids) {
    writeRejected(currentUserId, []);
    return;
  }
  const drop = new Set(ids);
  writeRejected(
    currentUserId,
    readRejected(currentUserId).filter((r) => !drop.has(r.id))
  );
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

/** Member cache for the current station user. */
export function getAllCachedMembers(): Record<string, NFCMemberData> {
  const raw = safeGetItem(offlineStorageKey(STORAGE_KEYS.MEMBERS));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, NFCMemberData>;
    return parsed && typeof parsed === "object" ? parsed : {};
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
  safeSetItem(offlineStorageKey(STORAGE_KEYS.MEMBERS), JSON.stringify(all));
}

/** Removes the cached member data of a station user (defaults to the current one). */
export function clearOfflineMemberCache(userId?: string | number | null): void {
  const id = userId === undefined ? currentUserId : normalizeUserId(userId);
  safeRemoveItem(offlineStorageKey(STORAGE_KEYS.MEMBERS, id));
}

// ---------------------------------------------------------------------------
// 2b. SIGN-OUT
// ---------------------------------------------------------------------------

/**
 * Call from sign-out handlers. If the station account that last used the NFC station has
 * unsynced offline actions, asks for confirmation (returns false if the user cancels).
 * On proceed, clears that account's cached member data; its unsynced queue is kept so it
 * syncs the next time the account signs in to the station.
 */
export function confirmOfflineSignOut(): boolean {
  const userId = currentUserId ?? normalizeUserId(safeGetItem(STORAGE_KEYS.ACTIVE_USER));
  if (userId) {
    const pending = readQueue(userId).length;
    if (pending > 0 && typeof window !== "undefined" && typeof window.confirm === "function") {
      const proceed = window.confirm(
        `This account has ${pending} offline NFC station action(s) that have not been synced to the database yet.\n\n` +
          "They will stay saved on this device and sync automatically the next time this account signs in to the NFC station. " +
          "Sign out anyway?"
      );
      if (!proceed) return false;
    }
    safeRemoveItem(offlineStorageKey(STORAGE_KEYS.MEMBERS, userId));
  }
  safeRemoveItem(STORAGE_KEYS.MEMBERS);
  safeRemoveItem(STORAGE_KEYS.ACTIVE_USER);
  currentUserId = null;
  return true;
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

/** True while this tab is running processSyncQueue (including its connectivity probe). */
export function isSyncRunning(): boolean {
  return isSyncingInProgress;
}

// ---------------------------------------------------------------------------
// 5. RESPONSE HELPERS
// ---------------------------------------------------------------------------

function extractErrorMessage(data: unknown, status: number): string {
  const err =
    data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err === "object") {
    // zod `flatten()` output: { formErrors: string[], fieldErrors: Record<string, string[]> }
    const flat = err as { formErrors?: unknown; fieldErrors?: unknown };
    const parts: string[] = [];
    if (Array.isArray(flat.formErrors)) {
      parts.push(...flat.formErrors.filter((m): m is string => typeof m === "string"));
    }
    if (flat.fieldErrors && typeof flat.fieldErrors === "object") {
      for (const [field, msgs] of Object.entries(flat.fieldErrors as Record<string, unknown>)) {
        if (Array.isArray(msgs) && msgs.length > 0) parts.push(`${field}: ${msgs.join(", ")}`);
      }
    }
    if (parts.length > 0) return parts.join("; ");
  }
  if (status >= 500) return `Server error (${status})`;
  return `Request failed (${status})`;
}

/**
 * Reads a fetch Response body without ever throwing. Non-JSON bodies (e.g. a Cloudflare
 * 502 HTML page) yield `data: null` and a generic `Server error (502)` style message.
 */
export async function readResponsePayload(
  res: Response
): Promise<{ data: any; errorMessage: string }> {
  let data: any = null;
  try {
    if (typeof res.text === "function") {
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
    } else if (typeof (res as { json?: unknown }).json === "function") {
      data = await res.json();
    }
  } catch {
    data = null;
  }
  return { data, errorMessage: extractErrorMessage(data, res.status) };
}

type ResponseClass = "ok" | "rejected" | "transient" | "auth";

/** Classifies an HTTP status for queue replay purposes. */
export function classifySyncStatus(status: number): ResponseClass {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status === 429 || status >= 500) return "transient";
  if (status >= 400 && status < 500) return "rejected";
  return "transient";
}

function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { name?: unknown }).name === "AbortError");
}

export type LiveRequestResult =
  /** 2xx with a JSON body. */
  | { kind: "ok"; status: number; data: any }
  /** Genuine connectivity failure (offline, fetch threw, timed out): safe to queue offline. */
  | { kind: "offline"; message: string }
  /** The server answered with an error, or with a non-JSON body. Must NOT be queued. */
  | { kind: "error"; status: number; message: string; data: any };

/**
 * Sends a live (non-queued) station request. Only real network failures — navigator
 * offline, fetch throwing (TypeError) or the request timing out (AbortError) — are
 * reported as `offline`. Any HTTP response, including 5xx and non-JSON error pages
 * (e.g. a Cloudflare HTML 502), is reported as `error` so callers show it instead of
 * queueing the action. Never throws.
 */
export async function sendLiveRequest(
  url: string,
  init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown } = {},
  timeoutMs: number = LIVE_REQUEST_TIMEOUT_MS
): Promise<LiveRequestResult> {
  if (!isOnline()) return { kind: "offline", message: "Device is offline." };

  const hasBody = init.body !== undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (hasBody ? "POST" : "GET"),
      ...(hasBody
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) }
        : {}),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return {
      kind: "offline",
      message: isAbortError(err) ? "Request timed out." : "Network request failed.",
    };
  }

  try {
    const { data, errorMessage } = await readResponsePayload(res);
    if (res.redirected) {
      return {
        kind: "error",
        status: 401,
        message: "Station session expired. Please sign in again.",
        data: null,
      };
    }
    if (res.ok) {
      if (data === null || typeof data !== "object") {
        return {
          kind: "error",
          status: res.status,
          message: `Unexpected response from server (${res.status}). Please try again.`,
          data,
        };
      }
      return { kind: "ok", status: res.status, data };
    }
    return { kind: "error", status: res.status, message: errorMessage, data };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 6. CROSS-TAB SYNC LOCK
// ---------------------------------------------------------------------------

const SYNC_LOCK_TTL_MS = 60_000;
const TAB_ID = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

interface SyncLock {
  owner: string;
  expiresAt: number;
}

function readSyncLock(): SyncLock | null {
  const raw = safeGetItem(STORAGE_KEYS.SYNC_LOCK);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SyncLock;
    if (!parsed || typeof parsed.owner !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** True while another browser tab/window holds an unexpired sync lock. */
export function isSyncLockHeldElsewhere(): boolean {
  const lock = readSyncLock();
  return Boolean(lock && lock.owner !== TAB_ID && lock.expiresAt > Date.now());
}

function acquireSyncLock(): boolean {
  if (isSyncLockHeldElsewhere()) return false;
  safeSetItem(
    STORAGE_KEYS.SYNC_LOCK,
    JSON.stringify({ owner: TAB_ID, expiresAt: Date.now() + SYNC_LOCK_TTL_MS })
  );
  const check = readSyncLock();
  // If storage could not be written at all, fall back to the in-tab guard only.
  return !check || check.owner === TAB_ID;
}

function refreshSyncLock(): void {
  const lock = readSyncLock();
  if (lock && lock.owner !== TAB_ID) return;
  safeSetItem(
    STORAGE_KEYS.SYNC_LOCK,
    JSON.stringify({ owner: TAB_ID, expiresAt: Date.now() + SYNC_LOCK_TTL_MS })
  );
}

function releaseSyncLock(): void {
  const lock = readSyncLock();
  if (lock && lock.owner === TAB_ID) safeRemoveItem(STORAGE_KEYS.SYNC_LOCK);
}

// ---------------------------------------------------------------------------
// 7. QUEUE REPLAY
// ---------------------------------------------------------------------------

/** Only apply a clock correction when the station clock is clearly off. */
const CLOCK_SKEW_THRESHOLD_MS = 60_000;

/**
 * Body sent when replaying a queued action. Every replay carries `client_action_id`.
 * Checkout/return replays also carry the original action time (`occurred_at`) and the
 * member the card belonged to at queue time (`expected_member_name`). `clockOffsetMs`
 * (server time minus station time) corrects for a badly skewed station clock.
 */
export function buildReplayBody(action: QueuedAction, clockOffsetMs = 0): Record<string, any> {
  const body: Record<string, any> = { ...action.body, client_action_id: action.id };
  if (action.type !== "checkout" && action.type !== "return") return body;
  if (!body.nfc_value && !body.nfc_id && action.nfcValue) body.nfc_value = action.nfcValue;
  if (typeof action.timestamp === "number" && Number.isFinite(action.timestamp)) {
    const offset = Math.abs(clockOffsetMs) > CLOCK_SKEW_THRESHOLD_MS ? clockOffsetMs : 0;
    body.occurred_at = new Date(action.timestamp + offset).toISOString();
  }
  if (action.memberName) body.expected_member_name = action.memberName;
  return body;
}

type ProbeResult =
  | { kind: "ok"; clockOffsetMs: number }
  | { kind: "offline" | "server" | "auth"; message: string };

async function probeServer(): Promise<ProbeResult> {
  if (!isOnline()) return { kind: "offline", message: "Device is offline." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch("/api/nfc/cards", {
      method: "GET",
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    if (res.redirected) {
      return { kind: "auth", message: "Station session expired. Please sign in again." };
    }
    const cls = classifySyncStatus(res.status);
    if (cls === "auth") {
      const { errorMessage } = await readResponsePayload(res);
      return { kind: "auth", message: errorMessage };
    }
    if (cls === "transient") {
      return { kind: "server", message: `Server error (${res.status})` };
    }
    let clockOffsetMs = 0;
    const dateHeader = res.headers?.get?.("date");
    if (dateHeader) {
      const serverMs = Date.parse(dateHeader);
      if (Number.isFinite(serverMs)) clockOffsetMs = serverMs - Date.now();
    }
    return { kind: "ok", clockOffsetMs };
  } catch {
    return { kind: "offline", message: "Server is unreachable." };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Replays the current station user's queued offline actions in FIFO order.
 *
 * - 2xx: removed from the queue.
 * - Permanent 4xx (400/404/409/422/...): removed from the queue, recorded as a rejection
 *   (see getRejectedActions) and processing continues with the next action.
 * - Network error / timeout / 5xx / 408 / 429: sync stops; the action and everything
 *   after it stay queued for the next attempt.
 * - 401 / 403: sync stops with `stoppedReason: "auth"`; actions stay queued.
 *
 * Only actions recorded for the current station user (see setOfflineUser) are replayed.
 * The queue is re-read from storage for every mutation and items are removed by id, so
 * actions enqueued while a sync is running are never lost. A localStorage lock (with a
 * TTL) prevents overlapping syncs across tabs. Every request has a timeout, so the run
 * (and anything waiting on it) always finishes.
 */
export async function processSyncQueue(
  onProgress?: (processed: number, total: number) => void,
  options: ProcessSyncOptions = {}
): Promise<SyncResult> {
  // Pin the user for the whole run so a concurrent setOfflineUser can't redirect writes.
  const userId = currentUserId;
  const ownActions = () =>
    readQueue(userId).filter((a) => !userId || a.userId === userId);
  const requestTimeoutMs = options.requestTimeoutMs ?? REPLAY_REQUEST_TIMEOUT_MS;

  const summary = (
    partial: Partial<SyncResult> & { stoppedReason: SyncStopReason | null }
  ): SyncResult => ({
    success: 0,
    failed: 0,
    rejected: [],
    remaining: readQueue(userId).length,
    ...partial,
  });

  if (isSyncingInProgress) return summary({ stoppedReason: "busy" });
  if (ownActions().length === 0) return summary({ stoppedReason: null });

  isSyncingInProgress = true;
  let lockAcquired = false;
  let successCount = 0;
  let failedCount = 0;
  const rejected: RejectedAction[] = [];
  let stoppedReason: SyncStopReason | null = null;
  let stopMessage: string | undefined;

  try {
    // Check we can actually reach (and are authorised on) the server before blocking the UI.
    const probe = await probeServer();
    if (probe.kind !== "ok") {
      return summary({
        stoppedReason: probe.kind,
        stopMessage: probe.message,
        failed: ownActions().length,
      });
    }

    if (options.canStart && !options.canStart()) return summary({ stoppedReason: "busy" });
    if (!acquireSyncLock()) return summary({ stoppedReason: "busy" });
    lockAcquired = true;

    const snapshot = ownActions();
    const total = snapshot.length;
    let processed = 0;
    const emitProgress = (current?: QueuedAction) =>
      emitEvent("mediahub-sync-status-changed", {
        isSyncing: true,
        processed,
        total,
        currentDescription: current?.description,
      });

    for (const snap of snapshot) {
      // Re-read: the action may have been removed elsewhere since the snapshot was taken.
      const action = readQueue(userId).find((item) => item.id === snap.id);
      if (!action) {
        processed++;
        continue;
      }

      updateQueuedAction(userId, action.id, { status: "syncing" });
      emitProgress(action);
      refreshSyncLock();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      let res: Response;
      try {
        res = await fetch(action.endpoint, {
          method: action.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildReplayBody(action, probe.clockOffsetMs)),
          cache: "no-store",
          signal: controller.signal,
        });
      } catch (networkErr: any) {
        clearTimeout(timer);
        failedCount++;
        stoppedReason = "network";
        stopMessage = isAbortError(networkErr)
          ? "Sync request timed out."
          : networkErr?.message || "Network error during sync";
        updateQueuedAction(userId, action.id, {
          status: "failed",
          retryCount: (action.retryCount || 0) + 1,
          error: stopMessage,
        });
        break;
      }

      const cls: ResponseClass = res.redirected ? "auth" : classifySyncStatus(res.status);

      if (cls === "ok") {
        clearTimeout(timer);
        successCount++;
        processed++;
        removeQueuedActionFor(userId, action.id);
        if (onProgress) onProgress(processed, total);
        continue;
      }

      const { errorMessage } = res.redirected
        ? { errorMessage: "Station session expired. Please sign in again." }
        : await readResponsePayload(res);
      clearTimeout(timer);

      if (cls === "rejected") {
        const rejection: RejectedAction = {
          id: action.id,
          type: action.type,
          description: action.description,
          ...(action.userId ? { userId: action.userId } : {}),
          nfcValue: action.nfcValue ?? action.body?.nfc_value,
          memberName: action.memberName ?? action.body?.member_name,
          equipmentNames: action.equipmentNames,
          queuedAt: action.timestamp,
          rejectedAt: Date.now(),
          httpStatus: res.status,
          reason: errorMessage,
        };
        // Record the rejection before dropping the action so it never vanishes silently.
        recordRejectedAction(userId, rejection);
        removeQueuedActionFor(userId, action.id);
        rejected.push(rejection);
        processed++;
        if (onProgress) onProgress(processed, total);
        continue;
      }

      // Transient or auth failure: keep this and all later actions queued.
      failedCount++;
      stoppedReason = cls === "auth" ? "auth" : "server";
      stopMessage = errorMessage;
      updateQueuedAction(userId, action.id, {
        status: "failed",
        retryCount: (action.retryCount || 0) + 1,
        error: errorMessage,
      });
      break;
    }
  } finally {
    isSyncingInProgress = false;
    if (lockAcquired) {
      releaseSyncLock();
      safeSetItem(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
      emitEvent("mediahub-sync-status-changed", {
        isSyncing: false,
        successCount,
        failedCount,
        rejectedCount: rejected.length,
        remainingCount: readQueue(userId).length,
      });
    }
  }

  return {
    success: successCount,
    failed: failedCount,
    rejected,
    stoppedReason,
    ...(stopMessage ? { stopMessage } : {}),
    remaining: readQueue(userId).length,
  };
}
