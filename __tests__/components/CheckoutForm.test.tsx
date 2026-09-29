/**
 * Component tests for CheckoutForm.
 *
 * Verifies:
 *  - Field 'Checked out by' is pre-filled with the user's OAuth name (defaultName).
 *  - Admin: renders a dropdown (<select>) showing names of existing users, and allows selecting any user.
 *  - Non-admin: renders a read-only input with pointer-events-none and cursor-not-allowed, preventing editing/clicking.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { CheckoutForm } from "@/components/CheckoutForm";

const mockUsers = [
  { id: 1, name: "Alice Admin", email: "alice@example.com", image: null },
  { id: 2, name: "Bob Verified", email: "bob@example.com", image: null },
  { id: 3, name: "Charlie Member", email: "charlie@example.com", image: null },
];

describe("CheckoutForm — Checked out by field behavior", () => {
  beforeEach(() => {
    if (!global.fetch) {
      global.fetch = jest.fn();
    }
    jest.spyOn(global, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/users")) {
        return Promise.resolve({
          ok: true,
          json: async () => mockUsers,
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: 1, success: true }),
      } as Response);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Admin: renders dropdown select pre-filled with OAuth name and lists existing users", async () => {
    render(
      <CheckoutForm
        equipmentId={42}
        defaultName="Alice Admin"
        role="admin"
        onSuccess={jest.fn()}
      />
    );

    const select = screen.getByLabelText(/Checked out by/i) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("Alice Admin");

    // Wait for directory users to load into the dropdown
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Bob Verified" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Charlie Member" })).toBeInTheDocument();
    });

    // Admin can select another user from the dropdown
    await userEvent.selectOptions(select, "Charlie Member");
    expect(select.value).toBe("Charlie Member");
  });

  test("Non-admin (verified): renders read-only input locked to OAuth name", () => {
    render(
      <CheckoutForm
        equipmentId={42}
        defaultName="Bob Verified"
        role="verified"
        onSuccess={jest.fn()}
      />
    );

    const input = screen.getByLabelText(/Checked out by/i) as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("Bob Verified");
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveClass("pointer-events-none");
    expect(input).toHaveClass("cursor-not-allowed");
  });

  test("Non-admin (viewer): renders read-only input locked to OAuth name", () => {
    render(
      <CheckoutForm
        equipmentId={42}
        defaultName="Dave Viewer"
        role="viewer"
        onSuccess={jest.fn()}
      />
    );

    const input = screen.getByLabelText(/Checked out by/i) as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("Dave Viewer");
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveClass("pointer-events-none");
    expect(input).toHaveClass("cursor-not-allowed");
  });

  test("Submitting checkout sends the selected name to the checkout API", async () => {
    const onSuccess = jest.fn();
    render(
      <CheckoutForm
        equipmentId={42}
        defaultName="Alice Admin"
        role="admin"
        onSuccess={onSuccess}
      />
    );

    const select = screen.getByLabelText(/Checked out by/i);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Charlie Member" })).toBeInTheDocument();
    });

    await userEvent.selectOptions(select, "Charlie Member");
    await userEvent.type(screen.getByLabelText(/Purpose/i), "Annual shoot");
    await userEvent.click(screen.getByRole("button", { name: /Check Out/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/equipment/42/checkout",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"checked_out_by_name":"Charlie Member"'),
      })
    );
  });
});
