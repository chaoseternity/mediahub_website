/**
 * Component tests for EquipmentCard.
 * Verifies: renders name, renders status badge text, fires onClick when clicked.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EquipmentCard } from "@/components/EquipmentCard";
import type { Equipment } from "@/lib/types";

const baseEquipment: Equipment = {
  id: 1,
  name: "Dell Laptop",
  tags: ["IT"],
  description: "A laptop",
  serial_number: "SN-001",
  purchase_date: "2023-01-01",
  condition: "Good",
  quantity: 1,
  location: "Office A",
  status: "Available",
  created_at: "2023-01-01T00:00:00.000Z",
  updated_at: "2023-01-01T00:00:00.000Z",
  active_checkout_id: null,
  checked_out_by_name: null,
  checked_out_at: null,
  expected_return_at: null,
};

describe("EquipmentCard", () => {
  test("renders the equipment name", () => {
    render(<EquipmentCard equipment={baseEquipment} onClick={jest.fn()} />);
    expect(screen.getByText("Dell Laptop")).toBeInTheDocument();
  });

  test("renders the status badge with correct text", () => {
    render(<EquipmentCard equipment={baseEquipment} onClick={jest.fn()} />);
    const badge = screen.getByTestId("status-badge");
    expect(badge).toHaveTextContent("Available");
  });

  test("renders Checked Out status badge", () => {
    render(
      <EquipmentCard
        equipment={{ ...baseEquipment, status: "Checked Out", checked_out_by_name: "Alice" }}
        onClick={jest.fn()}
      />
    );
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Checked Out");
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  test("renders Under Maintenance status badge", () => {
    render(
      <EquipmentCard
        equipment={{ ...baseEquipment, status: "Under Maintenance" }}
        onClick={jest.fn()}
      />
    );
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Under Maintenance");
  });

  test("renders Retired status badge", () => {
    render(
      <EquipmentCard
        equipment={{ ...baseEquipment, status: "Retired" }}
        onClick={jest.fn()}
      />
    );
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Retired");
  });

  test("calls onClick when the card is clicked", () => {
    const handleClick = jest.fn();
    render(<EquipmentCard equipment={baseEquipment} onClick={handleClick} />);
    fireEvent.click(screen.getByTestId("equipment-card"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  test("renders category and location", () => {
    render(<EquipmentCard equipment={baseEquipment} onClick={jest.fn()} />);
    expect(screen.getByText("IT")).toBeInTheDocument();
    expect(screen.getByText("Office A")).toBeInTheDocument();
  });
});
