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

  test("hides checkout button for viewer even when status is Available", async () => {
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
    expect(screen.queryByTestId("checkout-button")).not.toBeInTheDocument();
  });
});

// ── Mutation handling: res.ok checks, inline errors, retire-instead-of-delete ──

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** GETs return the equipment/tag fixtures; other methods go to `onMutation`. */
function mockFetchWith(data: EquipmentDetail, onMutation: Handler) {
  if (!global.fetch) {
    global.fetch = jest.fn();
  }
  return jest.spyOn(global, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") return Promise.resolve(onMutation(url, init));
    if (url.includes("/api/tags")) return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse(data));
  });
}

async function renderAdmin(data: EquipmentDetail, onMutation: Handler) {
  const fetchSpy = mockFetchWith(data, onMutation);
  const onClose = jest.fn();
  const onUpdated = jest.fn();
  render(
    <EquipmentModal equipmentId={1} open={true} role="admin" onClose={onClose} onUpdated={onUpdated} />
  );
  await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  // global.fetch may be a shared jest.fn across tests; only count calls made from here on.
  fetchSpy.mockClear();
  return { fetchSpy, onClose, onUpdated };
}

describe("EquipmentModal — mutation error handling", () => {
  test("a rejected save shows the server error and keeps the modal open", async () => {
    const { onClose, onUpdated } = await renderAdmin(mockAvailable, () =>
      jsonResponse({ error: "Forbidden" }, 403)
    );

    // Edit the Equipment ID field to make the form dirty, then save.
    await userEvent.click(screen.getByText("SN-001"));
    const input = screen.getByDisplayValue("SN-001");
    await userEvent.clear(input);
    await userEvent.type(input, "SN-002");
    await userEvent.click(screen.getByTestId("save-button"));

    expect(await screen.findByTestId("action-error")).toHaveTextContent("Forbidden");
    expect(onClose).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  test("a failed return shows the server error and keeps the modal open", async () => {
    const { onClose } = await renderAdmin(mockCheckedOut, () =>
      jsonResponse({ error: "Item is not checked out" }, 409)
    );

    await userEvent.click(screen.getByText("Mark as Returned"));

    expect(await screen.findByTestId("action-error")).toHaveTextContent("Item is not checked out");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a network error on return is surfaced and the button re-enables", async () => {
    const { onClose } = await renderAdmin(mockCheckedOut, () => {
      throw new TypeError("Failed to fetch");
    });

    await userEvent.click(screen.getByText("Mark as Returned"));

    expect(await screen.findByTestId("action-error")).toHaveTextContent(/network error/i);
    expect(screen.getByText("Mark as Returned").closest("button")).not.toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("double-clicking Mark as Returned only sends one request", async () => {
    let resolveReturn: (r: Response) => void = () => {};
    const { fetchSpy } = await renderAdmin(
      mockCheckedOut,
      () => new Promise<Response>((resolve) => (resolveReturn = resolve))
    );

    const button = screen.getByText("Mark as Returned").closest("button")!;
    await userEvent.click(button);
    await userEvent.click(button);

    const posts = fetchSpy.mock.calls.filter(([, init]) => (init?.method ?? "GET") === "POST");
    expect(posts).toHaveLength(1);
    expect(screen.getByText("Returning…").closest("button")).toBeDisabled();
    resolveReturn(jsonResponse({ success: true }));
  });

  test("delete that retires instead shows the retired message and stays open", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const { onClose, onUpdated } = await renderAdmin(mockAvailable, () =>
      jsonResponse({
        success: true,
        retired: true,
        message: "This equipment has usage history, so it was retired instead of deleted.",
      })
    );

    await userEvent.click(screen.getByText("Delete"));

    expect(await screen.findByTestId("action-notice")).toHaveTextContent(/retired instead of deleted/i);
    expect(onUpdated).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a real delete closes the modal", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const { onClose, onUpdated } = await renderAdmin(mockAvailable, () =>
      jsonResponse({ success: true, retired: false })
    );

    await userEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onUpdated).toHaveBeenCalled();
    expect(screen.queryByTestId("action-notice")).not.toBeInTheDocument();
  });

  test("a failed delete shows the error inline", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const { onClose } = await renderAdmin(mockAvailable, () =>
      jsonResponse({ error: "Equipment is currently checked out" }, 409)
    );

    await userEvent.click(screen.getByText("Delete"));

    expect(await screen.findByTestId("action-error")).toHaveTextContent("Equipment is currently checked out");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a failed load shows an error instead of an empty modal", async () => {
    if (!global.fetch) global.fetch = jest.fn();
    jest.spyOn(global, "fetch").mockImplementation((input) =>
      Promise.resolve(
        String(input).includes("/api/tags") ? jsonResponse([]) : jsonResponse({ error: "Not found" }, 404)
      )
    );
    render(<EquipmentModal equipmentId={1} open={true} role="admin" onClose={jest.fn()} onUpdated={jest.fn()} />);

    expect(await screen.findByTestId("load-error")).toHaveTextContent("Not found");
  });
});
