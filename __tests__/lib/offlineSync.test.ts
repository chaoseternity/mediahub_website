import {
  enqueueOfflineAction,
  getOfflineQueue,
  removeQueuedAction,
  clearOfflineQueue,
  getCachedEquipment,
  setCachedEquipment,
  getCachedCards,
  setCachedCards,
  getCachedMemberData,
  setCachedMemberData,
  applyOptimisticCheckout,
  applyOptimisticReturn,
  applyOptimisticCardRegistration,
  processSyncQueue,
  isOnline,
  setOfflineUser,
  getRejectedActions,
  acknowledgeRejectedActions,
  buildReplayBody,
  sendLiveRequest,
  confirmOfflineSignOut,
  getPendingActionCount,
  offlineStorageKey,
  OFFLINE_QUEUE_STORAGE_KEY,
  OFFLINE_MEMBERS_STORAGE_KEY,
} from "@/lib/offlineSync";
import type { Equipment, NFCCard, NFCMemberData } from "@/lib/types";

class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = value.toString();
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

const mockStorage = new MockLocalStorage();

beforeAll(() => {
  (global as any).localStorage = mockStorage;
  (global as any).window = {
    localStorage: mockStorage,
    dispatchEvent: jest.fn(),
  };
});

/** Minimal fetch Response stand-in (text body, optional headers). */
function mockResponse(status: number, body: unknown, opts: { raw?: boolean } = {}): Response {
  const text = opts.raw ? String(body) : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    headers: { get: () => null },
    text: async () => text,
  } as unknown as Response;
}

const okProbe = (url: string) => url.includes("/api/nfc/cards");

describe("offlineSync engine", () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    setOfflineUser(null);
  });

  describe("Queue Operations", () => {
    test("starts with an empty queue", () => {
      expect(getOfflineQueue()).toEqual([]);
    });

    test("enqueues actions and generates proper defaults", () => {
      const action = enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "TEST-CARD-1", equipment_ids: [101, 102] },
        description: "Checkout 2 items",
      });

      expect(action.id).toMatch(/^offline-\d+/);
      expect(action.type).toBe("checkout");
      expect(action.endpoint).toBe("/api/nfc/checkout");
      expect(action.method).toBe("POST");
      expect(action.body).toEqual({ nfc_value: "TEST-CARD-1", equipment_ids: [101, 102] });
      expect(action.status).toBe("pending");

      const queue = getOfflineQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe(action.id);
    });

    test("removes actions by ID", () => {
      const action1 = enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Action 1",
      });
      const action2 = enqueueOfflineAction({
        type: "return",
        payload: { nfc_value: "CARD-2", equipment_ids: [2] },
        description: "Action 2",
      });

      expect(getOfflineQueue()).toHaveLength(2);
      removeQueuedAction(action1.id);

      const remaining = getOfflineQueue();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(action2.id);
    });

    test("clears the entire queue", () => {
      enqueueOfflineAction({
        type: "return",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Return 1",
      });
      expect(getOfflineQueue()).toHaveLength(1);

      clearOfflineQueue();
      expect(getOfflineQueue()).toEqual([]);
    });
  });

  describe("Cache Operations", () => {
    test("caches and retrieves equipment list", () => {
      const mockEquipment: Equipment[] = [
        {
          id: 1,
          name: "Sony A7 IV",
          tags: ["Camera"],
          description: null,
          serial_number: "SN-100",
          condition: "Working",
          location: "Cabinet A",
          status: "Available",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          active_checkout_id: null,
          checked_out_by_name: null,
          checked_out_at: null,
          expected_return_at: null,
          checkout_location: null,
        },
      ];

      setCachedEquipment(mockEquipment);
      expect(getCachedEquipment()).toEqual(mockEquipment);
    });

    test("caches and retrieves registered NFC cards", () => {
      const mockCards: NFCCard[] = [
        {
          id: 1,
          nfc_value: "NFC-9999",
          member_name: "Alex Smith",
          notes: "Team Leader",
          created_at: new Date().toISOString(),
        },
      ];

      setCachedCards(mockCards);
      expect(getCachedCards()).toEqual(mockCards);
    });

    test("caches and retrieves individual member checkout data", () => {
      const mockMember: NFCMemberData = {
        card: {
          id: 2,
          nfc_value: "NFC-8888",
          member_name: "Jordan Lee",
          notes: null,
          created_at: new Date().toISOString(),
        },
        activeCheckouts: [],
        history: [],
      };

      setCachedMemberData("NFC-8888", mockMember);
      expect(getCachedMemberData("NFC-8888")).toEqual(mockMember);
      expect(getCachedMemberData("UNKNOWN")).toBeNull();
    });
  });

  describe("Optimistic Mutations", () => {
    const baseEquipment: Equipment = {
      id: 50,
      name: "Tripod Manfrotto",
      tags: ["Support"],
      description: null,
      serial_number: "TR-01",
      condition: "Working",
      location: "Shelf 1",
      status: "Available",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      active_checkout_id: null,
      checked_out_by_name: null,
      checked_out_at: null,
      expected_return_at: null,
      checkout_location: null,
    };

    const baseCard: NFCCard = {
      id: 10,
      nfc_value: "CARD-ABC",
      member_name: "Taylor Swift",
      notes: null,
      created_at: new Date().toISOString(),
    };

    const baseMemberData: NFCMemberData = {
      card: baseCard,
      activeCheckouts: [],
      history: [],
    };

    test("applyOptimisticCheckout updates equipment status and card active checkouts", () => {
      const { updatedEquipment, updatedCardData } = applyOptimisticCheckout(
        [baseEquipment],
        baseMemberData,
        [50]
      );

      // Equipment status changed to Checked Out
      expect(updatedEquipment[0].status).toBe("Checked Out");
      expect(updatedEquipment[0].checked_out_by_name).toBe("Taylor Swift");
      expect(updatedEquipment[0].active_checkout_id).toBeDefined();

      // Card active checkouts updated
      expect(updatedCardData.activeCheckouts).toHaveLength(1);
      expect(updatedCardData.activeCheckouts[0].equipment_id).toBe(50);
      expect(updatedCardData.activeCheckouts[0].equipment_name).toBe("Tripod Manfrotto");
    });

    test("applyOptimisticReturn restores equipment to Available and moves to history", () => {
      // First checkout
      const checkedOut = applyOptimisticCheckout([baseEquipment], baseMemberData, [50]);

      // Then return
      const { updatedEquipment, updatedCardData } = applyOptimisticReturn(
        checkedOut.updatedEquipment,
        checkedOut.updatedCardData,
        [50]
      );

      // Equipment status restored to Available
      expect(updatedEquipment[0].status).toBe("Available");
      expect(updatedEquipment[0].checked_out_by_name).toBeNull();
      expect(updatedEquipment[0].active_checkout_id).toBeNull();

      // Active checkouts cleared, moved to history
      expect(updatedCardData.activeCheckouts).toHaveLength(0);
      expect(updatedCardData.history).toHaveLength(1);
      expect(updatedCardData.history[0].equipment_id).toBe(50);
      expect(updatedCardData.history[0].returned_at).toBeDefined();
    });

    test("applyOptimisticCardRegistration adds new card and creates member cache", () => {
      const newCard: NFCCard = {
        id: 77,
        nfc_value: "NEW-UID-123",
        member_name: "Casey Jones",
        notes: "Grip",
        created_at: new Date().toISOString(),
      };

      const updatedCards = applyOptimisticCardRegistration([], newCard);
      expect(updatedCards).toHaveLength(1);
      expect(updatedCards[0].member_name).toBe("Casey Jones");

      const cachedMember = getCachedMemberData("NEW-UID-123");
      expect(cachedMember).not.toBeNull();
      expect(cachedMember?.card.member_name).toBe("Casey Jones");
    });
  });

  describe("processSyncQueue Replay Engine", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test("replays queued actions in FIFO order when connection is healthy", async () => {
      enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Checkout item 1",
      });
      enqueueOfflineAction({
        type: "return",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Return item 1",
      });

      expect(getOfflineQueue()).toHaveLength(2);

      // Mock fetch: first call verifyConnectivity (/api/nfc/cards), then 2 actions
      const fetchMock = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        } as Response);
      });
      global.fetch = fetchMock;

      const progressSpy = jest.fn();
      const result = await processSyncQueue(progressSpy);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
      expect(getOfflineQueue()).toHaveLength(0);
      expect(progressSpy).toHaveBeenCalledWith(1, 2);
      expect(progressSpy).toHaveBeenCalledWith(2, 2);
    });

    test("halts queue replay on network error to preserve sequential data integrity", async () => {
      enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Checkout 1",
      });
      enqueueOfflineAction({
        type: "return",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Return 1",
      });

      let callCount = 0;
      const fetchMock = jest.fn().mockImplementation((url: string) => {
        callCount++;
        // Connectivity check passes
        if (url.includes("/api/nfc/cards")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
        }
        // First action fails network
        return Promise.reject(new TypeError("Failed to fetch"));
      });
      global.fetch = fetchMock;

      const result = await processSyncQueue();
      expect(result.failed).toBe(1);
      // Items remain in queue, status marked failed
      const remaining = getOfflineQueue();
      expect(remaining).toHaveLength(2);
      expect(remaining[0].status).toBe("failed");
      expect(remaining[0].retryCount).toBe(1);
    });
  });

  describe("Station user namespacing", () => {
    test("queue, rejections and member cache are scoped to the logged-in station user", () => {
      setOfflineUser("1");
      const a = enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "User 1 checkout",
        memberName: "Alice",
      });
      expect(a.userId).toBe("1");
      expect(a.nfcValue).toBe("CARD-1");
      expect(a.memberName).toBe("Alice");
      setCachedMemberData("CARD-1", {
        card: { id: 1, nfc_value: "CARD-1", member_name: "Alice", notes: null, created_at: "" },
        activeCheckouts: [],
        history: [],
      });
      expect(mockStorage.getItem(offlineStorageKey(OFFLINE_QUEUE_STORAGE_KEY, "1"))).not.toBeNull();
      expect(mockStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY)).toBeNull();

      setOfflineUser("2");
      expect(getOfflineQueue()).toEqual([]);
      expect(getCachedMemberData("CARD-1")).toBeNull();
      expect(getPendingActionCount("1")).toBe(1);

      setOfflineUser("1");
      expect(getOfflineQueue().map((q) => q.id)).toEqual([a.id]);
      expect(getCachedMemberData("CARD-1")?.card.member_name).toBe("Alice");
    });

    test("migrates a legacy un-namespaced queue to the first user once", () => {
      mockStorage.setItem(
        OFFLINE_QUEUE_STORAGE_KEY,
        JSON.stringify([
          {
            id: "offline-legacy-1",
            type: "return",
            endpoint: "/api/nfc/return",
            method: "POST",
            body: { nfc_value: "CARD-9", equipment_ids: [3] },
            timestamp: Date.now() - 1000,
            description: "Legacy return",
            retryCount: 0,
            status: "pending",
          },
        ])
      );
      mockStorage.setItem(OFFLINE_MEMBERS_STORAGE_KEY, JSON.stringify({ X: {} }));

      setOfflineUser("7");
      const q = getOfflineQueue();
      expect(q).toHaveLength(1);
      expect(q[0].id).toBe("offline-legacy-1");
      expect(q[0].userId).toBe("7");
      expect(mockStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY)).toBeNull();
      expect(mockStorage.getItem(OFFLINE_MEMBERS_STORAGE_KEY)).toBeNull();

      setOfflineUser("8");
      expect(getOfflineQueue()).toEqual([]);
    });

    test("only replays actions belonging to the current user", async () => {
      setOfflineUser("2");
      enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-2", equipment_ids: [2] },
        description: "User 2 action",
      });
      setOfflineUser("1");
      enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "User 1 action",
      });

      const replayed: any[] = [];
      global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (!okProbe(url)) replayed.push(JSON.parse(String(init?.body)));
        return Promise.resolve(mockResponse(200, { success: true }));
      });

      const result = await processSyncQueue();
      expect(result.success).toBe(1);
      expect(replayed).toHaveLength(1);
      expect(replayed[0].nfc_value).toBe("CARD-1");
      expect(getOfflineQueue()).toEqual([]);
      expect(getPendingActionCount("2")).toBe(1);
    });
  });

  describe("Replay semantics", () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    test("replay body carries occurred_at, client_action_id and expected_member_name", () => {
      setOfflineUser("1");
      const action = enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Checkout",
        memberName: "Alice",
        occurredAt: Date.UTC(2026, 0, 2, 3, 4, 5),
      });
      const body = buildReplayBody(action);
      expect(body.client_action_id).toBe(action.id);
      expect(body.occurred_at).toBe("2026-01-02T03:04:05.000Z");
      expect(body.expected_member_name).toBe("Alice");
      // Large station clock skew is corrected with the server offset.
      expect(buildReplayBody(action, 5 * 60_000).occurred_at).toBe("2026-01-02T03:09:05.000Z");
      // Small skew is ignored.
      expect(buildReplayBody(action, 30_000).occurred_at).toBe("2026-01-02T03:04:05.000Z");
    });

    test("actions enqueued while a sync is running are not lost", async () => {
      setOfflineUser("1");
      enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "First",
      });

      let late: ReturnType<typeof enqueueOfflineAction> | null = null;
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (!okProbe(url) && !late) {
          // Operator action lands mid-sync (e.g. from another tab / before lock).
          late = enqueueOfflineAction({
            type: "return",
            payload: { nfc_value: "CARD-1", equipment_ids: [1] },
            description: "Enqueued during sync",
          });
        }
        return mockResponse(200, { success: true });
      });

      const result = await processSyncQueue();
      expect(result.success).toBe(1);
      const q = getOfflineQueue();
      expect(q).toHaveLength(1);
      expect(q[0].id).toBe(late!.id);
      expect(result.remaining).toBe(1);
    });

    test("a 4xx rejection is stored, removed from the queue, and the rest keeps syncing", async () => {
      setOfflineUser("1");
      enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "OK 1",
      });
      const bad = enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [2] },
        description: "Rejected",
        memberName: "Alice",
        equipmentNames: ["Sony FX3"],
      });
      enqueueOfflineAction({
        type: "return",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "OK 2",
      });

      let n = 0;
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        if (okProbe(url)) return mockResponse(200, []);
        n++;
        if (n === 2) return mockResponse(409, { error: '"Sony FX3" is not available (Status: Checked Out)' });
        return mockResponse(201, { success: true });
      });

      const result = await processSyncQueue();
      expect(result.success).toBe(2);
      expect(result.rejected).toHaveLength(1);
      expect(result.stoppedReason).toBeNull();
      expect(getOfflineQueue()).toEqual([]);

      const rejected = getRejectedActions();
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        id: bad.id,
        type: "checkout",
        memberName: "Alice",
        equipmentNames: ["Sony FX3"],
        httpStatus: 409,
        reason: '"Sony FX3" is not available (Status: Checked Out)',
        userId: "1",
      });

      // Persisted per user until acknowledged.
      setOfflineUser("2");
      expect(getRejectedActions()).toEqual([]);
      setOfflineUser("1");
      expect(getRejectedActions()).toHaveLength(1);
      acknowledgeRejectedActions([bad.id]);
      expect(getRejectedActions()).toEqual([]);
    });

    test("a 5xx (non-JSON error page) stops the pass and keeps the action for retry", async () => {
      setOfflineUser("1");
      const first = enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "First",
      });
      enqueueOfflineAction({
        type: "return",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Second",
      });

      const fetchMock = jest.fn().mockImplementation(async (url: string) => {
        if (okProbe(url)) return mockResponse(200, []);
        return mockResponse(502, "<html>Bad gateway</html>", { raw: true });
      });
      global.fetch = fetchMock;

      const result = await processSyncQueue();
      expect(result.stoppedReason).toBe("server");
      expect(result.stopMessage).toBe("Server error (502)");
      expect(result.rejected).toEqual([]);
      expect(result.remaining).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(2); // probe + first action only
      const q = getOfflineQueue();
      expect(q.map((a) => a.id)[0]).toBe(first.id);
      expect(q[0].status).toBe("failed");
      expect(getRejectedActions()).toEqual([]);
    });

    test("a hung replay request times out, releases the sync, and keeps the action", async () => {
      setOfflineUser("1");
      enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Hangs",
      });
      global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (okProbe(url)) return Promise.resolve(mockResponse(200, []));
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          );
        });
      });

      const result = await processSyncQueue(undefined, { requestTimeoutMs: 20 });
      expect(result.stoppedReason).toBe("network");
      expect(result.stopMessage).toMatch(/timed out/i);
      expect(getOfflineQueue()).toHaveLength(1);
      // Lock released: a new run can start.
      global.fetch = jest.fn().mockResolvedValue(mockResponse(200, { success: true }));
      const again = await processSyncQueue();
      expect(again.success).toBe(1);
    });

    test("canStart veto postpones the sync without touching the queue", async () => {
      setOfflineUser("1");
      enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Pending",
      });
      const fetchMock = jest.fn().mockResolvedValue(mockResponse(200, []));
      global.fetch = fetchMock;
      const result = await processSyncQueue(undefined, { canStart: () => false });
      expect(result.stoppedReason).toBe("busy");
      expect(fetchMock).toHaveBeenCalledTimes(1); // probe only
      expect(getOfflineQueue()).toHaveLength(1);
    });
  });

  describe("sendLiveRequest (live action classification)", () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    test("fetch TypeError is a genuine offline failure", async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      const r = await sendLiveRequest("/api/nfc/checkout", { body: { a: 1 } });
      expect(r.kind).toBe("offline");
    });

    test("timeout is a genuine offline failure", async () => {
      global.fetch = jest.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
            );
          })
      );
      const r = await sendLiveRequest("/api/nfc/checkout", { body: {} }, 10);
      expect(r).toEqual({ kind: "offline", message: "Request timed out." });
    });

    test("navigator.onLine === false is offline without calling fetch", async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;
      const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
      Object.defineProperty(globalThis, "navigator", {
        value: { onLine: false },
        configurable: true,
        writable: true,
      });
      try {
        const r = await sendLiveRequest("/api/nfc/checkout", { body: {} });
        expect(r.kind).toBe("offline");
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        if (original) Object.defineProperty(globalThis, "navigator", original);
        else delete (globalThis as any).navigator;
      }
    });

    test("a 5xx HTML error page is an error (not offline) with a readable message", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(mockResponse(502, "<!DOCTYPE html><title>502</title>", { raw: true }));
      const r = await sendLiveRequest("/api/nfc/checkout", { body: {} });
      expect(r).toMatchObject({ kind: "error", status: 502, message: "Server error (502)" });
    });

    test("a 4xx JSON error surfaces the server message", async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(409, { error: "Not available" }));
      const r = await sendLiveRequest("/api/nfc/checkout", { body: {} });
      expect(r).toMatchObject({ kind: "error", status: 409, message: "Not available" });
    });

    test("a 2xx with a non-JSON body is an error, not a success", async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(200, "<html></html>", { raw: true }));
      const r = await sendLiveRequest("/api/nfc?nfc_value=X");
      expect(r.kind).toBe("error");
    });

    test("2xx JSON is ok", async () => {
      global.fetch = jest.fn().mockResolvedValue(mockResponse(201, { success: true }));
      const r = await sendLiveRequest("/api/nfc/checkout", { body: {} });
      expect(r).toEqual({ kind: "ok", status: 201, data: { success: true } });
    });
  });

  describe("Sign-out", () => {
    afterEach(() => {
      delete (global as any).window.confirm;
    });

    test("warns when the station user has unsynced actions; cancelling keeps everything", () => {
      setOfflineUser("1");
      enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Unsynced",
      });
      setCachedMemberData("CARD-1", {
        card: { id: 1, nfc_value: "CARD-1", member_name: "Alice", notes: null, created_at: "" },
        activeCheckouts: [],
        history: [],
      });
      const confirmMock = jest.fn().mockReturnValue(false);
      (global as any).window.confirm = confirmMock;

      expect(confirmOfflineSignOut()).toBe(false);
      expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("1 offline NFC station action"));
      expect(getCachedMemberData("CARD-1")).not.toBeNull();
    });

    test("confirming clears the user's member cache but keeps the unsynced queue", () => {
      setOfflineUser("1");
      enqueueOfflineAction({
        type: "checkout",
        payload: { nfc_value: "CARD-1", equipment_ids: [1] },
        description: "Unsynced",
      });
      setCachedMemberData("CARD-1", {
        card: { id: 1, nfc_value: "CARD-1", member_name: "Alice", notes: null, created_at: "" },
        activeCheckouts: [],
        history: [],
      });
      (global as any).window.confirm = jest.fn().mockReturnValue(true);

      expect(confirmOfflineSignOut()).toBe(true);
      expect(mockStorage.getItem(offlineStorageKey(OFFLINE_MEMBERS_STORAGE_KEY, "1"))).toBeNull();
      expect(getPendingActionCount("1")).toBe(1);

      // Logging back in as the same user restores the queue for syncing.
      setOfflineUser("1");
      expect(getOfflineQueue()).toHaveLength(1);
    });

    test("no prompt when nothing is pending", () => {
      setOfflineUser("1");
      const confirmMock = jest.fn();
      (global as any).window.confirm = confirmMock;
      expect(confirmOfflineSignOut()).toBe(true);
      expect(confirmMock).not.toHaveBeenCalled();
    });
  });

  describe("isOnline Helper", () => {
    test("returns boolean status", () => {
      expect(typeof isOnline()).toBe("boolean");
    });
  });
});
