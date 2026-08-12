export type Role = "admin" | "verified" | "viewer";

export type Condition = "New" | "Good" | "Fair" | "Poor";

export type EquipmentStatus =
  | "Available"
  | "Checked Out"
  | "Under Maintenance"
  | "Retired";

export interface Tag {
  id: number;
  name: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  username: string | null;
  google_id: string | null;
  image: string | null;
  role: Role;
  provider: string | null;
  created_at: string;
}

export interface Equipment {
  id: number;
  name: string;
  tags: string[];
  description: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  condition: Condition;
  quantity: number;
  location: string;
  status: EquipmentStatus;
  created_at: string;
  updated_at: string;
  // joined from active checkout
  active_checkout_id: number | null;
  checked_out_by_name: string | null;
  checked_out_at: string | null;
  expected_return_at: string | null;
  checkout_location: string | null;
}

export interface Checkout {
  id: number;
  equipment_id: number;
  checked_out_by: number | null;
  checked_out_by_name: string;
  checked_out_at: string;
  expected_return_at: string | null;
  returned_at: string | null;
  notes: string | null;
  checkout_location: string | null;
}

export interface EquipmentDetail extends Omit<Equipment, "active_checkout_id" | "checked_out_by_name" | "checked_out_at" | "expected_return_at"> {
  checkouts: Checkout[];
  active_checkout: Checkout | null;
}

// Extend next-auth Session type
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: Role;
      username: string | null;
    };
  }
}
