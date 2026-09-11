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
  condition: "Working",
  location: "Office A",
  status: "Available",
  created_at: "2023-01-01T00:00:00.000Z",
  updated_at: "2023-01-01T00:00:00.000Z",
  active_checkout_id: null,
  checked_out_by_name: null,
  checked_out_at: null,
  expected_return_at: null,
  checkout_location: null,
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

  test("renders Unavailable (In Repairs) status badge", () => {
    render(
      <EquipmentCard
        equipment={{ ...baseEquipment, status: "Unavailable (In Repairs)" }}
        onClick={jest.fn()}
      />
    );
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Unavailable (In Repairs)");
  });

  test("renders Unavailable (Broken) status badge", () => {
    render(
      <EquipmentCard
        equipment={{ ...baseEquipment, status: "Unavailable (Broken)" }}
        onClick={jest.fn()}
      />
    );
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Unavailable (Broken)");
  });

  test("renders Unavailable (Missing) status badge", () => {
    render(
      <EquipmentCard
        equipment={{ ...baseEquipment, status: "Unavailable (Missing)" }}
        onClick={jest.fn()}
      />
    );
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Unavailable (Missing)");
  });

  test("renders Unavailable (Retired) status badge", () => {
    render(
      <EquipmentCard
        equipment={{ ...baseEquipment, status: "Unavailable (Retired)" }}
        onClick={jest.fn()}
      />
    );
    expect(screen.getByTestId("status-badge")).toHaveTextContent("Unavailable (Retired)");
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
