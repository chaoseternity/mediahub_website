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

describe("offlineSync engine", () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
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

  describe("isOnline Helper", () => {
    test("returns boolean status", () => {
      expect(typeof isOnline()).toBe("boolean");
    });
  });
});
