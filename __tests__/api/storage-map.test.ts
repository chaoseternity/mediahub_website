import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import { getStorageMapData, getStorageMapConfig, saveStorageMapConfig, createEquipment } from "@/lib/db";
import { POST } from "@/app/api/storage-map/route";
import { auth } from "@/lib/auth";

describe("Storage Map API & Drag-and-Drop", () => {
  beforeEach(() => {
    setTestDb(makeTestDb());
    jest.clearAllMocks();
  });

  afterEach(() => {
    setTestDb(null);
  });

  it("allows admin to move equipment to a custom cabinet and shelf", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "1", name: "Admin", email: "admin@club.com", role: "admin" },
    });

    const eq = await createEquipment({
      name: "Sony A7S III",
      location: "Cabinet 1 - Shelf A",
      condition: "Working",
      status: "Available",
      tags: ["camera"],
    });

    const req = new Request("http://localhost:3000/api/storage-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "move_item",
        equipment_id: eq.id,
        cabinet: "Cabinet 2 (Lenses & Glass)",
        shelf: "Shelf B",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.location).toBe("Cabinet 2 (Lenses & Glass) - Shelf B");

    // Verify storage map data places item in Cabinet 2, Shelf B
    const mapData = await getStorageMapData();
    const cab2 = mapData.find((c) => c.name === "Cabinet 2 (Lenses & Glass)");
    expect(cab2).toBeDefined();
    const shelfB = cab2?.shelves.find((s) => s.name === "Shelf B");
    expect(shelfB?.items.some((i) => i.id === eq.id)).toBe(true);
  });

  it("denies non-admin users from moving equipment or saving layout", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "2", name: "Viewer", email: "viewer@club.com", role: "viewer" },
    });

    const req = new Request("http://localhost:3000/api/storage-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "move_item",
        equipment_id: 1,
        cabinet: "Cabinet 1",
        shelf: "Shelf A",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/Only administrators/);
  });

  it("saves and retrieves custom cabinet layout", async () => {
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "1", name: "Admin", email: "admin@club.com", role: "admin" },
    });

    const customConfig = [
      { id: "zone-1", name: "Studio Shelf Unit", description: "Main studio", shelves: ["Top Rack", "Bottom Bin"] },
      { id: "zone-2", name: "Mobile Production Cart", shelves: ["Drawer 1", "Drawer 2"] },
    ];

    const req = new Request("http://localhost:3000/api/storage-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_config",
        cabinets: customConfig,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    const saved = await getStorageMapConfig();
    expect(saved).toEqual(customConfig);
  });
});
