/**
 * Component tests for EquipmentModal.
 * Uses a mocked /api/equipment/:id endpoint via jest.spyOn(global, 'fetch').
 *
 * Verifies:
 *  - Admin: Save Changes and Delete buttons are visible
 *  - Viewer: Save Changes button is hidden
 *  - Available equipment: CheckoutForm is rendered in the history tab
 *  - Checked Out equipment: Return button is shown, not checkout form
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { EquipmentModal } from "@/components/EquipmentModal";
import type { EquipmentDetail } from "@/lib/types";

const mockAvailable: EquipmentDetail = {
  id: 1,
  name: "Sony Projector",
  tags: ["A/V"],
  description: null,
  serial_number: "SN-001",
  condition: "Working",
  location: "Room 1",
  status: "Available",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  checkouts: [],
  active_checkout: null,
  checkout_location: null,
};

const mockCheckedOut: EquipmentDetail = {
  ...mockAvailable,
  status: "Checked Out",
  active_checkout: {
    id: 10,
    equipment_id: 1,
    checked_out_by: 2,
    checked_out_by_name: "Alice Johnson",
    checked_out_at: "2026-03-10T09:00:00Z",
    expected_return_at: "2026-03-21",
    returned_at: null,
    notes: null,
    checkout_location: null,
  },
  checkouts: [
    {
      id: 10,
      equipment_id: 1,
      checked_out_by: 2,
      checked_out_by_name: "Alice Johnson",
      checked_out_at: "2026-03-10T09:00:00Z",
      expected_return_at: "2026-03-21",
      returned_at: null,
      notes: null,
      checkout_location: null,
    },
  ],
};

function mockFetch(data: EquipmentDetail) {
  // Ensure global.fetch exists in jsdom before spying on it
  if (!global.fetch) {
    global.fetch = jest.fn();
  }
  jest.spyOn(global, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/api/tags")) {
      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => data } as Response);
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("EquipmentModal — Admin role", () => {
  test("shows Save Changes button for admin", async () => {
    mockFetch(mockAvailable);
    render(
      <EquipmentModal
        equipmentId={1}
        open={true}
        role="admin"
        onClose={jest.fn()}
        onUpdated={jest.fn()}
      />
    );
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByTestId("save-button")).toBeInTheDocument();
  });

  test("shows Delete button for admin", async () => {
    mockFetch(mockAvailable);
    render(
      <EquipmentModal
        equipmentId={1}
        open={true}
        role="admin"
        onClose={jest.fn()}
        onUpdated={jest.fn()}
      />
    );
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  test("shows checkout form when Check Out button is clicked", async () => {
    mockFetch(mockAvailable);
    render(
      <EquipmentModal
        equipmentId={1}
        open={true}
        role="admin"
        onClose={jest.fn()}
        onUpdated={jest.fn()}
      />
    );
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId("checkout-button"));
    expect(screen.getByTestId("checkout-section-header")).toBeInTheDocument();
    expect(screen.getByLabelText(/Checked out by/i)).toBeInTheDocument();
  });

  test("shows Return button when item is Checked Out", async () => {
    mockFetch(mockCheckedOut);
    render(
      <EquipmentModal
        equipmentId={1}
        open={true}
        role="admin"
        onClose={jest.fn()}
        onUpdated={jest.fn()}
      />
    );
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());

    expect(screen.getByText("Mark as Returned")).toBeInTheDocument();
    expect(screen.getAllByText("Alice Johnson").length).toBeGreaterThanOrEqual(1);
  });
});

describe("EquipmentModal — Viewer role", () => {
  test("hides Save Changes button for viewer", async () => {
    mockFetch(mockAvailable);
    render(
      <EquipmentModal
        equipmentId={1}
        open={true}
        role="viewer"
        onClose={jest.fn()}
        onUpdated={jest.fn()}
      />
    );
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.queryByTestId("save-button")).not.toBeInTheDocument();
  });

  test("hides Delete button for viewer", async () => {
    mockFetch(mockAvailable);
    render(
      <EquipmentModal
        equipmentId={1}
        open={true}
        role="viewer"
        onClose={jest.fn()}
        onUpdated={jest.fn()}
      />
    );
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  test("still shows checkout form for viewer when status is Available", async () => {
    mockFetch(mockAvailable);
    render(
      <EquipmentModal
        equipmentId={1}
        open={true}
        role="viewer"
        onClose={jest.fn()}
        onUpdated={jest.fn()}
      />
    );
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    await userEvent.click(screen.getByTestId("checkout-button"));
    expect(screen.getByTestId("checkout-section-header")).toBeInTheDocument();
  });
});
